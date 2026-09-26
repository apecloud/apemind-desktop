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

it('opens the current device authorization through the Host while login is pending', async () => {
  let state: AccountState = { activeId: null, connections: [] }
  let finishLogin: (value: unknown) => void = () => {}
  const remote = {
    state: vi.fn(async () => ({ ok: true as const, value: state })),
    startDeviceLogin: vi.fn(() => {
      state = { ...state, browserLoginPending: true, loginProgress: {
        type: 'device_code', userCode: 'TEST-CODE',
        verificationUriComplete: 'https://example.invalid/api/v2/oauth/device/verify?user_code=TEST-CODE',
      } }
      return new Promise((resolve) => { finishLogin = resolve })
    }),
    openDevicePage: vi.fn(async () => ({ ok: true })),
    cancelBrowserLogin: vi.fn(async () => {
      state = { activeId: null, connections: [], browserLoginPending: false }
      finishLogin({ ok: false, error: { code: 'gateway/cancelled' } })
      return { ok: true }
    }),
  }
  renderLogin(remote)
  await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: en.deviceFallback }).disabled).toBe(false) })
  fireEvent.click(screen.getByRole('button', { name: en.deviceFallback }))
  const open = await screen.findByRole('button', { name: en.openDevicePage })
  expect(screen.getByRole('heading', { name: en.deviceWaitingTitle })).toBeTruthy()
  expect(screen.getByText('TEST-CODE').tagName).toBe('CODE')
  expect(screen.queryByText(en.waitingDescription)).toBeNull()
  expect(screen.queryByRole('link', { name: en.openDevicePage })).toBeNull()
  fireEvent.click(open)
  await waitFor(() => { expect(remote.openDevicePage).toHaveBeenCalledWith() })
  expect(remote.startDeviceLogin).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: en.cancelSignIn }))
  expect(await screen.findByRole('button', { name: en.browserSignIn })).toBeTruthy()
  expect(screen.queryByText('TEST-CODE')).toBeNull()
})

it('keeps the device code and offers a copyable address after opening fails', async () => {
  const address = 'https://example.invalid/api/v2/oauth/device/verify'
  const remote = {
    state: vi.fn(async () => ({ ok: true as const, value: {
      activeId: null, connections: [], browserLoginPending: true,
      loginProgress: { type: 'device_code', userCode: 'TEST-CODE', verificationUri: address },
    } })),
    openDevicePage: vi.fn().mockRejectedValueOnce(new Error('private-process-diagnostic')).mockResolvedValue({ ok: true }),
  }
  renderLogin(remote)
  fireEvent.click(await screen.findByRole('button', { name: en.openDevicePage }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', en.openDevicePageError)
  expect(screen.getByLabelText<HTMLInputElement>(en.authorizationAddress).value).toBe(address)
  expect(screen.getByLabelText<HTMLInputElement>(en.authorizationAddress).readOnly).toBe(true)
  expect(screen.getByText('TEST-CODE')).toBeTruthy()
  expect(screen.queryByText('private-process-diagnostic')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.openDevicePage }))
  await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
  expect(remote.openDevicePage).toHaveBeenCalledTimes(2)
})

it('explains an account with no workspace and offers recovery actions', async () => {
  const emptyAccount: OAuthAccountView = { ...account, origin: 'https://apemind.example.com' }
  let state: AccountState = { ...connected, oauth: emptyAccount, oauthConnections: [emptyAccount] }
  const remote = {
    state: vi.fn(async () => ({ ok: true as const, value: state })),
    refreshWorkspaces: vi.fn(async () => emptyAccount),
  }
  renderLogin(remote)
  expect(await screen.findByRole('heading', { name: en.noWorkspacesTitle })).toBeTruthy()
  expect(screen.getByText(en.noWorkspacesDescription)).toBeTruthy()
  expect(screen.getByRole('link', { name: new RegExp(en.openApeMind) })).toHaveAttribute('href', emptyAccount.origin)
  fireEvent.click(screen.getByRole('button', { name: en.emptyRefreshWorkspaces }))
  await waitFor(() => { expect(remote.refreshWorkspaces).toHaveBeenCalledWith(emptyAccount.id) })
})

it('shows a retained personal workspace in the available workspace list', async () => {
  const personalAccount: OAuthAccountView = {
    ...account,
    activeWorkspaceId: 'personal:alice',
    workspaces: [{
      id: 'personal:alice', type: 'personal', name: 'Alice space', status: 'active', role: null, permissions: [],
    }],
  }
  const state: AccountState = { ...connected, oauth: personalAccount, oauthConnections: [personalAccount] }
  renderLogin({ state: vi.fn(async () => ({ ok: true as const, value: state })) })
  expect(await screen.findByText('Alice space')).toBeTruthy()
  expect(screen.getByText(en.personalSpace)).toBeTruthy()
  expect(screen.getByText(en.currentBadge)).toBeTruthy()
})
