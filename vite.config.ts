import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['5173-i1atsl7se9htbznee4537-53d5b3f1.manusvm.computer'],
  },
})
