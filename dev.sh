#!/bin/bash
# Dyad Development Launcher
# Starts Vite dev server + Electron with correct IPv4 binding
set -e

cd "$(dirname "$0")"

# Ensure Node 24
eval "$(fnm env 2>/dev/null || true)"
fnm use 24.15.0 2>/dev/null || true

# Kill any existing instances
pkill -9 -f "Electron.*dyad" 2>/dev/null || true
pkill -9 -f "node.*vite.*5173" 2>/dev/null || true
sleep 1

echo "Starting Vite dev server on 127.0.0.1:5173..."
npx vite --config vite.renderer.config.mts --port 5173 &
VITE_PID=$!

# Wait for Vite
for i in $(seq 1 30); do
  if curl -s -o /dev/null http://127.0.0.1:5173/ 2>/dev/null; then
    echo "✓ Vite ready"
    break
  fi
  sleep 1
done

# Build main+preload through Forge (Vite stays alive since it's separate)
echo "Building main process..."
npx electron-forge start --inspect=0 2>&1 &
FORGE_PID=$!

# Wait for build + Electron to start
echo "Waiting for Electron..."
for i in $(seq 1 90); do
  ELEC=$(pgrep -f "Electron.*dyad-main" 2>/dev/null | head -1)
  FAILS=$(grep -c "ERR_CONNECTION_REFUSED\|renderer failed" /tmp/dyad-forge-out.log 2>/dev/null || echo 0)
  
  if [ -n "$ELEC" ] && [ "$FAILS" -eq 0 ] && [ $i -ge 20 ]; then
    echo "✓✓ Dyad is running! (PID $ELEC)"
    echo "   Vite: http://127.0.0.1:5173"
    break
  fi
  
  if [ $((i % 20)) -eq 0 ]; then
    echo "  ${i}s waiting..."
  fi
  sleep 1
done

# Cleanup on exit
trap "kill $VITE_PID $FORGE_PID 2>/dev/null; pkill -f 'Electron.*dyad-main' 2>/dev/null" EXIT

wait
