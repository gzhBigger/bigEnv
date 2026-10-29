import type { Bridge } from './types';

declare global {
  interface Window {
    bigenv?: Bridge;
  }
}

export {};
