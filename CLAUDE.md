# Model delegation

Claude Code orchestrates. Two helpers are available from any shell:

| Helper | Call | Backend |
|---|---|---|
| Qwen3.8-27B, UD-Q3_K_XL (local) | `scripts/ask-qwen.sh [image.png ...] < prompt.txt` | LM Studio/Bionic server on `127.0.0.1:1234`, model `unsloth/qwen3.8-27b` loaded as `qwen38` |
| Gemini 3.1 Pro | `scripts/ask-gemini.sh < prompt.txt` | Antigravity CLI (`agy`); the Gemini CLI's Google sign-in no longer works for this account |

Both read the prompt on stdin and print the answer on stdout. Exit codes: 2 empty prompt, 3 timeout
(180s, `ASK_TIMEOUT` overrides), 4 empty/failed response, 5 setup failure.

Measured on this machine (RTX 5080 16 GB), 2026-09-14:
- Qwen: 28 tok/s decode, 0.2–0.75s TTFT on a short prompt; ~21K-token prompt answered in 23s.
  14.3 GB VRAM at a 24576-token context, no spill. Thinking is disabled (`reasoning_effort: none`).
- Qwen vision works through the wrapper (pass image paths as arguments). With no image attached it
  will still invent a description, so never trust a visual claim unless the image was actually sent.
- Qwen on a ~21K-token lookup missed 1 of 5 matching files. Recall degrades near the context limit.
- Gemini: ~7s for a trivial prompt; ~13K tokens of agent overhead per call. It cannot read files
  headlessly, so inline everything it needs.

## Route to Qwen (local, free, private)
- Self-contained tasks with machine-verifiable correctness
- Up to ~3 related files if total context stays under ~12K tokens
- Structured output and tool-call formatting

Examples: unit test suites from existing signatures, type annotations, refactoring against a stated
interface, JSON/schema transforms, regex construction, boilerplate handlers, mechanical migrations.

## Route to Gemini (large context, read-only)
- Whole-repo summarization, "where is X handled"
- Long logs, stack traces, build output: extract the signal
- Dependency docs and changelog summarization

Gemini produces ANALYSIS, never patches.

## Keep yourself (Claude)
- Architecture and design decisions
- Debugging where the cause is not localized
- Auth, secrets, env handling, database migrations (in this repo: `apps/web/src/lib/auth.ts`,
  `handleDeviceLogin.ts`, `db.ts`, anything touching `FOCUS_DEVICE_KEY` or `DATABASE_URL`)
- Anything where a subtly-wrong answer is expensive to catch
- Final review of every delegated diff

## Hard rules
1. NEVER commit Qwen output unreviewed. Pipeline: receive → write to file → typecheck + tests →
   read the diff yourself → accept, repair, or discard. State which and why.
   This repo has no linter; the checks are `npm run typecheck`, `npx tsc --noEmit -p apps/web`,
   and `npm test`.
2. Review 3-bit output harder than you would a 4-bit model's. Check boundary conditions,
   off-by-ones, and exact type conformance specifically. Tests passing is necessary, not sufficient.
3. One Qwen call at a time.
4. Give it a SPEC, not a goal: exact signatures, types, one concrete example. State the compiler
   flags that matter. Qwen's code does not assume `noUncheckedIndexedAccess`, which this repo enables.
5. Break-even test: if writing the spec takes longer than writing the code, write the code and say
   "not worth delegating." Do not delegate to appear compliant.
6. Two failed attempts on the same task and you take it over. No loops.
7. Never raise the context past 24576 to force a large task through. Route it to yourself or Gemini.
   `ask-qwen.sh` exits 4 with a routing message when a prompt doesn't fit.
