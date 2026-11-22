/**
 * Cloud bot host POC entry point.
 *
 * Intended argv in a Rayrun `runtimes` spec:
 *   node /workspace/.rayrun/bin/host.mjs
 *
 * Environment: DSH_BOT_ROOT, BOT_ID, DSH_BOT_LOG, DEEPSEEK_API_KEY (injected by
 * the platform through a sandbox credential; never read as a value here).
 */
import { createCloudHost } from './lib/host.mjs'
import { createDshAgent } from './lib/dsh-agent.mjs'

const root = process.env.DSH_BOT_ROOT || '/workspace/.rayrun/bots/demo'
const botId = process.env.BOT_ID || 'demo'
const logPath = process.env.DSH_BOT_LOG || '/workspace/.rayrun/logs/bot-host.log'
const dshAgent = process.env.DSH_BOT_AGENT === 'dsh'
  ? createDshAgent({
      dshHome: process.env.DSH_HOME || '/workspace/.rayrun/dsh',
      home: process.env.HOME || '/workspace/.rayrun/home',
      profile: process.env.DSH_BOT_PROFILE || 'bot',
      cwd: '/workspace',
    })
  : undefined
const host = createCloudHost({
  root,
  botId,
  logPath,
  credentialPresent: Boolean(process.env.DEEPSEEK_API_KEY),
  ...(dshAgent === undefined ? {} : { agent: dshAgent.run }),
})
const recovered = host.recover()
host.log('started', { pid: process.pid, recovered, hasCredential: Boolean(process.env.DEEPSEEK_API_KEY) })
host.writeState('running')

let busy = false
let stopping = false
let heartbeat
let poller

function stop(signal) {
  if (stopping) return
  stopping = true
  clearInterval(heartbeat)
  clearInterval(poller)
  try {
    host.writeState('stopped')
    host.log('stopped', { signal })
  } finally {
    process.exit(0)
  }
}

async function tick() {
  if (busy || stopping) return
  busy = true
  try {
    await host.processNext()
  } finally {
    busy = false
  }
}

heartbeat = setInterval(() => {
  if (!stopping) host.writeState('running')
}, 2000)
poller = setInterval(() => { void tick() }, 1000)

process.on('SIGTERM', () => stop('SIGTERM'))
process.on('SIGINT', () => stop('SIGINT'))
void tick()
