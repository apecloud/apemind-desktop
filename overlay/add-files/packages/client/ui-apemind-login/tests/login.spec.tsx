// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AccountState, OAuthAccountView } from '@deepseek-ai/dsh-apemind-login/types'
import { LoginSection } from '../src/client/index.tsx'
import type { LoginSectionProps } from '../src/client/index.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

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
  const props = {
    login: { remote: { apemindAuth: remote } },
    t: (key: keyof typeof en) => en[key],
  } as unknown as LoginSectionProps
  render(<LoginSection {...props} />)
  await waitFor(() => {
    expect((screen.getByLabelText(en.currentConnection) as HTMLSelectElement).disabled).toBe(false)
  })
  fireEvent.click(screen.getByRole('button', { name: en.signOut }))
  await waitFor(() => {
    expect(remote.oauthLogout).toHaveBeenCalledWith('oauth-a')
    const selector = screen.getByLabelText(en.currentConnection) as HTMLSelectElement
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
