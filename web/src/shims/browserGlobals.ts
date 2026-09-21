import { Buffer as BufferPolyfill } from 'buffer';

if (typeof globalThis.Buffer === 'undefined') {
  (globalThis as any).Buffer = BufferPolyfill;
}

export const Buffer = BufferPolyfill;
