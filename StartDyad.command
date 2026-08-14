#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  Dyad Launcher — double-click in Finder to start
# ═══════════════════════════════════════════════════════════

cd /Users/cb/Downloads/dyad-main

# Use Node 24 via fnm
eval "$(fnm env 2>/dev/null)"
fnm use 24.15.0 2>/dev/null

# ── Kill old instances ──
pkill -9 -f "electron.*dyad-main" 2>/dev/null
sleep 1
pkill -9 -f "vite.*renderer.*5173" 2>/dev/null
sleep 1

# ── Remove lock files ──
rm -f ~/Library/Application\ Support/dyad/SingletonLock 2>/dev/null
rm -f ~/Library/Application\ Support/dyad/SingletonSocket 2>/dev/null
rm -f ~/Library/Application\ Support/dyad/SingletonCookie 2>/dev/null

# ── Start Vite dev server ──
npx vite --config vite.renderer.config.mts --port 5173 --host 127.0.0.1 >/dev/null 2>&1 &
echo "Starting Vite..."

# Wait for Vite to be ready
for i in $(seq 1 20); do
  if curl -s -o /dev/null http://127.0.0.1:5173/ 2>/dev/null; then
    break
  fi
  sleep 1
done

# Warm up Vite (pre-compile bundles so Electron doesn't timeout)
curl -s -o /dev/null http://127.0.0.1:5173/
curl -s -o /dev/null http://127.0.0.1:5173/

# ── Launch Electron ──
MAIN_WINDOW_VITE_DEV_SERVER_URL="http://127.0.0.1:5173" \
  ./node_modules/.bin/electron . &

echo "Dyad is starting — window will appear shortly..."
