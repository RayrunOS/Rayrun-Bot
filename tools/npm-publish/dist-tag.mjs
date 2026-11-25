#!/usr/bin/env node
/**
 * Dist-tag for `npm publish --tag`.
 *
 * A prerelease (any hyphen, e.g. 0.1.0-alpha.0) publishes to the first
 * prerelease identifier (`alpha`) and must not move `latest`. A stable
 * version publishes to `latest`.
 *
 *   node tools/npm-publish/dist-tag.mjs 0.1.0-alpha.0
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

export function distTag(version) {
  const match = versionPattern.exec(version)
  if (!match) throw new Error(`not a publishable version: ${version}`)
  const prerelease = match[4]
  if (!prerelease) return 'latest'
  const ident = prerelease.split('.')[0]
  if (!/^[A-Za-z][0-9A-Za-z-]*$/.test(ident)) {
    throw new Error(`prerelease ${version} has no dist-tag identifier`)
  }
  if (ident.toLowerCase() === 'latest') {
    throw new Error(`prerelease ${version} must not publish to latest`)
  }
  return ident
}

const entry = process.argv[1] && path.resolve(process.argv[1])
if (entry === fileURLToPath(import.meta.url)) {
  try {
    const tag = distTag(process.argv[2])
    process.stdout.write(`${tag}\n`)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
