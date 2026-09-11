/** Read-only acceptance test. Supply the API key via stdin; never persist it. */
import { createInterface } from 'node:readline'
import assert from 'node:assert/strict'
import { AccountService } from '../overlay/add-files/packages/experimental/apemind-login/src/account-service.ts'
import { AccountError } from '../overlay/add-files/packages/experimental/apemind-login/src/api-client.ts'

const lines = createInterface({ input: process.stdin, terminal: false })
let key = ''
for await (const line of lines) { key = line.trim(); break }
lines.close(); process.stdin.pause()
if (!key) throw new Error('API key must be supplied via stdin')
let data: unknown
const service = new AccountService({
  read: async () => structuredClone(data),
  write: async value => { data = structuredClone(value) },
})
try {
  const state = await service.connect(process.argv[2] ?? 'https://apemind.ai', key)
  assert.equal(state.connections.length, 1)
  assert.ok(!JSON.stringify(state).includes(key))
  const account = state.connections[0]!
  console.log(JSON.stringify({ check: 'identity', passed: true, workspace: account.orgId ? 'organization' : 'personal' }))
  const result = await service.collections()
  assert.equal(result.account.id, state.activeId)
  assert.ok(!JSON.stringify(result).includes(key))
  console.log(JSON.stringify({ check: 'knowledge-base-access', passed: true, count: result.items.length }))
  await service.disconnect(state.activeId!)
  assert.deepEqual(await service.state(), { activeId: null, connections: [] })
  console.log(JSON.stringify({ check: 'local-disconnect', passed: true, serverKeyRevoked: false }))
} catch (error) {
  console.error(error instanceof AccountError ? `${error.code}: ${error.message}` : 'Live acceptance failed; no credentials or response bodies logged.')
  process.exitCode = 1
} finally { data = undefined; key = '' }
