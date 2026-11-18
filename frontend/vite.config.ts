import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const nodeEnv = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const api = nodeEnv.VITE_API_PROXY || 'http://localhost:3000';
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true, proxy: { '/api': { target: api, changeOrigin: true } } },
  preview: { port: 5173, proxy: { '/api': { target: api, changeOrigin: true } } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'], include: ['src/**/*.test.{ts,tsx}'] },
});
