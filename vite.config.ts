import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    // Tailwind is only used by the POS (src/pos); its stylesheet loads only on /pos.
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src/pos', import.meta.url)) },
    },
    define: {
      __SUPABASE_URL__: JSON.stringify(env.VITE_SUPABASE_URL || env.SUPABASE_URL || ''),
      __SUPABASE_ANON_KEY__: JSON.stringify(env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || ''),
    },
    build: {
      target: 'es2020',
    },
  }
})
