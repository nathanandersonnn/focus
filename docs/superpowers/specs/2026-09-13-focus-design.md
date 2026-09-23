# Focus — design

Status: historical design, 2026-09-13. See the root README for current controls,
timing, scoring, and startup behavior (simplified 2026-09-22).

## Purpose

Nathan loses study time to Discord, Steam, War Thunder, and Squad. Focus makes a study session real:
it closes those apps the instant they open, opens NeetCode, times only the minutes he is actually
present, and records the result on a private dashboard so the cost of quitting is visible.

It is **not** a lock on the PC. It runs only during a session. When a session ends — finished or
abandoned — the agent exits and the PC is fully normal.

## Scope

In:
- A Windows agent, run on demand, that blocks apps and times one session.
- A private web dashboard on Vercel showing time, points, and weekday streaks.
- One user, one Windows 11 PC.

Out (v1):
- Browser versions of the blocked apps (discord.com, etc.) — explicitly accepted.
- Starting with Windows, background services, tray icon.
- Preventing a determined bypass. Task Manager works; abandoning is recorded, not prevented.
- Spending points on anything. Points and streaks are score only.
- Controlling the agent from the dashboard. Mobile. Other users.

## Architecture

One git repo, npm workspaces, TypeScript throughout (Node 24 is installed; Python is not).

```
focus/
  packages/core    shared types + computeStats()
  apps/agent       Windows agent (Node + TypeScript, Win32 via koffi)
  apps/web         Next.js dashboard on Vercel
```

Data flows one way: **agent → dashboard**. Blocking never depends on the network.

### packages/core

Pure functions, no I/O.

- `Session` type — the raw record the agent produces and the server stores (see Data).
- `computeStats(sessions, today: LocalDate) -> Stats` — the **only** place points, streaks, and totals
  are computed. The agent uses it for its end-of-session summary; the dashboard uses it for every view.

### apps/agent

Small single-purpose modules:

| Module | Responsibility | Depends on |
|---|---|---|
| `win32` | Thin koffi bindings: enumerate processes (name + PID), terminate by PID, milliseconds since last input (`GetLastInputInfo` vs `GetTickCount64`) | koffi |
| `blocker` | Each tick: find blocklisted processes, terminate them, report `{app, killed}` per app | `win32` |
| `session` | State machine (below). Pure: takes injected clock and last-input time | `core` |
| `store` | Local JSON: the active session (rewritten every 5 s), the upload outbox, config (blocklist, dashboard URL, device key) | fs |
| `sync` | Upload outbox entries; remove each only on confirmed success | `store`, fetch |
| `cli` | `focus start [min]`, `focus deep <min>`, `focus dashboard`, `focus sync`; renders the live clock line; handles the in-window stop key | all of the above |

Local state lives in `%USERPROFILE%\.focus\` (not `%LOCALAPPDATA%`, which Windows redirects for packaged
apps, so tools launched from them would see a different copy).

### apps/web

- Next.js App Router on Vercel.
- Postgres via Vercel's marketplace integration. One table.
- Sign-in from the PC: `focus dashboard` POSTs the device key to `/api/auth/device`, which sets a
  30-day signed cookie. No third-party login, so the server holds one secret (`FOCUS_DEVICE_KEY`).
  Trade-off accepted: sign-in only from the PC that has the agent. (Changed from GitHub OAuth,
  2026-09-13, so setup needs no secrets copied between sites.)
- `POST /api/sessions` — authenticated by the device key as a bearer token.
- Dashboard page — server-rendered, calls `computeStats()` on stored sessions.

## Sessions

### Starting

`focus start 60` begins a session with a target of **60 focused minutes**. Paused time does not count
toward the target, so wall-clock duration can exceed it. `focus start` with no minutes runs open-ended:
the clock counts up and pressing `s` finishes it as `completed` (no reason prompt).

`focus deep <minutes>` starts a **deep** session. It requires a length — deep mode has no early exit,
so an open-ended deep session could never end cleanly. Deep sessions differ in three ways: `s` and
Ctrl+C are ignored, idle pauses after **2 minutes** instead of 5, and a completed deep session earns
**2x points** (`DEEP_MULTIPLIER`). Streak rules are unchanged. Closing the window still abandons it.

Starting also opens
`https://neetcode.io/practice` in Chrome, falling back to the default browser if Chrome is absent.

Starting is refused if a session is already running (lock file with PID in the state directory).

### While running

- The blocklist is enforced every second for the **entire** session, including while paused.
- The live clock line shows focused time remaining, pause state, and block counts. A kill that fails
  (e.g. anti-cheat protection) shows "couldn't close <app>" once per app per session.

### Pausing

- If milliseconds since last input reaches **5 minutes** (**2 minutes** in deep mode), the session pauses.
- The pause is **backdated** to the moment of last input, so idle time never counts as focused.
- The next input resumes the session.
- Sleep, lock, and display-off need no separate handling: each produces an idle gap over 5 minutes.

### Ending

| Outcome | Trigger | Time tracked | Points | Streak |
|---|---|---|---|---|
| `completed` | Focused time reaches the target, or `s` in an open-ended session | yes | 1 per focused minute | qualifies if focused ≥ 15 min |
| `abandoned` | In the session window, press `s` or Ctrl+C, then type a reason; ends immediately (not available in deep mode) | yes | 0 | no |
| `abandoned` | Session window closed, agent killed, or PC shut down | yes | 0 | no |

Stopping happens inside the session window — there is no separate stop command, so no inter-process
communication. At the reason prompt, submitting an empty reason cancels and returns to the session.

The agent cannot record anything at the moment it is killed. The active-session file is rewritten
every 5 seconds, so on the next `focus start` (or `focus sync`), a file with no live PID is closed as
`abandoned` with reason `"agent closed"` and `endedAt` set to its last saved tick (at most 5 s lost).

After any ending, the session is written to the outbox, an upload is attempted, the end-of-session
summary prints, and the agent exits.

### Blocklist

| App | Process names |
|---|---|
| Discord | `discord.exe` |
| Steam | `steam.exe`, `steamwebhelper.exe` |
| War Thunder | `aces.exe` |
| Squad | `squadgame.exe` |

Matching is case-insensitive by process name. Games launched through Steam are matched by their own
executable names, so no process-tree killing is needed. The blocklist lives in the agent config.

## Scoring (implemented once, in `computeStats`)

- **Points:** completed sessions earn 1 point per whole focused minute, doubled for deep sessions.
  Abandoned sessions earn 0, deep or not.
- **Qualifying session:** `completed` with focused time ≥ 15 minutes.
- **Streak:** consecutive **weekdays** (Mon–Fri), counting back from today, each with at least one
  qualifying session. Saturdays and Sundays are skipped: they neither break nor extend a streak.
  If today is a weekday with no qualifying session yet, the streak is still counted through the
  previous weekday (today is not over).
- **Best streak:** the longest such run in history.
- **Day assignment:** a session belongs to its `localDate` — the agent's local date when it started.
  The server never derives dates.
- Weekend sessions count toward time and points.

## Data

```ts
type Session = {
  id: string;               // UUID, generated by the agent at start
  localDate: string;        // "YYYY-MM-DD", agent local time at start
  startedAt: string;        // ISO 8601
  endedAt: string;          // ISO 8601
  plannedMin: number | null; // null = open-ended
  focusedMs: number;
  outcome: "completed" | "abandoned";
  deep: boolean;            // started with `focus deep`
  reason?: string;          // required when abandoned
  pauses: { from: string; to: string }[];
  blocks: { app: string; at: string; killed: boolean }[];
};
```

Postgres table `sessions`: one row per session; `id` primary key; scalar fields as columns;
`pauses` and `blocks` as `jsonb`.

## Sync

```
POST /api/sessions
Authorization: Bearer <device key>
Body: Session
```

- Server validates the body against the `Session` schema; malformed → `400`, nothing written.
- Wrong or missing key → `401`.
- Insert with `ON CONFLICT (id) DO NOTHING`; respond `200` whether new or duplicate. Retries are safe.
- The agent removes an outbox entry only after a `200`.
- Failures leave entries queued. The outbox is flushed at every session start, at session end, and on
  `focus sync`.
- A `401` is reported plainly and not retried in a loop.

The device key is a random secret stored in the agent config and as a Vercel environment variable.
Nathan sets both himself during deployment.

## Dashboard

Requires the sign-in cookie from `focus dashboard`. Shows, via `computeStats()`:

- Focused hours: today, this week, all time. Total points.
- Current weekday streak and best streak.
- Recent sessions with outcome, focused time, and abandon reasons.
- Most-blocked apps.

## Error handling

| Situation | Behavior |
|---|---|
| Kill denied (anti-cheat, permissions) | Warn once per app per session; log block with `killed: false`; keep trying each tick |
| App relaunches immediately | Killed next tick; at most one block record per app per second |
| Sleep mid-session | Handled by the idle rule; pause backdated to last input |
| Second `focus start` | Refused with a message |
| Stale active session from a killed agent | Closed as `abandoned`, reason `"agent closed"` |
| Chrome missing | Default browser |
| Upload fails / offline | Stays in outbox |
| Upload `401` | Clear message, no retry loop |
| Malformed payload | Server `400`, nothing stored |

## Testing

- **`computeStats`** — most coverage: weekend skip, missed weekday breaks streak, 15-minute threshold,
  abandoned earns nothing, today-without-session-yet, best streak, midnight-crossing session stays on
  its `localDate`.
- **`session` state machine** — fake clock and fake last-input source: idle pause at 5 minutes,
  backdating, resume, completion at target, stop with reason, stale-session recovery.
- **`win32` / `blocker`** — manual on the real PC: first against Notepad as a harmless stand-in, then
  against Discord, Steam, War Thunder, and Squad to confirm whether anti-cheat blocks termination.
- **API** — integration test: posting the same session twice stores one row; bad key → 401; bad
  body → 400.

## Review process

Claude writes the plan and builds. Before implementation, the plan is reviewed independently by local
Qwen and by Gemini 3.1 Pro. After the first working vertical slice, Gemini reviews the whole repo.

## Known risks

- **Anti-cheat may block termination** of Squad or War Thunder without admin rights. To be settled by
  the manual test; if it fails, the session records failed blocks honestly rather than faking success.
- **koffi bindings on Windows** are the least familiar surface. Kept thin and tested early.
