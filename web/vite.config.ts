import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import path from 'path';

export default defineConfig({
  plugins: [wasm(), react()],
  resolve: {
    alias: {
      'isomorphic-ws': path.resolve(__dirname, 'src/shims/isomorphic-ws.ts'),
      assert: path.resolve(__dirname, 'src/shims/assert.ts'),
    },
    dedupe: ['@midnight-ntwrk/midnight-js-network-id'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: true,
  },
});
