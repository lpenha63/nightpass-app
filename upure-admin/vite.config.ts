import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Duas entradas no mesmo deploy:
//   index.html    → painel interno (exige is_saas_admin)
//   cadastro.html → página pública de cadastro, servindo TODOS os apps via ?app=
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        cadastro: resolve(__dirname, 'cadastro.html'),
      },
    },
  },
})
