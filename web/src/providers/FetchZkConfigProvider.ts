/**
 * FetchZkConfigProvider — loads ZK artifacts in the browser via standard fetch.
 * Uses public assets copied to web/public/midnight/veilpass/.
 */

import {
  ZKConfigProvider,
  createProverKey,
  createVerifierKey,
  createZKIR,
  type ProverKey,
  type VerifierKey,
  type ZKIR,
} from '@midnight-ntwrk/midnight-js-types';

export class FetchZkConfigProvider<K extends string = string> extends ZKConfigProvider<K> {
  constructor(readonly baseUrl: string = '/midnight/veilpass') {
    super();
  }

  async getProverKey(circuitId: K): Promise<ProverKey> {
    const url = `${this.baseUrl}/keys/${circuitId}.prover`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch prover key from ${url}: ${res.status} ${res.statusText}`);
    }
    const buffer = await res.arrayBuffer();
    return createProverKey(new Uint8Array(buffer));
  }

  async getVerifierKey(circuitId: K): Promise<VerifierKey> {
    const url = `${this.baseUrl}/keys/${circuitId}.verifier`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch verifier key from ${url}: ${res.status} ${res.statusText}`);
    }
    const buffer = await res.arrayBuffer();
    return createVerifierKey(new Uint8Array(buffer));
  }

  async getZKIR(circuitId: K): Promise<ZKIR> {
    const url = `${this.baseUrl}/zkir/${circuitId}.bzkir`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch ZKIR from ${url}: ${res.status} ${res.statusText}`);
    }
    const buffer = await res.arrayBuffer();
    return createZKIR(new Uint8Array(buffer));
  }
}
