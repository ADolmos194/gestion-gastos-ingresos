import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    // El backend (backend/.env CORS_ALLOWED_ORIGINS / CSRF_TRUSTED_ORIGINS) solo
    // confía en http://localhost:3000; strictPort evita que Vite cambie de puerto
    // en silencio y rompa CORS/CSRF si el 3000 está ocupado.
    port: 3000,
    strictPort: true,
  },
})
