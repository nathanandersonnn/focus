export type Outcome = "completed" | "abandoned";

export type Pause = { from: string; to: string };

export type Block = { app: string; at: string; killed: boolean };

export type Session = {
  id: string;
  localDate: string;
  startedAt: string;
  endedAt: string;
  plannedMin: number;
  focusedMs: number;
  outcome: Outcome;
  reason?: string;
  pauses: Pause[];
  blocks: Block[];
};

export type Stats = {
  todayFocusedMs: number;
  weekFocusedMs: number;
  totalFocusedMs: number;
  points: number;
  currentStreak: number;
  bestStreak: number;
  recent: Session[];
  blocksByApp: { app: string; count: number }[];
};
