# Focus

A small Windows study timer that blocks distracting apps during a session.

```text
focus start 30     Regular homework or practice
focus start        Regular work, open-ended
focus deep 45      Learning unfamiliar material; no early exit, double points
focus class        Class time, silent with no app blocking; press s to finish
focus dashboard    Open the private dashboard
focus sync         Upload queued sessions
```

In any mode, **p** pauses/resumes. **s** ends the session, except in deep mode:
a deep session runs until its timer finishes, and **s** and Ctrl+C are ignored.
Ending a timed regular session early asks for a short reason; Enter cancels. Take breaks
with **p**; in regular and deep modes, apps remain blocked while paused. After a timer gap
longer than 30 seconds (such as sleep), the gap is excluded and the timer stays paused
until you resume.

Reading, thinking, and paper work count without touching the PC. In regular and deep
modes, 10 minutes without mouse or keyboard input plays two even beeps: a check-in.
Move the mouse or press any key within 5 minutes and all of the time counts. With no
answer, the session pauses, backdated to your last input, and resumes by itself the
next time you touch the mouse or keyboard. Breaks you start with **p** still need **p**
to end. Class mode never checks in, since a lecture leaves the PC untouched.

Completed regular and deep sessions play a short, rising three-tone chime, including when you finish
an open-ended session with **s**. Ending a timed session early stays silent.
The chime plays before dashboard uploads, so a slow connection cannot delay it.

Class mode stays silent, leaves all apps available, and skips the configured
start page. It has no countdown or duration to enter: run `focus class`, then press
**s** when class ends. Class sessions are saved as class and tagged that way on the
dashboard, but they earn the same points as regular study and contribute to today's,
weekly, and all-time totals and streaks. Keep your computer awake during
class: time spent asleep is excluded, just like in the other modes.

Regular and class sessions earn one point per whole study minute, even when ended early.
A completed deep session earns two points per minute. If the agent is closed during a deep
session, the recovered time earns one point per minute.
A total of 15 study minutes qualifies any day for the streak. Weekends are optional:
skipping them never breaks a streak. Each qualifying weekend day adds one day to
the streak and covers one missed weekday in the following week. For example,
study Sunday, take Monday off, and continue Tuesday. Studying both Saturday and
Sunday covers two missed weekdays. Covered days preserve the streak but do not
increase its count; unused cover expires at the next weekend.

These rules also apply to historical sessions when the dashboard recalculates statistics.

## Setup

Requires Windows and Node.js 24. From the repository root:

```text
npm install
npm link --workspace @focus/agent
```

The agent creates `%USERPROFILE%\.focus\config.json`. Edit its `blocklist` to choose
apps. Nothing opens automatically by default. To open a study page on each start,
add `"startUrl": "https://neetcode.io/practice"`; omit it or set it to `""` to disable.

The dashboard is optional. Configure its environment using `apps/web/.env.example`,
then set `dashboardUrl` and the matching `deviceKey` in the agent config. Sessions
queue locally until uploaded. Upload happens after a session or via `focus sync`,
so starting work never waits for the network.

```text
npm test
npm run typecheck
```

The original design under `docs/superpowers/specs` is historical; this README
describes the current controls and scoring.

## Code layout

- `apps/agent` is the Windows CLI. `bin/focus.mjs` starts it; `src/cli.ts`
  routes commands and owns locking and cleanup.
- Agent session code lives in `src/modes.ts` (mode settings and duration rules),
  `src/study.ts` (keyboard and timer loop), and `src/session.ts` (pure time accounting).
- Agent integrations live in `src/store.ts` (local files and recovery), `src/sync.ts`
  (uploads), `src/browser.ts` (browser launch and dashboard sign-in), and
  `src/win32.ts` / `src/blocker.ts` (Windows operations and app blocking).
  `src/terminal.ts` contains terminal formatting and summaries.
- `packages/core/src` holds shared session types, date helpers, totals, and streaks.
- `apps/web/src/app` holds dashboard pages and API routes; `src/lib` holds
  authentication, session validation, request handlers, and database access.
- Each workspace keeps its tests in `test/`. From the root, run `npm test` and
  `npm run typecheck`. To run the CLI without linking, use
  `npm run focus --workspace @focus/agent -- class`.

Each saved session records its `mode` (`regular`, `deep`, or `class`). The dashboard still
accepts the older `deep` flag from sessions queued before modes were recorded.
The session state machine is independent of terminal input and Windows APIs.
