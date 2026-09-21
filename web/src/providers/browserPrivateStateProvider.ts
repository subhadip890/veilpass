/**
 * Browser-safe private-state provider for VeilPass on Preprod.
 * Strictly namespaced, uses localStorage with an in-memory fallback.
 * Avoids native LevelDB Node bindings in the browser.
 */

import type {
  PrivateStateProvider,
  PrivateStateId,
  ExportPrivateStatesOptions,
  PrivateStateExport,
  ImportPrivateStatesOptions,
  ImportPrivateStatesResult,
  ExportSigningKeysOptions,
  SigningKeyExport,
  ImportSigningKeysOptions,
  ImportSigningKeysResult,
} from '@midnight-ntwrk/midnight-js-types';
import type { ContractAddress, SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';

export class BrowserPrivateStateProvider<PSI extends PrivateStateId = PrivateStateId, PS = any>
  implements PrivateStateProvider<PSI, PS>
{
  private contractAddress: ContractAddress | null = null;
  private readonly memoryStore = new Map<string, string>();

  constructor(readonly namespace: string = 'veilpass-preprod') {}

  private getStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; keys(): string[] } {
    if (typeof window !== 'undefined' && window.localStorage) {
      return {
        getItem: (k) => window.localStorage.getItem(k),
        setItem: (k, v) => window.localStorage.setItem(k, v),
        removeItem: (k) => window.localStorage.removeItem(k),
        keys: () => Object.keys(window.localStorage),
      };
    }
    return {
      getItem: (k) => this.memoryStore.get(k) ?? null,
      setItem: (k, v) => this.memoryStore.set(k, v),
      removeItem: (k) => { this.memoryStore.delete(k); },
      keys: () => Array.from(this.memoryStore.keys()),
    };
  }

  setContractAddress(contractAddress: ContractAddress): void {
    this.contractAddress = contractAddress;
  }

  private stateKey(id: PSI): string {
    const addr = this.contractAddress ?? 'uninitialized';
    return `${this.namespace}:state:${addr}:${String(id)}`;
  }

  private signingKeyKey(address: ContractAddress): string {
    return `${this.namespace}:signingKey:${address}`;
  }

  async set(privateStateId: PSI, state: PS): Promise<void> {
    const key = this.stateKey(privateStateId);
    this.getStorage().setItem(key, JSON.stringify(state));
  }

  async get(privateStateId: PSI): Promise<PS | null> {
    const key = this.stateKey(privateStateId);
    const item = this.getStorage().getItem(key);
    if (!item) return null;
    try {
      return JSON.parse(item) as PS;
    } catch {
      return null;
    }
  }

  async remove(privateStateId: PSI): Promise<void> {
    const key = this.stateKey(privateStateId);
    this.getStorage().removeItem(key);
  }

  async clear(): Promise<void> {
    const storage = this.getStorage();
    const prefix = `${this.namespace}:state:`;
    for (const key of storage.keys()) {
      if (key.startsWith(prefix)) {
        storage.removeItem(key);
      }
    }
  }

  async setSigningKey(address: ContractAddress, signingKey: SigningKey): Promise<void> {
    const key = this.signingKeyKey(address);
    this.getStorage().setItem(key, JSON.stringify(signingKey));
  }

  async getSigningKey(address: ContractAddress): Promise<SigningKey | null> {
    const key = this.signingKeyKey(address);
    const item = this.getStorage().getItem(key);
    if (!item) return null;
    try {
      return JSON.parse(item) as SigningKey;
    } catch {
      return null;
    }
  }

  async removeSigningKey(address: ContractAddress): Promise<void> {
    const key = this.signingKeyKey(address);
    this.getStorage().removeItem(key);
  }

  async clearSigningKeys(): Promise<void> {
    const storage = this.getStorage();
    const prefix = `${this.namespace}:signingKey:`;
    for (const key of storage.keys()) {
      if (key.startsWith(prefix)) {
        storage.removeItem(key);
      }
    }
  }

  async exportPrivateStates(_options?: ExportPrivateStatesOptions): Promise<PrivateStateExport> {
    const storage = this.getStorage();
    const prefix = `${this.namespace}:state:`;
    const states: Record<string, string> = {};
    for (const key of storage.keys()) {
      if (key.startsWith(prefix)) {
        const val = storage.getItem(key);
        if (val) states[key] = val;
      }
    }
    return { version: 1, states } as unknown as PrivateStateExport;
  }

  async importPrivateStates(exportData: PrivateStateExport, _options?: ImportPrivateStatesOptions): Promise<ImportPrivateStatesResult> {
    const storage = this.getStorage();
    let imported = 0;
    const states = (exportData as any)?.states ?? {};
    for (const [key, val] of Object.entries(states)) {
      if (typeof val === 'string') {
        storage.setItem(key, val);
        imported++;
      }
    }
    return { imported, skipped: 0, overwritten: imported } as unknown as ImportPrivateStatesResult;
  }

  async exportSigningKeys(_options?: ExportSigningKeysOptions): Promise<SigningKeyExport> {
    return { version: 1, keys: {} } as unknown as SigningKeyExport;
  }

  async importSigningKeys(_exportData: SigningKeyExport, _options?: ImportSigningKeysOptions): Promise<ImportSigningKeysResult> {
    return { imported: 0, skipped: 0, overwritten: 0 } as unknown as ImportSigningKeysResult;
  }
}

export function createBrowserPrivateStateProvider(namespace = 'veilpass-preprod'): BrowserPrivateStateProvider {
  return new BrowserPrivateStateProvider(namespace);
}
