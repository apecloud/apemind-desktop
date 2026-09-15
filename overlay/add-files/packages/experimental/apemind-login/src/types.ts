/** Public account projections. No credential values cross the Remote boundary. */
export interface AccountView {
  id: string
  origin: string
  userId: string
  username: string
  workspaceName: string
  orgId: string | null
  role: string | null
  permissions: string[]
  verifiedAt: string
}

export interface AccountState {
  activeId: string | null
  connections: AccountView[]
  oauthConnections?: OAuthAccountView[]
  oauth?: OAuthAccountView | null
  browserLoginPending?: boolean
  loginProgress?: LoginProgress | null
}

export interface LoginProgress {
  type: 'browser_opened' | 'device_code' | 'device_fallback'
  verificationUri?: string
  verificationUriComplete?: string
  userCode?: string
  reason?: string
}

export interface WorkspaceView {
  id: string
  type: 'personal' | 'organization'
  name: string
  status: string
  role: string | null
  permissions: string[]
}

export interface OAuthAccountView {
  id: string
  origin: string
  userId: string
  username: string
  verifiedAt: string
  activeWorkspaceId: string | null
  workspaces: WorkspaceView[]
}

export interface KnowledgeBaseView {
  id: string
  name: string
}

export interface KnowledgePage {
  items: KnowledgeBaseView[]
  nextCursor: string | null
}

/** Runtime marker keeps the public ./types export resolvable in webworker packs. */
export const APEMIND_LOGIN_TYPES = true
