import { cookies } from "next/headers";
import { computeStats, type Session } from "@focus/core";
import { SESSION_COOKIE, isSignedIn } from "@/lib/auth";
import { listSessions } from "@/lib/db";
import styles from "./page.module.css";
import { WeekChart } from "./WeekChart";

function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

function hm(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

function shortDate(localDate: string): string {
  const [y, mo, d] = localDate.split("-").map(Number);
  return new Date(Date.UTC(y!, mo! - 1, d!)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function SignIn() {
  return (
    <main className={styles.signin}>
      <h1 className={styles.title}>Focus</h1>
      <p className={styles.reason}>Private dashboard.</p>
      <p>
        To sign in, run <code className={styles.num}>focus dashboard</code> on your PC.
      </p>
    </main>
  );
}

function RecentSessions({ sessions }: { sessions: Session[] }) {
  if (sessions.length === 0) {
    return <p className={styles.empty}>No sessions yet. Run focus start 25 and come back.</p>;
  }
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Day</th>
            <th>Focused</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td className={styles.num}>{shortDate(s.localDate)}</td>
              <td className={styles.num}>
                {hm(s.focusedMs)}
                {s.plannedMin !== null && ` / ${s.plannedMin}m`}
              </td>
              <td>
                <span className={s.outcome === "completed" ? styles.completed : styles.abandoned}>
                  {s.outcome}
                </span>
                {s.deep && <span className={styles.deepTag}>deep</span>}
                {s.reason && <div className={styles.reason}>&ldquo;{s.reason}&rdquo;</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function Home() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await isSignedIn(token, process.env.FOCUS_DEVICE_KEY))) return <SignIn />;

  const sessions = await listSessions();
  const today = todayIn(process.env.FOCUS_TIMEZONE ?? "America/Los_Angeles");
  const stats = computeStats(sessions, today);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Focus</h1>
        <div className={styles.who}>
          <form action="/api/auth/logout" method="post">
            <button className={styles.linkButton} type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className={styles.hero}>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Weekday streak</div>
          <div className={`${styles.statValue} ${styles.streak}`}>{stats.currentStreak}</div>
          <div className={styles.statNote}>best {stats.bestStreak}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Today</div>
          <div className={styles.statValue}>{hm(stats.todayFocusedMs)}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>This week</div>
          <div className={styles.statValue}>{hm(stats.weekFocusedMs)}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>All time</div>
          <div className={styles.statValue}>{hm(stats.totalFocusedMs)}</div>
          <div className={styles.statNote}>{stats.points.toLocaleString()} points</div>
        </div>
      </section>

      <h2 className={styles.sectionTitle}>This week</h2>
      <WeekChart week={stats.week} today={today} />

      <div className={styles.columns}>
        <section>
          <h2 className={styles.sectionTitle}>Recent sessions</h2>
          <RecentSessions sessions={stats.recent} />
        </section>
        <section>
          <h2 className={styles.sectionTitle}>Tried to distract you</h2>
          {stats.blocksByApp.length === 0 ? (
            <p className={styles.empty}>Nothing yet.</p>
          ) : (
            <ul className={styles.blockList}>
              {stats.blocksByApp.map((b) => (
                <li key={b.app} className={styles.blockItem}>
                  <span>{b.app}</span>
                  <span className={styles.num}>{b.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
