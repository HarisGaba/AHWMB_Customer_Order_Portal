/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SHOPKEEPER_WHATSAPP?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
