/**
 * Rayrun deploy contract.
 *
 * The deploy job is the only CI path that receives a real Rayrun token. Keep
 * it main-only, serialized, dependent on the checks, and free of the tokenized
 * DSH URL in logs. The packed URL lives in the sandbox at mode 600.
 *
 *   node tools/rayrun-deploy/test/contract.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const workflow = readFileSync(path.join(root, '.github/workflows/checks.yml'), 'utf8')
const deploy = readFileSync(path.join(root, '.github/scripts/deploy-rayrun.mjs'), 'utf8')

assert.match(workflow, /^  deploy:$/m, 'missing deploy job')
assert.match(workflow, /needs: \[checks, dsh-plugin\]/, 'deploy must wait for both check matrices')
assert.match(
  workflow,
  /if: \(github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'\) \|\| github\.event_name == 'workflow_dispatch'/,
  'deploy must be main-only or manually dispatched',
)
assert.match(workflow, /secrets\.RAYRUN_TOKEN/, 'deploy token must come from an Actions secret')
assert.match(workflow, /vars\.RAYRUN_SANDBOX_ID/, 'sandbox id must come from an Actions variable')
assert.match(workflow, /group: rayrun-deploy/, 'deploy must serialize on its own group')
assert.match(workflow, /cancel-in-progress: false/, 'deploy must not be cancelled mid-run')
assert.match(workflow, /steps\.gate\.outputs\.enabled == 'true'/, 'deploy must skip when unconfigured')

assert.match(deploy, /Rayrun sandbox/, 'deploy script header must say what it does')
assert.match(deploy, /dsh-web-url\.txt/, 'deploy must write the tokenized URL to the sandbox')
assert.match(deploy, /--public-url/, 'deploy must restart dsh web on the public ingress')
assert.match(deploy, /redirect: 'manual'/, 'deploy must verify the token redirect explicitly')
assert.equal(deploy.includes('console.log(deployedUrl'), false, 'deploy must not print the tokenized URL')
assert.equal(deploy.includes('console.log(url)'), false, 'deploy must not print the tokenized URL')
assert.equal(deploy.includes('echo "$url"'), false, 'deploy must not print the tokenized URL')
const tokenRefs = deploy.match(/\bTOKEN\b/g) || []
assert.equal(tokenRefs.length, 3, 'Rayrun token must only be read and used in the authorization header')
assert.match(deploy, /chmod 600 \/workspace\/dsh-web-url\.txt/, 'deploy URL file must be private')

console.log('rayrun deploy contract ok')
