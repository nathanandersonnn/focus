export type Outcome = "completed" | "abandoned";

// Class counts like regular study; it is kept separate so the dashboard can show it.
export type Mode = "regular" | "deep" | "class";

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
  mode: Mode;
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
