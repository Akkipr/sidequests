// Shapes returned by / sent to the server (see server/routes). One place, no `any`.
export type Status = 'off' | 'open' | 'food' | 'hour';
export type Intent = Exclude<Status, 'off'>;
export type Budget = 'free' | 'low' | 'any';

export type Profile = {
  nickname: string;
  avatar: string;
  archetypes: string[];
  answers: Record<string, string>;
  wants: string[];
  budget: Budget;
  status: Status;
  points: number;
};
export type ProfileInput = Pick<Profile, 'avatar' | 'archetypes' | 'answers' | 'wants' | 'budget'>;
export type SignupInput = ProfileInput & { nickname: string; password: string };

export type Quest = {
  id: number; title: string; description: string; location: string; starts: string; cost: string; minutes: number;
};
export type QuestStatus = 'selected' | 'active' | 'completed';
export type QuestRun = {
  matchId: number; status: QuestStatus; quest: Quest;
  partner: { nickname: string; avatar: string } | null;
  startedAt: string | null; completedAt: string | null;
};
export type QuestOverview = { active: QuestRun | null; suggested: Quest[]; history: QuestRun[] };

export type MatchStatus = 'pending' | 'revealed' | 'declined';
export type MatchView = {
  id: number; score: number; reason: string; shared: string[];
  myResponse: boolean | null; status: MatchStatus;
  // Identity and quests are null/empty until BOTH people have waved (enforced by the server).
  other: { nickname: string; avatar: string; archetypes: string[] } | null;
  quests: Quest[];
  questId: number | null; questStatus: QuestStatus | null;
};

export type SignalPayload = { detectedWearableToken: string; rssi: number; timestamp: number } | Record<string, never>;
export type SignalResult = { matchId: number | null; reason?: string };
export type BlockedEntry = { id: string; created_at: string };
