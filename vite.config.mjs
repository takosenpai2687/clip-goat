import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  'media-src media: blob:',
  "connect-src 'self' media:",
].join('; ');

export default defineConfig(({ command }) => ({
  root: 'renderer',
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    {
      // The dev server needs inline scripts for HMR, so the policy is only applied to the packaged page.
      name: 'clip-goat-csp',
      transformIndexHtml: (html) =>
        html.replace('<!--csp-->', command === 'build' ? `<meta http-equiv="Content-Security-Policy" content="${CSP}" />` : ''),
    },
  ],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { host: '127.0.0.1', port: 5173 },
}));
