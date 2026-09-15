// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AccountState, OAuthAccountView } from '@deepseek-ai/dsh-apemind-login/types'
import { LoginSection } from '../src/client/index.tsx'
import type { LoginSectionProps } from '../src/client/index.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function renderLogin(remote: unknown): void {
  const props = {
    login: { remote: { apemindAuth: remote } },
    t: (key: keyof typeof en) => en[key],
  } as unknown as LoginSectionProps
  render(<LoginSection {...props} />)
}

it('lets the user select the remaining saved account after signing out', async () => {
  const alice: OAuthAccountView = {
    id: 'oauth-a',
    origin: 'https://example.invalid',
    username: 'Alice',
    userId: 'a',
    activeWorkspaceId: null,
    verifiedAt: '2026-09-15T00:00:00Z',
    workspaces: [],
  }
  const bob: OAuthAccountView = { ...alice, id: 'oauth-b', username: 'Bob', userId: 'b' }
  let state: AccountState = {
    activeId: null,
    connections: [],
    oauthConnections: [alice, bob],
    oauth: alice,
  }
  const remote = {
    state: vi.fn(async () => ({ ok: true as const, value: state })),
    oauthLogout: vi.fn(async () => {
      state = { activeId: null, connections: [], oauthConnections: [bob], oauth: null }
      return { ok: true as const, value: undefined }
    }),
    select: vi.fn(async () => {
      state = { ...state, oauth: bob }
      return { ok: true as const, value: state }
    }),
  }
  renderLogin(remote)
  await waitFor(() => {
    expect(screen.getByLabelText<HTMLSelectElement>(en.currentConnection).disabled).toBe(false)
  })
  fireEvent.click(screen.getByRole('button', { name: en.signOut }))
  await waitFor(() => {
    expect(remote.oauthLogout).toHaveBeenCalledWith('oauth-a')
    const selector = screen.getByLabelText<HTMLSelectElement>(en.currentConnection)
    expect(selector.disabled).toBe(false)
    expect(selector.value).toBe('')
    expect(screen.queryByRole('option', { name: /Alice/ })).toBeNull()
  })
  fireEvent.change(screen.getByLabelText(en.currentConnection), { target: { value: 'oauth-b' } })
  await waitFor(() => {
    expect(remote.select).toHaveBeenCalledWith('oauth-b')
    expect(screen.getByText('Bob')).toBeTruthy()
    expect(screen.queryByLabelText(en.currentConnection)).toBeNull()
  })
})

const account: OAuthAccountView = {
  id: 'private-account',
  origin: 'https://private.example.invalid',
  username: 'Alice',
  userId: 'alice',
  activeWorkspaceId: null,
  verifiedAt: '2026-09-15T00:00:00Z',
  workspaces: [],
}

const connected: AccountState = {
  activeId: null,
  connections: [],
  oauthConnections: [account],
  oauth: account,
  cliVersion: 'v0.3.7',
  credentialStatus: { connectionId: account.id, available: true, error: null, storage: 'system' },
}

it('shows the bundled CLI version and the active connection storage', async () => {
  renderLogin({ state: vi.fn(async () => ({ ok: true as const, value: connected })) })
  expect(await screen.findByText('v0.3.7')).toBeTruthy()
  expect(screen.getByText(en.systemStorage)).toBeTruthy()
  expect(screen.getByRole('heading', { name: en.connected })).toBeTruthy()
})

it('keeps an unreadable connection selected and retries without logging in', async () => {
  let state: AccountState = {
    ...connected,
    oauth: null,
    credentialStatus: { connectionId: account.id, available: false, error: 'credential_unavailable', storage: 'system' },
  }
  const remote = {
    state: vi.fn(async () => ({ ok: true as const, value: state })),
    startBrowserLogin: vi.fn(),
  }
  renderLogin(remote)
  await waitFor(() => {
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.retryConnection }).disabled).toBe(false)
  })
  expect(screen.getByRole('heading', { name: en.credentialUnavailableTitle })).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toBe(en.credentialUnavailableDescription)
  expect(screen.getByLabelText<HTMLSelectElement>(en.currentConnection).value).toBe(account.id)
  expect(screen.queryByRole('button', { name: en.browserSignIn })).toBeNull()
  expect(screen.queryByRole('button', { name: en.signOut })).toBeNull()
  expect(screen.queryByRole('button', { name: en.viewKnowledge })).toBeNull()

  state = connected
  fireEvent.click(screen.getByRole('button', { name: en.retryConnection }))
  expect(await screen.findByRole('heading', { name: en.connected })).toBeTruthy()
  expect(remote.startBrowserLogin).not.toHaveBeenCalled()
  expect(screen.queryByRole('heading', { name: en.credentialUnavailableTitle })).toBeNull()
})

it('reauthenticates with the saved connection server rather than the default server', async () => {
  let state: AccountState = {
    ...connected,
    oauth: null,
    credentialStatus: { connectionId: account.id, available: false, error: 'reauthentication_required', storage: 'system' },
  }
  const remote = {
    state: vi.fn(async () => ({ ok: true as const, value: state })),
    startBrowserLogin: vi.fn(async () => {
      state = connected
      return { ok: true as const, value: account }
    }),
  }
  renderLogin(remote)
  await waitFor(() => {
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.signInAgain }).disabled).toBe(false)
  })
  expect(screen.getByRole('heading', { name: en.reauthenticationTitle })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.signInAgain }))
  await waitFor(() => { expect(remote.startBrowserLogin).toHaveBeenCalledWith(account.origin) })
  expect(await screen.findByRole('heading', { name: en.connected })).toBeTruthy()
})

it('shows an unreadable API key connection and its encrypted fallback storage', async () => {
  const state: AccountState = {
    activeId: null,
    connections: [{
      id: 'key-account',
      origin: account.origin,
      userId: account.userId,
      username: account.username,
      workspaceName: 'Finance',
      orgId: 'finance',
      role: 'reader',
      permissions: [],
      verifiedAt: account.verifiedAt,
    }],
    cliVersion: 'v0.3.7',
    credentialStatus: { connectionId: 'key-account', available: false, error: 'credential_unavailable', storage: 'encrypted-file' },
  }
  renderLogin({ state: vi.fn(async () => ({ ok: true as const, value: state })) })
  expect(await screen.findByRole('heading', { name: en.credentialUnavailableTitle })).toBeTruthy()
  expect(screen.getByText(en.encryptedFileStorage)).toBeTruthy()
  expect(screen.getByLabelText<HTMLSelectElement>(en.currentConnection).value).toBe('key-account')
  expect(screen.queryByRole('button', { name: en.signInAgain })).toBeNull()
  expect(screen.queryByRole('button', { name: en.browserSignIn })).toBeNull()
})
