import type { DocState, VersionSnapshot } from '../types';

export interface StorageAdapter {
  getDocument(docId: string): Promise<DocState>;
  saveDocument(docId: string, state: DocState, baseVersion: number): Promise<{ version: number }>;
  listVersions(docId: string): Promise<VersionSnapshot[]>;
  saveVersion(docId: string, snapshot: VersionSnapshot): Promise<{ versionId: string }>;
}

export function createRESTStorageAdapter(config: {
  baseUrl: string;
  getAuthToken?: () => string | undefined;
}): StorageAdapter {
  const headers = () => ({
    'Content-Type': 'application/json',
    ...(config.getAuthToken ? { Authorization: `Bearer ${config.getAuthToken()}` } : {}),
  });

  return {
    async getDocument(docId) {
      const res = await fetch(`${config.baseUrl}/markup/docs/${encodeURIComponent(docId)}`, {
        headers: headers(),
      });
      if (!res.ok) throw new Error(`getDocument failed: ${res.status}`);
      return res.json();
    },
    async saveDocument(docId, state, baseVersion) {
      const res = await fetch(`${config.baseUrl}/markup/docs/${encodeURIComponent(docId)}`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ state, baseVersion, updatedBy: state.updatedBy }),
      });
      if (res.status === 409) throw new Error('version_conflict');
      if (!res.ok) throw new Error(`saveDocument failed: ${res.status}`);
      return res.json();
    },
    async listVersions(docId) {
      const res = await fetch(`${config.baseUrl}/markup/docs/${encodeURIComponent(docId)}/versions`, {
        headers: headers(),
      });
      if (!res.ok) throw new Error(`listVersions failed: ${res.status}`);
      return res.json();
    },
    async saveVersion(docId, snapshot) {
      const res = await fetch(`${config.baseUrl}/markup/docs/${encodeURIComponent(docId)}/versions`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ snapshot, name: snapshot.name, createdBy: snapshot.createdBy }),
      });
      if (!res.ok) throw new Error(`saveVersion failed: ${res.status}`);
      return res.json();
    },
  };
}

