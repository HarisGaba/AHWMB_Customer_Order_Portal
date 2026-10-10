/// <reference types="vite/client" />

declare const __SUPABASE_URL__: string
declare const __SUPABASE_ANON_KEY__: string

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_WHATSAPP_NUMBER?: string
  readonly VITE_SHOPKEEPER_WHATSAPP?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
