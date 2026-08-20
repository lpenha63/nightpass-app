import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

// A identidade do build vem pronta de build-id.js (roda antes, no npm run build).
// Ler em vez de recalcular é o que garante que o bundle e o version.json digam
// exatamente a mesma coisa — se divergissem, o app avisaria "nova versão" sem parar.
const id = JSON.parse(readFileSync('./build-id.json', 'utf8'))
const APP_BUILD: string = id.build
const APP_VERSION: string = id.version

export default defineConfig({
  define: {
    __APP_BUILD__: JSON.stringify(APP_BUILD),
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'index-src.html',
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      }
    }
  },
  server: {
    port: 3000,
    open: true
  }
})
