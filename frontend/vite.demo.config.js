import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Static, serverless build of the demo: relative paths, everything in one JS file.
export default defineConfig({
  plugins: [react()],
  base: './',
  define: { 'import.meta.env.VITE_DEMO': JSON.stringify('1') },
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: { output: { inlineDynamicImports: true, entryFileNames: 'assets/app.js', assetFileNames: 'assets/[name][extname]' } },
  },
})
