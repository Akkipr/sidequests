import { useCallback, useEffect, useState } from 'react';
import { getBlocks, isAuthError, unblock } from '../../services/api';
import type { BlockedEntry } from '../../types/api';

// Blocked players are deliberately anonymous: you can block someone before they ever reveal themselves.
export function useBlocks() {
  const [blocks, setBlocks] = useState<BlockedEntry[] | null>(null);
  const load = useCallback(() => {
    getBlocks().then(setBlocks, (e: unknown) => { if (!isAuthError(e)) setBlocks([]); });
  }, []);
  useEffect(load, [load]);
  const remove = useCallback(async (id: string) => { await unblock(id); load(); }, [load]);
  return { blocks, remove };
}
