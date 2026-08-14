#!/bin/bash
# Dyad Dev Launcher — reliable version
# Double-click this file or run: ./start-dev.sh

cd "$(dirname "$0")"
eval "$(fnm env 2>/dev/null)"
fnm use 24.15.0 2>/dev/null

echo "=== Dyad Dev Launcher ==="

# Kill ALL Dyad/Electron instances first (prevents SingletonLock conflicts)
echo "Stopping existing instances..."
pkill -9 -f "Dyad-Zenith" 2>/dev/null
pkill -9 -f "electron.*dyad-main" 2>/dev/null
# Only kill Electron processes that are ours, not other apps
pgrep -f "Electron.*dyad" | xargs kill -9 2>/dev/null
sleep 2

# Remove lock files
rm -f ~/Library/Application\ Support/dyad/SingletonLock
rm -f ~/Library/Application\ Support/dyad/SingletonSocket
rm -f ~/Library/Application\ Support/dyad/SingletonCookie

# Disable auto-update (prevents Squirrel crash on macOS 26)
sed -i '' 's/"enableAutoUpdate": true/"enableAutoUpdate": false/' \
  ~/Library/Application\ Support/dyad/user-settings.json 2>/dev/null

# Ensure port 5173 is free
lsof -ti:5173 2>/dev/null | xargs kill -9 2>/dev/null
sleep 1

# Start Vite dev server
echo "Starting Vite dev server..."
npx vite --config vite.renderer.config.mts --port 5173 --host 127.0.0.1 > /tmp/dyad-vite.log 2>&1 &
VITE_PID=$!

# Wait for Vite
for i in $(seq 1 20); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/ 2>/dev/null)" = "200" ]; then
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

# Launch Electron
echo "Launching Dyad..."
MAIN_WINDOW_VITE_DEV_SERVER_URL="http://127.0.0.1:5173" \
  ./node_modules/.bin/electron . 2>/dev/null &
ELECTRON_PID=$!

echo ""
echo "✓ Dyad is running! (PID: $ELECTRON_PID)"
echo "  Use Cmd+Tab to switch to the Dyad window."
echo "  Press Ctrl+C to stop."
echo ""

# Wait for Electron to exit
wait $ELECTRON_PID 2>/dev/null
kill $VITE_PID 2>/dev/null
echo "Dyad closed."
