import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { errorMessage, getQuests, isAuthError } from '../../services/api';
import type { QuestOverview } from '../../types/api';
import { useDiscovery } from '../discovery/DiscoveryProvider';

// The Quests tab's data. It lives on the server, so an active quest survives an app restart.
// Reloads whenever the screen is focused and whenever a quest action elsewhere changed something.
export function useQuests() {
  const { questsVersion } = useDiscovery();
  const [data, setData] = useState<QuestOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setData(await getQuests());
      setError('');
    } catch (e) {
      if (!isAuthError(e)) setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load, questsVersion]));
  return { data, error, loading, reload: load };
}
