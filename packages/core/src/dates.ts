const DAY_MS = 86_400_000;

export function dayNumber(localDate: string): number {
  const [y, m, d] = localDate.split("-").map(Number);
  return Math.floor(Date.UTC(y!, m! - 1, d!) / DAY_MS);
}

function weekdayOf(day: number): number {
  return new Date(day * DAY_MS).getUTCDay();
}

export function isWeekday(day: number): boolean {
  const w = weekdayOf(day);
  return w !== 0 && w !== 6;
}

export function previousWeekday(day: number): number {
  let d = day - 1;
  while (!isWeekday(d)) d -= 1;
  return d;
}

export function nextWeekday(day: number): number {
  let d = day + 1;
  while (!isWeekday(d)) d += 1;
  return d;
}

export function mondayOf(day: number): number {
  return day - ((weekdayOf(day) + 6) % 7);
}
