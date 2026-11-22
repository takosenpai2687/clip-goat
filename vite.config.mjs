import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
