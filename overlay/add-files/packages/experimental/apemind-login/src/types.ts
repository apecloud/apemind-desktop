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
  oauth?: OAuthAccountView | null
  browserLoginPending?: boolean
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
