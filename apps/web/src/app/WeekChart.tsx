import type { DayTotal } from "@focus/core";
import styles from "./WeekChart.module.css";

const STEP_OPTIONS_MIN = [15, 30, 60, 120, 180, 240, 360];
const MAX_TICKS = 4;

export function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, "0")}m`;
}

function scale(maxMs: number): { topMs: number; ticksMs: number[] } {
  const maxMin = Math.max(maxMs / 60_000, 30);
  const step = STEP_OPTIONS_MIN.find((s) => Math.ceil(maxMin / s) <= MAX_TICKS) ?? STEP_OPTIONS_MIN.at(-1)!;
  const count = Math.ceil(maxMin / step);
  const ticksMs = Array.from({ length: count + 1 }, (_, i) => i * step * 60_000);
  return { topMs: count * step * 60_000, ticksMs };
}

function dayParts(localDate: string) {
  const [y, m, d] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  const opts = { timeZone: "UTC" } as const;
  return {
    short: date.toLocaleDateString("en-US", { ...opts, weekday: "short" }),
    long: date.toLocaleDateString("en-US", { ...opts, weekday: "long", month: "short", day: "numeric" }),
  };
}

export function WeekChart({ week, today }: { week: DayTotal[]; today: string }) {
  const maxMs = Math.max(0, ...week.map((d) => d.focusedMs));
  const { topMs, ticksMs } = scale(maxMs);
  const bestDate = maxMs > 0 ? week.find((d) => d.focusedMs === maxMs)?.localDate : undefined;

  return (
    <figure className={styles.figure}>
      <div className={styles.chart}>
        <div className={styles.axis} aria-hidden="true">
          {ticksMs.map((t) => (
            <span key={t} className={styles.tick} style={{ bottom: `${(t / topMs) * 100}%` }}>
              {formatDuration(t)}
            </span>
          ))}
        </div>

        <div className={styles.plot}>
          {ticksMs.map((t) => (
            <div key={t} className={styles.gridline} style={{ bottom: `${(t / topMs) * 100}%` }} aria-hidden="true" />
          ))}

          {week.map((day, i) => {
            const { short, long } = dayParts(day.localDate);
            const isToday = day.localDate === today;
            const isFuture = day.localDate > today;
            const heightPct = (day.focusedMs / topMs) * 100;
            const showLabel = day.focusedMs > 0 && (isToday || day.localDate === bestDate);
            const summary = isFuture
              ? "not yet"
              : `${formatDuration(day.focusedMs)} focused${day.qualified ? ", counts toward streak" : ""}`;

            return (
              <div
                key={day.localDate}
                className={`${styles.band} ${i === 0 ? styles.first : ""} ${i === week.length - 1 ? styles.last : ""}`}
                tabIndex={0}
                aria-label={`${long}: ${summary}`}
              >
                <div className={styles.barArea}>
                  {day.focusedMs > 0 && (
                    <div className={styles.bar} style={{ height: `max(${heightPct}%, 3px)` }}>
                      {showLabel && <span className={styles.value}>{formatDuration(day.focusedMs)}</span>}
                    </div>
                  )}
                  <div
                    className={styles.tooltip}
                    role="presentation"
                    style={{ bottom: `calc(${heightPct}% + ${showLabel ? 26 : 8}px)` }}
                  >
                    <strong>{isFuture ? "—" : formatDuration(day.focusedMs)}</strong>
                    <span>{long}</span>
                    {day.qualified && <span>Counts toward streak</span>}
                  </div>
                </div>
                <span className={`${styles.day} ${isToday ? styles.today : ""} ${isFuture ? styles.future : ""}`}>
                  {isToday ? "Today" : short}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <details className={styles.tableToggle}>
        <summary>Show as table</summary>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Focused</th>
              <th scope="col">Streak day</th>
            </tr>
          </thead>
          <tbody>
            {week.map((day) => (
              <tr key={day.localDate}>
                <td>{dayParts(day.localDate).long}</td>
                <td className={styles.num}>{day.localDate > today ? "—" : formatDuration(day.focusedMs)}</td>
                <td>{day.qualified ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
