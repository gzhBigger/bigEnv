import type { Bridge } from '../../shared/types';
import { createMockBridge } from './mock';

const native = typeof window !== 'undefined' ? window.bigenv : undefined;

/** True when running inside Electron with the preload bridge attached. */
export const isDesktop = Boolean(native);

export const bridge: Bridge = native ?? createMockBridge();
