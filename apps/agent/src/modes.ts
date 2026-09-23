import type { Mode } from "@focus/core";

export type StudyMode = {
  name: Mode;
  label: string;
  duration: "optional" | "required" | "none";
  blockApps: boolean;
  earlyExit: boolean;
  completionSound: boolean;
  openStartPage: boolean;
};

export type StudyOptions = { mode: StudyMode; minutes: number | null };

const regular: StudyMode = {
  name: "regular",
  label: "Regular: homework and practice",
  duration: "optional",
  blockApps: true,
  earlyExit: true,
  completionSound: true,
  openStartPage: true,
};

const modes: Record<string, StudyMode> = {
  start: regular,
  // No early exit is the commitment that earns deep work double points.
  deep: { ...regular, name: "deep", label: "Deep: learning something new", duration: "required", earlyExit: false },
  class: {
    name: "class",
    label: "Class: counts as regular study",
    duration: "none",
    blockApps: false,
    earlyExit: true,
    completionSound: false,
    openStartPage: false,
  },
};

export function parseStudy(command: string, rawMinutes?: string): StudyOptions | null {
  if (!Object.hasOwn(modes, command)) return null;
  const mode = modes[command]!;
  if (mode.duration === "none" && rawMinutes !== undefined) {
    throw new Error("Usage: focus class   (no duration needed; press s when class ends)");
  }
  if (mode.duration === "required" && rawMinutes === undefined) {
    throw new Error("Choose a study block for deep work: focus deep 45");
  }
  const minutes = rawMinutes === undefined ? null : Number(rawMinutes);
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 600)) {
    const required = mode.duration === "required";
    throw new Error(`Usage: focus ${command} ${required ? "<minutes>" : "[minutes]"}   (whole minutes, 1-600${required ? "" : "; leave out to run until you press s"})`);
  }
  return { mode, minutes };
}

export const USAGE = `Usage:
  focus start [minutes]   regular homework (no minutes = finish with s)
  focus deep <minutes>    no early exit, double points; for learning unfamiliar topics
  focus class             open-ended class time, silent with no app blocking
  focus sync              upload queued sessions
  focus dashboard         open the dashboard, signed in

During any mode: p = pause/resume. s = end, except in deep mode. Reading and thinking count.`;
