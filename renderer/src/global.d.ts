import type { ClipGoatApi } from '../../shared/types';

declare global {
  /** Version from package.json, filled in at build time. */
  const __APP_VERSION__: string;
  interface Window {
    clipgoat: ClipGoatApi;
  }
}

declare module 'react' {
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}