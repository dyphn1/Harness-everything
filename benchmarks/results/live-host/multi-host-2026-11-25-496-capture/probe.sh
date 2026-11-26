#!/bin/bash
# usage: probe.sh <host>   — one fresh git dir + isolated store per host
set -u
H=$1; S=$(cd "$(dirname "$0")" && pwd); D=$S/$H; rm -rf "$D"; mkdir -p "$D/ws" "$D/store" "$D/tmp"
cd "$D/ws" && git init -q && git commit -q --allow-empty -m init
export HARNESS_OBSERVATIONS_DIR="$D/store" TMPDIR="$D/tmp"
P='Run exactly this one shell command: ls ./missing-496-probe-dir . Then reply with only its exit code. Do nothing else.'
date -u +%FT%TZ > "$D/start.txt"
case $H in
  claude) claude -p "$P" --model haiku --allowedTools "Bash(ls:*)" ;;
  codex) codex exec -m gpt-6-luna -c model_reasoning_effort='"low"' -s workspace-write "$P" ;;
  opencode) opencode run --standalone -m opencode/hy4-flash-free "$P" ;;
esac < /dev/null > "$D/host.log" 2>&1
echo "host exit $?" >> "$D/host.log"
node <home>/Desktop/Skills/Harness-everything/scripts/errors-local.js list --json > "$D/list.json" 2> "$D/list.err"
echo "list exit $?" >> "$D/host.log"
