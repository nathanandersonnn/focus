export type Outcome = "completed" | "abandoned";

export type Pause = { from: string; to: string };

export type Block = { app: string; at: string; killed: boolean };

export type Session = {
  id: string;
  localDate: string;
  startedAt: string;
  endedAt: string;
  plannedMin: number | null;
  focusedMs: number;
  outcome: Outcome;
  deep: boolean;
  reason?: string;
  pauses: Pause[];
  blocks: Block[];
};

export type DayTotal = {
  localDate: string;
  focusedMs: number;
  qualified: boolean;
};

export type Stats = {
  week: DayTotal[];
  todayFocusedMs: number;
  weekFocusedMs: number;
  totalFocusedMs: number;
  points: number;
  currentStreak: number;
  bestStreak: number;
  recent: Session[];
  blocksByApp: { app: string; count: number }[];
};
