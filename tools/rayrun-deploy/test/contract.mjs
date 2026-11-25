/**
 * Rayrun deploy contract.
 *
 * The deploy job is the only CI path that would receive a real Rayrun token.
 * It is temporarily disabled while the sandbox bootstrap/egress issue is
 * resolved. Keep its script, serialization and secret handling intact for an
 * easy restore; the tokenized DSH URL must never appear in logs.
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
assert.match(workflow, /if: false/, 'deploy job must stay temporarily disabled')
assert.doesNotMatch(
  workflow,
  /if: \(github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'\) \|\| github\.event_name == 'workflow_dispatch'/,
  'deploy must not be re-enabled until the sandbox bootstrap issue is resolved',
)
assert.match(workflow, /secrets\.RAYRUN_TOKEN/, 'deploy token must come from an Actions secret')
assert.doesNotMatch(workflow, /vars\.RAYRUN_SANDBOX_ID/, 'deploy must create its own sandbox, not require a fixed id')
assert.match(workflow, /vars\.RAYRUN_DEPLOY_SANDBOX_NAME/, 'deploy sandbox name must be an optional Actions variable')
assert.match(workflow, /group: rayrun-deploy/, 'deploy must serialize on its own group')
assert.match(workflow, /cancel-in-progress: false/, 'deploy must not be cancelled mid-run')
assert.match(workflow, /steps\.gate\.outputs\.enabled == 'true'/, 'deploy must skip when unconfigured')

assert.match(deploy, /Rayrun sandbox/, 'deploy script header must say what it does')
assert.doesNotMatch(deploy, /RAYRUN_SANDBOX_ID/, 'deploy must not depend on the old fixed sandbox id')
assert.match(deploy, /POST', '\/sandboxes'/, 'deploy must create a sandbox through the Rayrun API')
assert.match(deploy, /remote_desktop: true/, 'deploy sandbox must expose a desktop ingress')
assert.match(deploy, /deepseek-harness@1/, 'deploy sandbox must use a DSH image')
assert.match(deploy, /pnpm@10/, 'deploy must bootstrap pnpm when the image does not provide it')
assert.match(deploy, /egress_allow: \['registry\.npmjs\.org'\]/, 'deploy sandbox must allow only the npm registry it needs')
assert.match(deploy, /\/stop`/, 'deploy must stop the sandbox after the check')
assert.doesNotMatch(deploy, /\/destroy/, 'deploy must never destroy a sandbox')
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
