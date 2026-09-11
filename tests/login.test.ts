import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApeMindClient, normalizeOrigin } from '../overlay/add-files/packages/experimental/apemind-login/src/api-client.ts'
import { AccountService } from '../overlay/add-files/packages/experimental/apemind-login/src/account-service.ts'

const origin = 'https://example.test'
const key = 'test-only-fake-api-key'
const user = { id: 'u1', username: 'Tester', bound_org_id: null }
const orgUser = { ...user, bound_org_id: 'org1', bound_org_role: 'member', bound_org_permissions: ['knowledge_base.read'] }
const org = { id: 'org1', name: 'org1', display_name: '组织一', status: 'active' }
function clientWith(respond: (path: string, init: RequestInit) => Response | Promise<Response>) {
  return new ApeMindClient((async (input, init) => respond(String(input), init!)) as typeof fetch)
}
function store() {
  let data: unknown
  return { read: async () => structuredClone(data), write: async (value: unknown) => { data = structuredClone(value) } }
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

test('origin rejects credentials, insecure transport, paths and query', () => {
  for (const raw of ['http://example.test', 'https://u:p@example.test', 'https://example.test/path', 'https://example.test?key=x', 'file:///tmp']) assert.throws(() => normalizeOrigin(raw))
  assert.equal(normalizeOrigin(' https://example.test/ '), origin)
})

test('validates with bearer only, denies redirects and returns no key', async () => {
  const service = new AccountService(store(), clientWith((url, init) => {
    assert.equal(url, `${origin}/api/v2/auth/user`)
    assert.equal((init.headers as Record<string, string>).Authorization, `Bearer ${key}`)
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit')
    assert.ok(init.signal)
    return json(user)
  }))
  const result = await service.connect(origin, key)
  assert.equal(result.connections[0].workspaceName, '个人空间')
  assert.equal(result.connections[0].userId, 'u1')
  assert.ok(result.activeId)
  assert.ok(!JSON.stringify(result).includes(key))
})

test('failed verification preserves existing credentials and active connection', async () => {
  let rejected = false
  const storage = store()
  const service = new AccountService(storage, clientWith(() => rejected ? json({ secret: key }, 401) : json(user)))
  const before = await service.connect(origin, key)
  rejected = true
  await assert.rejects(service.connect(origin, 'invalid'), error => error instanceof Error && !error.message.includes(key))
  assert.deepEqual(await service.state(), before)
})

test('org name is verified by exact bound id; suspended org and missing membership fail', async () => {
  for (const data of [{ ...org, status: 'suspended' }, { ...org, id: 'other' }]) {
    const client = clientWith(url => json(url.endsWith('/auth/user') ? orgUser : data))
    await assert.rejects(client.verify(origin, key))
  }
  await assert.rejects(clientWith(() => json({ ...orgUser, bound_org_role: null })).verify(origin, key))
  const result = await clientWith(url => json(url.endsWith('/auth/user') ? orgUser : org)).verify(origin, key)
  assert.equal(result.workspaceName, '组织一')
})

test('old server without scope projection fails closed', async () => {
  await assert.rejects(clientWith(() => json({ id: 'u1', username: 'Tester' })).verify(origin, key))
})

test('HTTP, protocol and network errors do not leak server secrets', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(clientWith(() => json({ error: key }, status)).verify(origin, key), error => error instanceof Error && !error.message.includes(key))
  }
  await assert.rejects(clientWith(() => { throw new Error(key) }).verify(origin, key), error => error instanceof Error && !error.message.includes(key))
  await assert.rejects(clientWith(() => new Response('not json')).verify(origin, key))
})

test('switching uses target credential and protected request uses server bound workspace', async () => {
  const storage = store()
  const calls: string[] = []
  const client = clientWith((url, init) => {
    const auth = (init.headers as Record<string, string>).Authorization
    calls.push(`${url} ${auth}`)
    if (url.endsWith('/auth/user')) return json(auth === 'Bearer org-key' ? orgUser : user)
    if (url.endsWith('/organizations/org1')) return json(org)
    assert.ok(!url.includes('org_id=')); assert.ok(url.includes('include_subscribed=false'))
    assert.equal(auth, 'Bearer org-key')
    return json({ items: [{ id: 'kb1', title: '知识库一', key: 'must-not-return' }] })
  })
  const service = new AccountService(storage, client)
  const personal = await service.connect(origin, key)
  const connected = await service.connect(origin, 'org-key')
  await service.select(personal.activeId!)
  await service.select(connected.activeId!)
  const result = await service.collections()
  assert.deepEqual(result.items, [{ id: 'kb1', name: '知识库一' }])
  assert.equal(result.account.orgId, 'org1')
  assert.ok(!JSON.stringify(result).includes('org-key'))
  assert.equal((await new AccountService(storage, client).state()).activeId, connected.activeId)
})

test('disconnect clears selection without activating another identity', async () => {
  const service = new AccountService(store(), clientWith(() => json(user)))
  await service.connect(origin, key)
  const current = await service.connect('https://other.test', key)
  const after = await service.disconnect(current.activeId!)
  assert.equal(after.activeId, null); assert.equal(after.connections.length, 1)
  await assert.rejects(service.collections())
})

test('queued disconnect cannot be undone by slow connection verification', async () => {
  let unblock: (() => void) | undefined
  const wait = new Promise<void>(resolve => { unblock = resolve })
  let slow = false
  const service = new AccountService(store(), clientWith(async () => { if (slow) await wait; return json(user) }))
  const first = await service.connect(origin, key)
  slow = true
  const reverify = service.select(first.activeId!)
  const disconnect = service.disconnect(first.activeId!)
  unblock!()
  await reverify; await disconnect
  assert.deepEqual(await service.state(), { activeId: null, connections: [] })
})

test('storage failure is propagated instead of reporting success', async () => {
  const service = new AccountService({ read: async () => undefined, write: async () => { throw new Error('disk unavailable') } }, clientWith(() => json(user)))
  await assert.rejects(service.connect(origin, key))
})
