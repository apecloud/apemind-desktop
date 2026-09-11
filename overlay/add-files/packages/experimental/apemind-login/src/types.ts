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
}

export interface KnowledgeBaseView {
  id: string
  name: string
}
