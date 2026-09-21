#!/usr/bin/env bash
# Read a prompt on stdin, send it to local Qwen3.8-27B (UD-Q3_K_XL) via LM Studio, print the answer.
#
# Usage: scripts/ask-qwen.sh [image.png ...] < prompt.txt
#   Image paths are optional; they are sent as base64 image parts (vision input).
#
# Backend is LM Studio / Bionic's OpenAI-compatible server, not Ollama. Context length is
# fixed at load time, so this script loads the model itself with a 24576-token context,
# one parallel slot and a 30-minute idle TTL (the equivalent of OLLAMA_KEEP_ALIVE=30m).
# Never raise the context: KV-cache growth is what pushes the model out of VRAM.
#
# Env: QWEN_TEMPERATURE (default 0.1), ASK_TIMEOUT (seconds, default 180).
# Exit: 0 ok, 2 empty prompt, 3 timeout, 4 empty/failed response, 5 setup failure.
set -uo pipefail

base="http://127.0.0.1:1234"
# LM Studio's model key changes with what else is downloaded, so find the model by its file.
model_file="Qwen3.8-27B-UD-Q3_K_XL.gguf"
id="qwen38"
ctx=24576
ttl=1800
temperature="${QWEN_TEMPERATURE:-0.1}"
limit="${ASK_TIMEOUT:-180}"

command -v jq >/dev/null || { echo "ask-qwen: jq not found" >&2; exit 5; }
command -v lms >/dev/null || { echo "ask-qwen: lms not found" >&2; exit 5; }

prompt="$(cat)"
[ -z "${prompt//[[:space:]]/}" ] && { echo "ask-qwen: empty prompt on stdin" >&2; exit 2; }

if ! curl -s -m 5 "$base/v1/models" >/dev/null; then
  lms server start >/dev/null 2>&1 || { echo "ask-qwen: could not start LM Studio server" >&2; exit 5; }
fi

loaded_ctx="$(curl -s -m 5 "$base/api/v0/models/$id" | jq -r 'select(.state == "loaded") | .loaded_context_length // empty' 2>/dev/null)"
if [ "$loaded_ctx" != "$ctx" ]; then
  [ -n "$loaded_ctx" ] && lms unload "$id" >/dev/null 2>&1
  model_key="$(lms ls --json 2>/dev/null | jq -r --arg f "$model_file" \
    '[.[] | select(.type == "llm" and (.path | endswith($f))) | .modelKey][0] // empty')"
  [ -z "$model_key" ] && { echo "ask-qwen: $model_file is not in LM Studio's model list" >&2; exit 5; }
  # No --gpu max: forcing max also puts the vision projector's buffers on the GPU (~1.5 GB more),
  # which overfills 16 GB and pages VRAM to system RAM (28 tok/s drops to ~1 tok/s).
  lms load "$model_key" -c "$ctx" --parallel 1 --ttl "$ttl" --identifier "$id" -y >/dev/null 2>&1 \
    || { echo "ask-qwen: failed to load $model_key" >&2; exit 5; }
fi

# Everything goes through temp files: jq.exe is a native Windows binary, so it can't read bash
# process substitution, and large prompts passed as arguments exceed the command-line limit.
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
printf '%s' "$prompt" > "$tmp/prompt.txt"

# User message content: plain text, or text plus base64 image parts.
jq -n --rawfile p "$tmp/prompt.txt" '$p' > "$tmp/content.json" || { echo "ask-qwen: jq failed" >&2; exit 5; }
if [ $# -gt 0 ]; then
  jq -n --rawfile p "$tmp/prompt.txt" '[{type: "text", text: $p}]' > "$tmp/content.json"
  for img in "$@"; do
    [ -f "$img" ] || { echo "ask-qwen: image not found: $img" >&2; exit 5; }
    case "${img,,}" in *.jpg|*.jpeg) mime=image/jpeg ;; *.webp) mime=image/webp ;; *) mime=image/png ;; esac
    base64 -w0 "$img" > "$tmp/img.b64"
    jq --rawfile b64 "$tmp/img.b64" --arg m "$mime" \
      '. + [{type: "image_url", image_url: {url: ("data:" + $m + ";base64," + $b64)}}]' \
      "$tmp/content.json" > "$tmp/next.json" || { echo "ask-qwen: jq failed on $img" >&2; exit 5; }
    mv "$tmp/next.json" "$tmp/content.json"
  done
fi

body="$tmp/body.json"
# reasoning_effort "none" turns off Qwen's thinking; with it on, answers spend minutes on hidden tokens.
jq -n --arg model "$id" --slurpfile content "$tmp/content.json" --argjson t "$temperature" --argjson ttl "$ttl" \
  '{model: $model, messages: [{role: "user", content: $content[0]}], temperature: $t,
    reasoning_effort: "none", max_tokens: 8192, ttl: $ttl, stream: false}' > "$body" \
  || { echo "ask-qwen: failed to build request" >&2; exit 5; }

out="$(curl -s -m "$limit" "$base/v1/chat/completions" -H 'Content-Type: application/json' --data-binary "@$body")"
status=$?
[ $status -eq 28 ] && { echo "ask-qwen: timed out after ${limit}s" >&2; exit 3; }
[ $status -ne 0 ] && { echo "ask-qwen: request failed (curl $status)" >&2; exit 4; }

if printf '%s' "$out" | grep -q exceed_context_size; then
  echo "ask-qwen: prompt exceeds the ${ctx}-token context. Do not raise it; route this task to Claude or Gemini." >&2
  exit 4
fi
response="$(printf '%s' "$out" | jq -r '.choices[0].message.content // empty' 2>/dev/null)"
[ -z "${response//[[:space:]]/}" ] && { echo "ask-qwen: empty response: ${out:0:300}" >&2; exit 4; }
printf '%s\n' "$response"
