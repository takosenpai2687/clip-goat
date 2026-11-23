import type { ClipGoatApi } from '../../shared/types';

declare global {
  interface Window {
    clipgoat: ClipGoatApi;
  }
}

declare module 'react' {
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}