#!/usr/bin/env bash
# Read a prompt on stdin, send it to Gemini headlessly, print the answer on stdout.
#
# Uses the Antigravity CLI (agy), not the Gemini CLI: Google sign-in for the Gemini CLI
# stopped working for individual accounts, and agy is signed in to Gemini Premium.
# agy cannot read files in headless mode (tool permissions auto-deny), so inline any
# file content into the prompt.
#
# Env: GEMINI_MODEL (default gemini-3.1-pro-high), ASK_TIMEOUT (seconds, default 180).
# Exit: 0 ok, 2 empty prompt, 3 timeout, 4 empty/failed response, 5 missing tool.
set -uo pipefail

model="${GEMINI_MODEL:-gemini-3.1-pro-high}"
limit="${ASK_TIMEOUT:-180}"

agy_bin="$(command -v agy || true)"
[ -z "$agy_bin" ] && [ -x "${LOCALAPPDATA:-}/agy/bin/agy.exe" ] && agy_bin="$LOCALAPPDATA/agy/bin/agy.exe"
[ -z "$agy_bin" ] && { echo "ask-gemini: agy not found" >&2; exit 5; }
command -v jq >/dev/null || { echo "ask-gemini: jq not found" >&2; exit 5; }

prompt="$(cat)"
[ -z "${prompt//[[:space:]]/}" ] && { echo "ask-gemini: empty prompt on stdin" >&2; exit 2; }

# --output-format json is required: plain text output comes back empty headlessly.
# Do not add --mode plan; it silently returns nothing.
out="$(printf '%s' "$prompt" | timeout "$limit" "$agy_bin" --output-format json \
  --model "$model" --print-timeout "${limit}s")"
status=$?
[ $status -eq 124 ] && { echo "ask-gemini: timed out after ${limit}s" >&2; exit 3; }
[ $status -ne 0 ] && { echo "ask-gemini: agy exited $status" >&2; exit 4; }

response="$(printf '%s' "$out" | jq -r 'select(.status == "SUCCESS") | .response // empty' 2>/dev/null)"
[ -z "${response//[[:space:]]/}" ] && { echo "ask-gemini: empty response: ${out:0:300}" >&2; exit 4; }
printf '%s\n' "$response"
