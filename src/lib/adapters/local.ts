import type { DocState, VersionSnapshot } from '../types';
import type { StorageAdapter } from './storage';
import type { LockAdapter } from './lock';

function docKey(docId: string) { return `markup:doc:${docId}`; }
function verKey(docId: string) { return `markup:versions:${docId}`; }

export function createLocalAdapters(): { storageAdapter: StorageAdapter; lockAdapter: LockAdapter } {
  const storageAdapter: StorageAdapter = {
    async getDocument(docId) {
      const raw = localStorage.getItem(docKey(docId));
      if (!raw) throw new Error('not_found');
      return JSON.parse(raw) as DocState;
    },
    async saveDocument(docId, state, baseVersion) {
      // Merge image if omitted
      let prev: DocState | undefined;
      try { prev = await this.getDocument(docId); } catch {}
      const next: DocState = {
        ...(prev ?? state),
        ...state,
        image: state.image ?? prev?.image,
        version: (prev?.version ?? 0) + 1,
        updatedAt: Date.now(),
      };
      localStorage.setItem(docKey(docId), JSON.stringify(next));
      return { version: next.version };
    },
    async listVersions(docId) {
      const raw = localStorage.getItem(verKey(docId));
      return raw ? (JSON.parse(raw) as VersionSnapshot[]) : [];
    },
    async saveVersion(docId, snapshot) {
      const list = await this.listVersions(docId);
      const id = `${docId}-${Date.now()}`;
      const saved = { ...snapshot, id };
      localStorage.setItem(verKey(docId), JSON.stringify([saved, ...list]));
      return { versionId: id };
    },
  };

  const lockAdapter: LockAdapter = {
    async acquire() { return { ok: true, expiresAt: Date.now() + 60_000 }; },
    async renew() { return { ok: true }; },
    async release() { return { ok: true }; },
    async get() { return { locked: false }; },
  };

  return { storageAdapter, lockAdapter };
}

