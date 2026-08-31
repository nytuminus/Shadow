import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// O escritório 2D é servido pelo motor do Shadow em /office (mesmo padrão
// que as Salas usavam em /salas). O build cai em apps/server/public/office,
// que o Express já serve como estático.
export default defineConfig({
  plugins: [react()],
  base: '/office/',
  build: {
    outDir: '../server/public/office',
    emptyOutDir: true,
  },
  server: {
    // Durante `pnpm dev`, encaminha API e Socket.io pro motor na 4577.
    proxy: {
      '/api': 'http://localhost:4577',
      '/socket.io': { target: 'ws://localhost:4577', ws: true },
    },
  },
});
