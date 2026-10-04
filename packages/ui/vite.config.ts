import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the bundle works at any path (PCF route, sub-folder, file share), not only '/'.
  base: './',
  plugins: [react()],
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 1500 },
});
