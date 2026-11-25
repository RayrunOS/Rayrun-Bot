/**
 * npm publish workflow contract.
 *
 * The Release job is the only path that may publish dsh-rayrun-bots. It must
 * use OIDC, publish the workspace package rather than the private root, and
 * keep prereleases off the latest dist-tag. checks.yml packs a tarball for
 * the Rayrun sandbox deploy; that must not become an npm publish.
 *
 *   node packages/dsh-rayrun-bots/test/publish-workflow.mjs
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { distTag } from '../../../tools/npm-publish/dist-tag.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const workflow = readFileSync(path.join(root, '.github/workflows/publish.yml'), 'utf8')
const checks = readFileSync(path.join(root, '.github/workflows/checks.yml'), 'utf8')
const rootPackage = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const botPackage = JSON.parse(readFileSync(path.join(root, 'packages/dsh-rayrun-bots/package.json'), 'utf8'))

assert.equal(rootPackage.private, true, 'workspace root must stay private')
assert.equal(rootPackage.name, 'rayrun-bot')
assert.equal(botPackage.name, 'dsh-rayrun-bots')
assert.equal(botPackage.private, undefined)
assert.equal(checks.includes('npm publish'), false, 'checks.yml must not npm publish')
assert.match(checks, /^ {2}deploy:$/m, 'checks deploy job must stay')

assert.match(workflow, /on:\n {2}release:\n {4}types: \[published\]\n {2}workflow_dispatch:\n/)
assert.equal(/types:\s*\[[^\]]*\b(created|prereleased|released|edited|deleted|unpublished)\b/.test(workflow), false)
assert.equal(/\n {2}push:/.test(workflow), false)
assert.equal(/\n {4}tags:/.test(workflow), false)
assert.equal(/^\s*environment:/m.test(workflow), false, 'GitHub Environment must stay unset')
assert.equal(workflow.includes('secrets.'), false, 'workflow must not read Actions secrets')
assert.equal(/^\s*(NODE_AUTH_TOKEN|NPM_TOKEN)\s*:/m.test(workflow), false, 'workflow must not assign an npm token')
assert.match(workflow, /must stay absent/)
assert.match(workflow, /id-token: write/)
assert.equal((workflow.match(/id-token:\s*write/g) || []).length, 1)
assert.match(workflow, /actions\/setup-node@v7/)
assert.match(workflow, /node-version: '24'/)
assert.match(workflow, /package-manager-cache: false/)
assert.match(workflow, /_authToken/)
assert.match(workflow, /working-directory: packages\/dsh-rayrun-bots/)
assert.match(workflow, /git checkout origin\/main -- tools\/npm-publish\/dist-tag\.mjs/)
assert.match(workflow, /release tag \$TAG does not match package\.json version \$VERSION \(expected v\$VERSION\)/)
assert.match(workflow, /git rev-parse "refs\/tags\/\$TAG\^\{commit\}"/)
assert.match(workflow, /git merge-base --is-ancestor "\$TAG_SHA" origin\/main/)
assert.match(workflow, /already on the registry/)
assert.match(workflow, /could not check whether dsh-rayrun-bots@\$VERSION is already published/)
assert.match(workflow, /grep -q 'E404'/)
assert.match(workflow, /if: github\.event_name == 'release'\n\s+working-directory: packages\/dsh-rayrun-bots\n\s+run: \|[\s\S]*?\n\s+npm publish --provenance --access public --tag "\$DIST_TAG"\n/)
assert.equal((workflow.match(/npm publish --provenance --access public --tag "\$DIST_TAG"/g) || []).length, 1)
assert.equal(/^\s*npm publish\s*$/m.test(workflow), false)
assert.match(workflow, /if: github\.event_name == 'workflow_dispatch'/)
assert.match(workflow, /was not published/)
assert.match(workflow, /The publish may have succeeded/)
assert.match(workflow, /Do not republish this version/)
assert.match(workflow, /attempts=15\n\s+sleep_seconds=10/)
assert.match(workflow, /confirm with npm view dsh-rayrun-bots@\$VERSION; do not republish/)

assert.equal(distTag('0.1.0-alpha.0'), 'alpha')
assert.equal(distTag('1.2.3-beta.1'), 'beta')
assert.equal(distTag('1.2.3-rc.2'), 'rc')
assert.equal(distTag('1.2.3-alpha.beta'), 'alpha')
assert.equal(distTag('1.2.3'), 'latest')
assert.equal(distTag('0.1.0'), 'latest')
assert.throws(() => distTag('1.2.3-0'), /dist-tag identifier/)
assert.throws(() => distTag('1.2.3-latest.1'), /must not publish to latest/)
assert.throws(() => distTag('1.2.3-LATEST'), /must not publish to latest/)
assert.throws(() => distTag('01.2.3'), /not a publishable version/)
assert.throws(() => distTag('1.2'), /not a publishable version/)
assert.throws(() => distTag(''), /not a publishable version/)

const script = path.join(root, 'tools/npm-publish/dist-tag.mjs')
assert.equal(execFileSync(process.execPath, [script, '0.1.0-alpha.0'], { encoding: 'utf8' }), 'alpha\n')
assert.equal(execFileSync(process.execPath, [script, '2.0.0'], { encoding: 'utf8' }), 'latest\n')
assert.throws(() => execFileSync(process.execPath, [script, '1.2.3-0'], { encoding: 'utf8', stdio: 'pipe' }))

console.log('npm publish workflow contract ok')
