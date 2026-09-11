/** Exercise the built Host plugin and actual dsh credential provider with a stdin-only key. */
import { createInterface } from 'node:readline'
import { mkdtemp, stat, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const root = resolve(process.argv[2] ?? 'work/dsh-desktop')
const moduleAt = path => import(pathToFileURL(join(root, path)).href)
const { Context } = await moduleAt('vendor/cordis/lib/index.js')
const { LocalCredentialProvider } = await moduleAt('packages/credentials/credentials-local/lib/index.js')
const plugin = await moduleAt('packages/experimental/apemind-login/lib/index.js')
const { remoteMethods } = await moduleAt('packages/typert/protocol/lib/index.js')
const lines = createInterface({ input: process.stdin, terminal: false })
let key = ''
for await (const line of lines) { key = line.trim(); break }
lines.close(); process.stdin.pause()
if (!key) throw new Error('Supply API key via stdin')
const dir = await mkdtemp(join(tmpdir(), 'apemind-built-login-'))
const file = join(dir, '.credentials.yaml')
const fibers = []
async function boot() {
  const ctx = new Context()
  const provider = ctx.plugin(LocalCredentialProvider, { path: file, watch: false })
  fibers.push(provider); await provider
  const auth = ctx.plugin(plugin)
  fibers.push(auth); await auth
  return ctx
}
try {
  const ctx = await boot()
  const controller = ctx.authorizationController
  assert.equal(controller.typertRemote.namespace, 'apemindAuth')
  assert.deepEqual(remoteMethods(controller).map(item => item.method).sort(), ['collections', 'connect', 'disconnect', 'select', 'state'])
  const state = await controller.connect('https://apemind.ai', key)
  assert.ok(!JSON.stringify(state).includes(key))
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  console.log('PASS: built plugin mounted, Remote registered, verified key stored with 0600 permissions')
  while (fibers.length) await fibers.pop().dispose()
  const restored = await boot()
  assert.equal((await restored.authorizationController.state()).activeId, state.activeId)
  const result = await restored.authorizationController.collections()
  assert.ok(!JSON.stringify(result).includes(key))
  console.log(`PASS: persisted connection restored; protected API returned ${result.items.length} item(s)`)
  await restored.authorizationController.disconnect(state.activeId)
  assert.equal((await restored.authorizationController.state()).connections.length, 0)
  assert.ok(!(await readFile(file, 'utf8')).includes(key))
  console.log('PASS: disconnect removed credential material; server key unchanged')
} catch {
  console.error('FAIL: built login acceptance did not complete; sensitive diagnostics suppressed')
  process.exitCode = 1
} finally {
  while (fibers.length) await fibers.pop().dispose()
  await rm(dir, { recursive: true, force: true })
  key = ''
}
