import type { NavigatorScreenParams } from '@react-navigation/native';
import type { Quest, QuestRun } from '../../types/api';

export type OnboardingParams = { Onboarding: undefined; SignIn: undefined };
export type TabParams = { Discover: undefined; Quests: undefined; Profile: undefined };

// Signed out: only `Auth`. Signed in: `Main` (tabs), with `Match` and `QuestDetail` presented above it.
export type RootParams = {
  Auth: NavigatorScreenParams<OnboardingParams> | undefined;
  Main: NavigatorScreenParams<TabParams> | undefined;
  Match: undefined;
  QuestDetail: { quest: Quest; run?: QuestRun; alternatives?: Quest[] };
};
