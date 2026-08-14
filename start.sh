#!/bin/bash
# Dyad Dev Launcher — starts Vite + Electron correctly
# Usage: ./start.sh

set -e

cd "$(dirname "$0")"

# Load fnm
eval "$(fnm env 2>/dev/null)" || true
fnm use 24.15.0 2>/dev/null || true

echo "=== Dyad Dev Launcher ==="

# Kill any existing processes
pkill -9 -f "Electron.*Dyad" 2>/dev/null || true
pkill -9 -f "node.*vite" 2>/dev/null || true
sleep 2

# Clear caches if requested
if [ "$1" = "--clean" ]; then
  echo "Clearing caches..."
  rm -rf ~/Library/Application\ Support/dyad/Cache
  rm -rf ~/Library/Application\ Support/dyad/Code\ Cache
  rm -rf ~/Library/Application\ Support/dyad/GPUCache
fi

# Disable auto-update (prevents Squirrel crash on macOS 26)
SETTINGS=~/Library/Application\ Support/dyad/user-settings.json
if [ -f "$SETTINGS" ]; then
  sed -i '' 's/"enableAutoUpdate": true/"enableAutoUpdate": false/' "$SETTINGS" 2>/dev/null || true
fi

# Ensure port 5173 is free
lsof -ti:5173 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

# Step 1: Start Vite dev server
echo "Starting Vite dev server..."
npx vite --config vite.renderer.config.mts --port 5173 --host 127.0.0.1 > /tmp/dyad-vite.log 2>&1 &
VITE_PID=$!

# Wait for Vite to be ready
for i in $(seq 1 20); do
  HTTP=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/ 2>/dev/null)
  if [ "$HTTP" = "200" ]; then
    echo "✓ Vite ready on http://127.0.0.1:5173"
    break
  fi
  if [ "$i" -eq 20 ]; then
    echo "✗ Vite failed to start"
    kill $VITE_PID 2>/dev/null
    exit 1
  fi
  sleep 1
done

# Step 2: Launch Electron with correct dev server URL
echo "Launching Electron..."
MAIN_WINDOW_VITE_DEV_SERVER_URL="http://127.0.0.1:5173" \
  ./node_modules/.bin/electron . 2>&1 &
ELECTRON_PID=$!

echo "Electron PID: $ELECTRON_PID"
echo ""
echo "App is running! Use Cmd+Tab or Mission Control to find the Dyad window."
echo "Press Ctrl+C to stop both processes."
echo ""

# Wait for either to exit
wait $ELECTRON_PID 2>/dev/null
kill $VITE_PID 2>/dev/null
echo "Done."
