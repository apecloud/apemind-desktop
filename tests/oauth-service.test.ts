import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AccountError, ApeMindClient } from '../overlay/add-files/packages/experimental/apemind-login/src/api-client.ts'
import { OAuthService } from '../overlay/add-files/packages/experimental/apemind-login/src/oauth-service.ts'

const ORIGIN = 'https://apemind.example'
const workspace = { id: 'personal:u1', type: 'personal', name: '个人空间', status: 'active', role: null, permissions: [] }
const stored = { origin: ORIGIN, userId: 'u1', username: 'Alice', verifiedAt: new Date().toISOString(),
  activeWorkspaceId: workspace.id, workspaces: [workspace], refreshToken: 'refresh-old-secret' }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
function setup(initial: unknown = undefined, custom?: (path: string, init?: RequestInit) => Promise<Response | undefined>, timeout = 1000) {
  let record = structuredClone(initial)
  const opened = deferred<URL>()
  const calls: string[] = []
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url.pathname)
    const override = await custom?.(url.pathname, init)
    if (override) return override
    if (url.pathname.endsWith('/token')) return Response.json({ access_token: 'access-secret', refresh_token: 'refresh-new-secret', expires_in: 600, scope: 'profile workspace.read collection.read' })
    if (url.pathname.endsWith('/revoke')) return Response.json({ revoked: true })
    if (url.pathname.endsWith('/user')) return Response.json({ id: 'u1', username: 'Alice' })
    if (url.pathname.endsWith('/workspaces')) return Response.json({ items: [workspace] })
    if (url.pathname.endsWith('/collections')) return Response.json({ items: [{ id: 'c1', title: 'Knowledge' }] })
    throw new Error('Unexpected request')
  }
  const service = new OAuthService({
    read: async () => structuredClone(record),
    write: async (value, expected) => { assert.deepEqual(record, expected); record = structuredClone(value) },
  }, new ApeMindClient(transport), async url => { opened.resolve(new URL(url)) }, timeout)
  return { service, opened, calls, read: () => record }
}
function callbackUrl(authorization: URL, path = '/callback') {
  const url = new URL(authorization.searchParams.get('redirect_uri')!)
  url.pathname = path
  url.search = new URLSearchParams({ code: 'one-time-code', state: authorization.searchParams.get('state')! }).toString()
  return url
}

test('browser scope, real loopback callback, durable success and secret-free view', async () => {
  const s = setup()
  const login = s.service.login(ORIGIN)
  const authorization = await s.opened.promise
  assert.equal(authorization.searchParams.get('scope'), 'profile workspace.read collection.read')
  assert.equal((await fetch(callbackUrl(authorization, '/unrelated'))).status, 404)
  const response = fetch(callbackUrl(authorization))
  const view = await login
  assert.equal((await response).status, 200)
  assert.equal(view.activeWorkspaceId, workspace.id)
  assert.equal((s.read() as typeof stored).refreshToken, 'refresh-new-secret')
  assert.ok(!JSON.stringify(view).includes('secret'))
  await s.service.logout()
  assert.equal(await s.service.state(), null)
  assert.ok(s.calls.includes('/api/v2/auth/desktop/revoke'))
})

test('device login opens verification URI, exchanges the device code and stores no secret in the view', async () => {
  const s = setup(undefined, async path => {
    if (path.endsWith('/device')) return Response.json({
      device_code: 'device-secret', user_code: 'ABCD-EFGH', verification_uri: `${ORIGIN}/api/v2/auth/desktop/device`,
      verification_uri_complete: `${ORIGIN}/api/v2/auth/desktop/device?user_code=ABCD-EFGH`, expires_in: 600, interval: 1,
    })
    if (path.endsWith('/token')) return Response.json({ access_token: 'access-secret', refresh_token: 'refresh-device-secret', expires_in: 600, scope: 'profile workspace.read collection.read' })
  })
  const login = s.service.deviceLogin(ORIGIN)
  const opened = await s.opened.promise
  assert.equal(opened.pathname, '/api/v2/auth/desktop/device')
  const view = await login
  assert.equal(view.activeWorkspaceId, workspace.id)
  assert.ok(!JSON.stringify(view).includes('refresh-device-secret'))
  assert.ok(s.calls.includes('/api/v2/auth/desktop/device'))
})

test('invalid and duplicate state are rejected without completing the valid attempt', async () => {
  const s = setup()
  const login = s.service.login(ORIGIN)
  const authorization = await s.opened.promise
  const bad = callbackUrl(authorization); bad.searchParams.append('state', 'attacker')
  assert.equal((await fetch(bad)).status, 400)
  const response = fetch(callbackUrl(authorization))
  await login; assert.equal((await response).status, 200)
})

test('cancel closes the loopback listener and never saves login', async () => {
  const s = setup()
  const login = s.service.login(ORIGIN)
  const rejected = assert.rejects(login, /取消/)
  const authorization = await s.opened.promise
  s.service.cancelLogin()
  await rejected
  assert.equal(s.read(), undefined)
  await assert.rejects(fetch(callbackUrl(authorization)))
})

test('timeout rejects and closes the loopback listener', async () => {
  const s = setup(undefined, undefined, 30)
  const login = s.service.login(ORIGIN)
  const rejected = assert.rejects(login, /超时/)
  const authorization = await s.opened.promise
  await rejected
  await assert.rejects(fetch(callbackUrl(authorization)))
})

test('logout during token exchange does not resurrect credentials', async () => {
  const release = deferred<Response>()
  const exchanging = deferred<void>()
  const s = setup(undefined, async path => {
    if (path.endsWith('/token')) { exchanging.resolve(); return release.promise }
  })
  const login = s.service.login(ORIGIN)
  const rejected = assert.rejects(login, /取消/)
  const authorization = await s.opened.promise
  const callback = fetch(callbackUrl(authorization))
  await exchanging.promise
  const logout = s.service.logout()
  release.resolve(Response.json({ access_token: 'access-secret', refresh_token: 'issued-secret', expires_in: 600, scope: 'profile workspace.read collection.read' }))
  await rejected; await logout
  assert.equal((await callback).status, 400)
  assert.equal(s.read(), undefined)
  assert.ok(s.calls.includes('/api/v2/auth/desktop/revoke'))
})

test('concurrent business calls serialize refresh rotation and preserve workspace header', async () => {
  const headers: string[] = []
  const s = setup(stored, async (path, init) => {
    if (path.endsWith('/collections')) headers.push(new Headers(init?.headers).get('X-ApeMind-Workspace-Id')!)
  })
  const [a, b] = await Promise.all([s.service.collections(), s.service.collections()])
  assert.equal(a.items[0].name, 'Knowledge'); assert.deepEqual(a, b)
  assert.equal(s.calls.filter(p => p.endsWith('/token')).length, 1)
  assert.deepEqual(headers, [workspace.id, workspace.id])
  assert.equal((s.read() as typeof stored).refreshToken, 'refresh-new-secret')
})

test('select revalidates membership and preserves selection on unavailable organization', async () => {
  const s = setup(stored)
  await assert.rejects(s.service.select('removed-org'), /已不可用/)
  assert.equal((s.read() as typeof stored).activeWorkspaceId, workspace.id)
  assert.ok(s.calls.some(p => p.endsWith('/workspaces')))
})

test('invalid grant clears local login, network outage preserves credentials', async () => {
  const expired = setup(stored, async path => path.endsWith('/token') ? Response.json({}, { status: 400 }) : undefined)
  await assert.rejects(expired.service.collections(), /已过期或被撤销/)
  assert.equal(await expired.service.state(), null)
  const offline = setup(stored, async () => { throw new Error('transport unavailable') })
  await assert.rejects(offline.service.collections(), /无法连接/)
  assert.deepEqual(offline.read(), stored)
})

test('bad stored shape is rejected and never overwritten', async () => {
  const s = setup({ refreshToken: 'secret', origin: ORIGIN })
  await assert.rejects(s.service.state(), AccountError)
  assert.deepEqual(s.read(), { refreshToken: 'secret', origin: ORIGIN })
})
