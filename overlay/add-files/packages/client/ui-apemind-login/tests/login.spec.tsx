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
    t: (key: keyof typeof en, vars?: Record<string, string | number>) => {
      let value = en[key] as string
      for (const [name, replacement] of Object.entries(vars ?? {})) value = value.replace(`{${name}}`, String(replacement))
      return value
    },
  } as unknown as LoginSectionProps
  render(<LoginSection {...props} />)
}

const account: OAuthAccountView = {
  id: 'oauth-a',
  origin: 'https://apemind.ai',
  username: 'Alice',
  userId: 'alice',
  verifiedAt: '2026-09-15T00:00:00Z',
}

const connected: AccountState = {
  activeId: null,
  connections: [],
  oauthConnections: [account],
  oauth: account,
  cliVersion: 'v0.7.42',
  credentialStatus: { connectionId: account.id, available: true, error: null, storage: 'system' },
}

it('keeps the signed-out screen focused on login and opening ApeMind Web', async () => {
  renderLogin({ state: vi.fn(async () => ({ ok: true as const, value: { activeId: null, connections: [] } })) })
  expect(await screen.findByRole('heading', { name: en.connectTitle })).toBeTruthy()
  expect(screen.getByRole('button', { name: en.browserSignIn })).toBeTruthy()
  const web = screen.getByRole('link', { name: new RegExp(en.openApeMind) })
  expect(web.getAttribute('href')).toBe('https://apemind.ai')
  expect(web.getAttribute('target')).toBe('_blank')
  expect(screen.queryByText(/knowledge|model|workspace/i)).toBeNull()
})

it('shows the signed-in account, Web shortcut, reauthentication, and sign out', async () => {
  const remote = {
    state: vi.fn(async () => ({ ok: true as const, value: connected })),
    startBrowserLogin: vi.fn(async () => ({ ok: true as const, value: account })),
    oauthLogout: vi.fn(async () => ({ ok: true as const, value: undefined })),
  }
  renderLogin(remote)
  expect(await screen.findByRole('heading', { name: en.connected })).toBeTruthy()
  expect(screen.getByText('Alice')).toBeTruthy()
  expect(screen.getByRole('link', { name: new RegExp(en.openApeMind) }).getAttribute('href')).toBe('https://apemind.ai')
  expect(screen.queryByText(/knowledge|model|workspace/i)).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: en.signInAgain }))
  await waitFor(() => { expect(remote.startBrowserLogin).toHaveBeenCalledWith(account.origin, account.id) })
  fireEvent.click(screen.getByRole('button', { name: en.signOut }))
  await waitFor(() => { expect(remote.oauthLogout).toHaveBeenCalledWith(account.id) })
})

it('presents an API key connection as a connected account without data controls', async () => {
  const key = {
    id: 'key-a', origin: 'https://apemind.ai', userId: 'alice', username: 'Alice', verifiedAt: account.verifiedAt,
  }
  const state: AccountState = {
    activeId: key.id,
    connections: [key],
    credentialStatus: { connectionId: key.id, available: true, error: null, storage: 'encrypted-file' },
  }
  const remote = {
    state: vi.fn(async () => ({ ok: true as const, value: state })),
    disconnect: vi.fn(async () => ({ ok: true as const, value: { activeId: null, connections: [] } })),
  }
  renderLogin(remote)
  expect(await screen.findByRole('heading', { name: en.connected })).toBeTruthy()
  expect(screen.getByRole('link', { name: new RegExp(en.openApeMind) }).getAttribute('href')).toBe('https://apemind.ai')
  expect(screen.getByRole('button', { name: en.removeConnection })).toBeTruthy()
  expect(screen.queryByText(/knowledge|model|workspace/i)).toBeNull()
})

it('keeps an unreadable connection selected and offers recovery without exposing data controls', async () => {
  const state: AccountState = {
    activeId: null,
    connections: [],
    oauthConnections: [account],
    credentialStatus: { connectionId: account.id, available: false, error: 'credential_unavailable', storage: 'system' },
  }
  const remote = {
    state: vi.fn(async () => ({ ok: true as const, value: state })),
  }
  renderLogin(remote)
  expect(await screen.findByRole('heading', { name: en.credentialUnavailableTitle })).toBeTruthy()
  expect(screen.getByText(en.credentialUnavailableDescription)).toBeTruthy()
  expect(screen.getByRole('link', { name: new RegExp(en.openApeMind) })).toBeTruthy()
  expect(screen.queryByText(/knowledge|model|workspace/i)).toBeNull()
})

it('reauthenticates a saved connection and explains an account conflict', async () => {
  let state: AccountState = {
    activeId: null,
    connections: [],
    oauthConnections: [account],
    credentialStatus: { connectionId: account.id, available: false, error: 'reauthentication_required', storage: 'system' },
  }
  const remote = {
    state: vi.fn(async () => ({ ok: true as const, value: state })),
    startBrowserLogin: vi.fn(async (_origin: string, connectionId?: string) => {
      if (connectionId) return {
        ok: false as const,
        error: { code: 'gateway/bad-request', message: 'conflict', details: { cliCode: 'identity_changed' } },
      }
      state = connected
      return { ok: true as const, value: account }
    }),
  }
  renderLogin(remote)
  fireEvent.click(await screen.findByRole('button', { name: en.signInAgain }))
  await waitFor(() => { expect(screen.getByRole('heading', { name: en.accountConflictTitle })).toBeTruthy() })
  fireEvent.click(screen.getByRole('button', { name: en.useCurrentAccount }))
  await waitFor(() => {
    expect(remote.startBrowserLogin).toHaveBeenLastCalledWith(account.origin)
    expect(screen.getByRole('heading', { name: en.connected })).toBeTruthy()
  })
})

it('opens the active device authorization through the Host', async () => {
  let state: AccountState = { activeId: null, connections: [], browserLoginPending: true, loginProgress: {
    type: 'device_code', userCode: 'TEST-CODE',
    verificationUriComplete: 'https://apemind.ai/api/v2/oauth/device/verify?user_code=TEST-CODE',
  } }
  const remote = {
    state: vi.fn(async () => ({ ok: true as const, value: state })),
    openDevicePage: vi.fn(async () => ({ ok: true as const, value: undefined })),
    cancelBrowserLogin: vi.fn(async () => {
      state = { activeId: null, connections: [], browserLoginPending: false }
      return { ok: true as const, value: undefined }
    }),
  }
  renderLogin(remote)
  expect(await screen.findByRole('heading', { name: en.deviceWaitingTitle })).toBeTruthy()
  expect(screen.getByText('TEST-CODE').tagName).toBe('CODE')
  fireEvent.click(screen.getByRole('button', { name: en.openDevicePage }))
  await waitFor(() => { expect(remote.openDevicePage).toHaveBeenCalledWith() })
  fireEvent.click(screen.getByRole('button', { name: en.cancelSignIn }))
  await waitFor(() => { expect(remote.cancelBrowserLogin).toHaveBeenCalledWith() })
})

it('offers a copyable address when opening the device page fails', async () => {
  const address = 'https://apemind.ai/api/v2/oauth/device/verify'
  const remote = {
    state: vi.fn(async () => ({ ok: true as const, value: {
      activeId: null, connections: [], browserLoginPending: true,
      loginProgress: { type: 'device_code', userCode: 'TEST-CODE', verificationUri: address },
    } })),
    openDevicePage: vi.fn().mockRejectedValueOnce(new Error('private-process-diagnostic')).mockResolvedValue({ ok: true, value: undefined }),
  }
  renderLogin(remote)
  fireEvent.click(await screen.findByRole('button', { name: en.openDevicePage }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', en.openDevicePageError)
  expect(screen.getByLabelText<HTMLInputElement>(en.authorizationAddress).value).toBe(address)
  expect(screen.queryByText('private-process-diagnostic')).toBeNull()
})
