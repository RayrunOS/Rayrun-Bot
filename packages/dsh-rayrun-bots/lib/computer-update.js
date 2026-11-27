/**
 * Replace the bots' shared cloud computer with a fresh image while keeping the
 * workspace and common sign-in/config directories.
 *
 * Rayrun has no in-place image rebuild. The safe path is:
 *   1. rename the current computer to a rollback name;
 *   2. create a new computer with the original name and selected image/credential;
 *   3. tar the preserved paths from the old computer, copy them through the
 *      dependency's `rayrun_files` tool, and extract them on the new computer;
 *   4. destroy the old computer only after the new one is ready and verified.
 *
 * The user's Update confirmation is the explicit request for that destruction.
 * Any failure before that point restores the old name and leaves the old
 * computer available; the new computer is stopped and renamed so it cannot take
 * the original name. If only the final destroy fails, the new computer stays in
 * place and the old one is stopped; the result reports that cleanup failed. This
 * module only uses the published dependency tools/RPC; the Rayrun token never
 * enters this module or its results.
 */
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ERROR_CODES } from './errors.js'
import { rayrunFailure } from './rayrun-rpc.js'

const NAME_MAX = 64
const TIMEOUT_MS = 30 * 60 * 1000
const PRESERVE = ['workspace', 'root/.config', 'root/.local/share', 'root/.mozilla', 'root/.ssh']
const BOT_IMAGE = 'deepseek-harness@1'
const CLOUD_HOST_IMAGE = 'dsh-bot@1'
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

function machineName(machine) {
  const name = typeof machine?.name === 'string' ? machine.name.trim() : ''
  if (!name || name.length > NAME_MAX || CONTROL.test(name)) {
    throw rayrunFailure(ERROR_CODES.internal, 'The current cloud computer has no usable name.')
  }
  return name
}

function updateError(message) {
  return rayrunFailure(ERROR_CODES.computerUpdate, message)
}

function credentialNameOf(item) {
  if (typeof item === 'string') return item.trim()
  return typeof item?.name === 'string' ? item.name.trim() : ''
}

function pickCredential(list, machine) {
  const names = list.map(credentialNameOf).filter(Boolean)
  const bound = Array.isArray(machine?.credentials)
    ? machine.credentials.filter((name) => typeof name === 'string' && names.includes(name))
    : []
  if (bound.length > 0) return bound[0]
  const preferred = names.find((name) => /deepseek|model/i.test(name))
  if (preferred) return preferred
  return names.length === 1 ? names[0] : ''
}

function toolOf(registry, name) {
  let tool
  try {
    tool = registry?.get?.(name)
  } catch {
    tool = undefined
  }
  if (typeof tool?.execute !== 'function') {
    throw updateError(`dsh-rayrun-computer is missing the ${name} tool; the computer was not updated.`)
  }
  return tool
}

function backupName(name, stamp) {
  const suffix = `-pre-update-${stamp}`
  return `${name.slice(0, Math.max(1, NAME_MAX - suffix.length))}${suffix}`
}

function failedName(name, stamp) {
  const suffix = `-failed-update-${stamp}`
  return `${name.slice(0, Math.max(1, NAME_MAX - suffix.length))}${suffix}`
}

function sameMachine(machine, wanted) {
  return machine?.name === wanted || machine?.id === wanted
}

function shellFailure(result, action) {
  if (result?.timed_out) throw updateError(`${action} timed out; the computer was not updated.`)
  if (Number(result?.exit_code) !== 0) {
    const detail = String(result?.stderr || result?.stdout || '').trim().slice(0, 300)
    throw updateError(`${action} failed${detail ? `: ${detail}` : '.'}`)
  }
  return result
}

/**
 * @param {{
 *   rpc: { call: Function, resolveMachine?: Function },
 *   getTools: () => object,
 *   logger?: object,
 * }} options
 */
export function openComputerUpdater({ rpc, getTools, logger, image: requestedImage = BOT_IMAGE } = {}) {
  if (typeof rpc?.call !== 'function') throw new TypeError('computer updater needs a Rayrun RPC client.')
  if (typeof getTools !== 'function') throw new TypeError('computer updater needs a tool registry.')
  if (typeof requestedImage !== 'string' || requestedImage.trim() === '' || CONTROL.test(requestedImage)) {
    throw new TypeError('computer updater needs a valid image name.')
  }
  const image = requestedImage.trim()
  let running = false

  async function overview(signal) {
    return rpc.call('overview', {}, { timeoutMs: 30_000, signal })
  }

  async function findMachine(machineRef, signal) {
    const body = await overview(signal)
    const machines = Array.isArray(body?.machines) ? body.machines.filter((item) => item?.status !== 'Terminated') : []
    const wanted = String(machineRef ?? '').trim()
    const machine = wanted
      ? machines.find((item) => sameMachine(item, wanted))
      : machines[0]
    if (!machine) throw updateError('The cloud computer to update was not found; nothing was changed.')
    return { body, machine }
  }

  async function waitRunning(machineId, signal) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const body = await rpc.call('machine.get', { id: machineId }, { timeoutMs: 30_000, signal })
      if (body?.machine?.status === 'Running') return body.machine
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    throw updateError('The new cloud computer did not reach Running; the old computer was restored.')
  }

  async function update({ machine: machineRef, confirmed } = {}) {
    if (running) throw updateError('A computer update is already running; wait for it to finish.')
    if (confirmed !== true) throw updateError('Updating the computer requires explicit confirmation.')

    running = true
    const stamp = Date.now().toString(36)
    let old = null
    let original = ''
    let originalStatus = ''
    let backup = ''
    let renamed = false
    let created = null
    let localDir = null
    const tarPath = `.dsh/rayrun-update-${stamp}.tgz`
    try {
      const { body, machine } = await findMachine(machineRef)
      old = machine
      original = machineName(machine)
      originalStatus = machine.status
      backup = backupName(original, stamp)
      if (machine.status !== 'Running' && machine.status !== 'Paused' && machine.status !== 'Stopped') {
        throw updateError(`The cloud computer is ${machine.status}; no update was attempted.`)
      }
      const agents = Array.isArray(body?.agents) ? body.agents : []
      if (agents.length > 0 && !agents.some((agent) => agent?.ref === image)) {
        throw updateError(`The required image ${image} is not available in this Rayrun account.`)
      }
      const credentials = await rpc.call('credentials.list', {}, { timeoutMs: 30_000 })
      const list = Array.isArray(credentials?.credentials) ? credentials.credentials : []
      const credentialName = pickCredential(list, machine)
      if (!credentialName) {
        throw updateError('No DeepSeek credential is available in this Rayrun account; add one before updating the computer.')
      }

      const tools = getTools()
      const exec = toolOf(tools, 'rayrun_exec')
      const files = toolOf(tools, 'rayrun_files')
      const signal = AbortSignal.timeout(TIMEOUT_MS)
      localDir = mkdtempSync(path.join(tmpdir(), 'rayrun-bots-update-'))
      const localTar = path.join(localDir, 'workspace.tgz')

      const rename = async (id, name) => rpc.call('machine.action', { id, verb: 'rename', name }, { timeoutMs: 120_000, signal })
      const stop = async (id) => rpc.call('machine.action', { id, verb: 'stop' }, { timeoutMs: 120_000, signal })

      await rename(old.id, backup)
      renamed = true
      const create = await rpc.call('machine.create', {
        name: original,
        agent: image,
        cpu_cores: Number(old.cpu_cores) || 2,
        memory_mb: Math.max(2048, Number(old.memory_mb) || 2048),
        ...(Number(old.workspace_mb) > 0 ? { workspace_mb: Number(old.workspace_mb) } : {}),
        remote_desktop: old.remote_desktop === true,
        credentials: [credentialName],
        egress_allow: ['api.deepseek.com'],
        ...(Number(old.max_lifetime_seconds) > 0 ? { lifetime_seconds: Number(old.max_lifetime_seconds) } : {}),
      }, { timeoutMs: 240_000, signal })
      created = create?.machine
      if (!created?.id) throw updateError('Rayrun created no replacement computer; the old computer was restored.')
      const runningMachine = created.status === 'Running' ? created : await waitRunning(created.id, signal)

      shellFailure(await exec.execute({
        sandbox: old.id,
        command: [
          'set -e',
          'paths=""',
          ...PRESERVE.map((entry) => `[ -e "/${entry}" ] && paths="$paths ${entry}"`),
          '[ -n "$paths" ]',
          'mkdir -p /workspace/.dsh',
          `tar -czf /workspace/${tarPath} --exclude=workspace/${tarPath} -C / $paths`,
        ].join('\n'),
        timeout_seconds: 1800,
      }, { signal }), 'Packing the old computer')

      await files.execute({
        action: 'download',
        sandbox: old.id,
        path: tarPath,
        local_path: localTar,
      }, { signal })
      const size = statSync(localTar).size
      if (size <= 0) throw updateError('The workspace archive is empty; the old computer was restored.')
      shellFailure(await exec.execute({
        sandbox: runningMachine.id,
        command: 'mkdir -p /workspace/.dsh',
        timeout_seconds: 60,
      }, { signal }), 'Preparing the new computer')
      await files.execute({
        action: 'upload',
        sandbox: runningMachine.name || runningMachine.id,
        path: tarPath,
        local_path: localTar,
      }, { signal })
      shellFailure(await exec.execute({
        sandbox: runningMachine.id,
        command: `test -s /workspace/${tarPath}`,
        timeout_seconds: 60,
      }, { signal }), 'Checking the uploaded archive')

      shellFailure(await exec.execute({
        sandbox: runningMachine.id,
        command: `set -e\ntar -xzf /workspace/${tarPath} -C /\nrm -f /workspace/${tarPath}`,
        timeout_seconds: 1800,
      }, { signal }), 'Restoring the new computer')
      shellFailure(await exec.execute({
        sandbox: runningMachine.id,
        command: 'test -d /workspace',
        timeout_seconds: 60,
      }, { signal }), 'Checking the new computer')
      await exec.execute({
        sandbox: old.id,
        command: `rm -f /workspace/${tarPath}`,
        timeout_seconds: 60,
      }, { signal }).catch(() => {})

      let destroyed = false
      try {
        await rpc.call('machine.action', { id: old.id, verb: 'destroy' }, { timeoutMs: 120_000, signal })
        destroyed = true
      } catch (error) {
        // The new computer is already verified. Do not roll back a successful
        // migration because cleanup failed; stop the old computer and report it.
        try { await stop(old.id) } catch { /* best effort */ }
        try {
          logger?.warn?.(`dsh-rayrun-bots: computer update could not destroy the old computer: ${String(error?.message ?? error).slice(0, 200)}`)
        } catch {
          // Logging must not change the update result.
        }
      }
      return {
        updated: true,
        machine: { id: runningMachine.id, name: runningMachine.name || original, image },
        previous: { id: old.id, name: backup, status: destroyed ? 'Destroyed' : 'Stopped', destroyed },
        credential: credentialName,
      }
    } catch (error) {
      let restored = true
      if (old !== null) {
        if (created?.id) {
          try {
            await rpc.call('machine.action', { id: created.id, verb: 'rename', name: failedName(original, stamp) }, { timeoutMs: 120_000 })
          } catch { restored = false }
          try {
            await rpc.call('machine.action', { id: created.id, verb: 'stop' }, { timeoutMs: 120_000 })
          } catch { restored = false }
        }
        if (renamed) {
          try {
            await rpc.call('machine.action', { id: old.id, verb: 'rename', name: original }, { timeoutMs: 120_000 })
          } catch { restored = false }
          if (originalStatus !== 'Running') {
            try {
              const current = await rpc.call('machine.get', { id: old.id }, { timeoutMs: 30_000 })
              if (current?.machine?.status === 'Running') {
                await rpc.call('machine.action', { id: old.id, verb: 'stop' }, { timeoutMs: 120_000 })
              }
            } catch { /* best effort: the old machine may already be stopped */ }
          }
        }
      }
      try {
        logger?.warn?.(`dsh-rayrun-bots: computer update failed: ${String(error?.message ?? error).slice(0, 200)}`)
      } catch {
        // Logging must not change the failure.
      }
      const replacement = created?.id ? ` The stopped replacement is ${failedName(original, stamp)}.` : ''
      if (!restored) {
        throw updateError(`Computer update failed and automatic rollback could not restore "${original}"; check the old and new computers before retrying.${replacement} ${String(error?.message ?? error).slice(0, 300)}`)
      }
      if (error?.code === ERROR_CODES.computerUpdate) {
        if (!replacement) throw error
        throw updateError(`${error.message}${replacement}`)
      }
      throw updateError(`Computer update failed; the old computer was restored.${replacement} ${String(error?.message ?? error).slice(0, 300)}`)
    } finally {
      running = false
      if (localDir !== null) {
        try { rmSync(localDir, { recursive: true, force: true }) } catch { /* temp cleanup is best effort */ }
      }
    }
  }

  return { update }
}

export { BOT_IMAGE, CLOUD_HOST_IMAGE, PRESERVE }
