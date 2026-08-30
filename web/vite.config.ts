import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// A área Salas é servida pelo próprio motor do Shadow em /salas, então os
// assets precisam resolver a partir daí (base). O build cai direto em
// ../public/salas, que o Express já serve como estático.
export default defineConfig({
  plugins: [react()],
  base: '/salas/',
  build: {
    outDir: '../public/salas',
    emptyOutDir: true,
  },
  server: {
    // Durante `npm run dev`, encaminha API e WebSocket pro motor na 4577.
    proxy: {
      '/api': 'http://localhost:4577',
      '/ws': { target: 'ws://localhost:4577', ws: true },
    },
  },
});
