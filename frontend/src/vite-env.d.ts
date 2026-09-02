/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_URL_BASE: string
  readonly VITE_SYSTEM_KEY: string
  readonly VITE_AUTH_TRANSITION_DELAY_MS?: string
  // IDs de apps/configuraciones/management/commands/seed_statuses.json (tabla cfg_status).
  readonly VITE_STATUS_ACTIVATE: string
  readonly VITE_STATUS_INACTIVATE: string
  readonly VITE_STATUS_BLOCK: string
  readonly VITE_STATUS_DELETE: string
  readonly VITE_STATUS_VOID: string
  readonly VITE_STATUS_CURRENT: string
  readonly VITE_STATUS_EXPIRE: string
  readonly VITE_STATUS_RESTORE: string
  readonly VITE_STATUS_RESET: string
  readonly VITE_STATUS_SYNC: string
  readonly VITE_STATUS_PENDING: string
  readonly VITE_STATUS_UPDATE: string
  readonly VITE_STATUS_APPROVE: string
  readonly VITE_STATUS_REJECT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
