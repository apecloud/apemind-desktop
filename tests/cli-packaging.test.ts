import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { prepareApeMindCli, resolveApeMindCliResources } from '../overlay/add-files/apps/desktop/scripts/apemind-cli-runtime.mjs'

test('packaging requires the pinned CLI, repairs a corrupt cache, and rejects bad overrides', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'apemind-cli-packaging-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const bytes = Buffer.from('synthetic release executable')
  const checksum = createHash('sha256').update(bytes).digest('hex')
  mkdirSync(join(root, 'resources'))
  writeFileSync(join(root, 'resources', 'apemind-cli.lock.json'), JSON.stringify({
    version: 'v9.9.9',
    commit: 'a'.repeat(40),
    artifacts: {
      'darwin-arm64': { sha256: checksum, url: 'https://example.invalid/apemind-darwin-arm64' },
      'win32-x64': { sha256: checksum, url: 'https://example.invalid/apemind-windows-amd64.exe' },
    },
  }))
  let downloads = 0
  t.mock.method(globalThis, 'fetch', async () => {
    downloads++
    return new Response(bytes)
  })
  assert.throws(() => resolveApeMindCliResources({}, 'darwin', 'arm64', root), /ENOENT/)
  const binary = await prepareApeMindCli({}, 'darwin', 'arm64', root)
  assert.deepEqual(readFileSync(binary), bytes)
  const resources = resolveApeMindCliResources({}, 'darwin', 'arm64', root)
  assert.equal(resources[0].to, 'apemind/bin/apemind')
  assert.equal(resources[1].to, 'apemind/release.json')
  chmodSync(binary, 0o644)
  await prepareApeMindCli({}, 'darwin', 'arm64', root)
  assert.equal(statSync(binary).mode & 0o111, 0o111)
  assert.equal(downloads, 1)
  writeFileSync(binary, 'corrupt')
  assert.throws(() => resolveApeMindCliResources({}, 'darwin', 'arm64', root), /checksum/)
  await assert.rejects(prepareApeMindCli({ APEMIND_CLI_BINARY: binary }, 'darwin', 'arm64', root), /checksum/)
  assert.equal(downloads, 1)
  await prepareApeMindCli({}, 'darwin', 'arm64', root)
  assert.equal(downloads, 2)
  await prepareApeMindCli({}, 'win32', 'x64', root)
  assert.equal(resolveApeMindCliResources({}, 'win32', 'x64', root)[0].to, 'apemind/bin/apemind.exe')
  assert.throws(() => resolveApeMindCliResources({}, 'linux', 'arm64', root), /invalid release lock/)
})

test('a bad download never becomes a package resource', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'apemind-cli-packaging-failure-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'resources'))
  writeFileSync(join(root, 'resources', 'apemind-cli.lock.json'), JSON.stringify({
    version: 'v9.9.9',
    commit: 'a'.repeat(40),
    artifacts: { 'darwin-arm64': { sha256: 'b'.repeat(64), url: 'https://example.invalid/apemind-darwin-arm64' } },
  }))
  t.mock.method(globalThis, 'fetch', async () => new Response('truncated binary'))
  await assert.rejects(prepareApeMindCli({}, 'darwin', 'arm64', root), /does not match/)
  assert.throws(() => resolveApeMindCliResources({}, 'darwin', 'arm64', root), /ENOENT/)
})
