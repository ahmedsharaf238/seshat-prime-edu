import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  esbuild: {
    // هذا السطر يخبر Vite بمعاملة أي ملف .js على أنه .jsx
    loader: 'jsx',
    include: /src\/.*\.jsx?$/,
    exclude: [],
  },
})