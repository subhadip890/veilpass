/**
 * Tests for browserGlobals shim and Buffer polyfill.
 *
 * Verifies:
 * - globalThis.Buffer is available after loading browserGlobals shim
 * - Buffer operations needed by @midnight-ntwrk/compact-runtime (fromHex, toHex) work in browser environment
 * - Dynamic import of generated Contract succeeds without "Buffer is not defined" error
 */

import { describe, it, expect } from 'vitest';
import '../shims/browserGlobals';

describe('Browser Globals Shim & Buffer Polyfill', () => {
  it('installs globalThis.Buffer as a valid Buffer constructor', () => {
    expect(globalThis.Buffer).toBeDefined();
    expect(typeof globalThis.Buffer).toBe('function');
    expect(typeof globalThis.Buffer.from).toBe('function');
    expect(typeof globalThis.Buffer.isBuffer).toBe('function');
  });

  it('performs Buffer operations required by @midnight-ntwrk/compact-runtime (fromHex, toHex)', () => {
    const testHex = '2b1ccf76fd764dd005121c45ec1ff6a14e819b4387d455c9283a97f886eb37c2';

    // Test fromHex (as implemented in compact-runtime/dist/utils.js)
    const buf = globalThis.Buffer.from(testHex, 'hex');
    expect(globalThis.Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBe(32);

    // Test toHex (as implemented in compact-runtime/dist/utils.js)
    const hexOutput = globalThis.Buffer.from(buf).toString('hex');
    expect(hexOutput).toBe(testHex);
  });

  it('allows dynamic import of generated Contract after browserGlobals initialization', async () => {
    // Dynamic import of generated contract relies on compact-runtime which expects globalThis.Buffer
    const { Contract } = await import('../../../contracts/managed/veilpass/contract/index.js');
    expect(Contract).toBeDefined();
    expect(typeof Contract).toBe('function');

    // Instantiate with dummy witness to verify runtime descriptors evaluate without ReferenceError: Buffer is not defined
    const instance = new Contract({
      privateAge: () => [{}, 0n],
    });
    expect(instance).toBeDefined();
    expect(instance.circuits).toBeDefined();
    expect(typeof instance.circuits.checkEligibility).toBe('function');
  });
});
