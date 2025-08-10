export interface LockAdapter {
  acquire(docId: string, userId: string): Promise<{ ok: boolean; holder?: { userId: string; name?: string }; expiresAt?: number }>;
  renew(docId: string, userId: string): Promise<{ ok: boolean }>;
  release(docId: string, userId: string): Promise<{ ok: boolean }>;
  get(docId: string): Promise<{ locked: boolean; holder?: { userId: string; name?: string }; expiresAt?: number }>;
}

export function createRESTLockAdapter(config: {
  baseUrl: string;
  getAuthToken?: () => string | undefined;
}): LockAdapter {
  const headers = () => ({
    'Content-Type': 'application/json',
    ...(config.getAuthToken ? { Authorization: `Bearer ${config.getAuthToken()}` } : {}),
  });
  return {
    async acquire(docId, userId) {
      const res = await fetch(`${config.baseUrl}/locks/${encodeURIComponent(docId)}/acquire`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error(`acquire failed: ${res.status}`);
      return res.json();
    },
    async renew(docId, userId) {
      const res = await fetch(`${config.baseUrl}/locks/${encodeURIComponent(docId)}/renew`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error(`renew failed: ${res.status}`);
      return res.json();
    },
    async release(docId, userId) {
      const res = await fetch(`${config.baseUrl}/locks/${encodeURIComponent(docId)}/release`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error(`release failed: ${res.status}`);
      return res.json();
    },
    async get(docId) {
      const res = await fetch(`${config.baseUrl}/locks/${encodeURIComponent(docId)}`);
      if (!res.ok) throw new Error(`get failed: ${res.status}`);
      return res.json();
    },
  };
}

