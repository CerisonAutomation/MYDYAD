#!/bin/bash
set -e

cd "$(dirname "$0")"

# Use fnm for Node version
eval "$(fnm env 2>/dev/null || true)"
fnm use 24.15.0 2>/dev/null || true

echo "Starting Vite dev server..."
npx vite --config vite.renderer.config.mts --port 5173 &
VITE_PID=$!

# Wait for Vite to be ready
for i in $(seq 1 30); do
  if curl -s -o /dev/null http://127.0.0.1:5173/ 2>/dev/null; then
    echo "Vite ready on port 5173"
    break
  fi
  sleep 1
done

# Build main + preload through Forge (this builds but doesn't start Electron)
echo "Building main process bundles..."
npx electron-forge start --inspect=0 2>&1 &
FORGE_PID=$!

# Wait a bit for Forge to build and start
sleep 60

# Check if it's running
if curl -s -o /dev/null http://127.0.0.1:5173/ 2>/dev/null; then
  echo "App is running!"
else
  echo "Something went wrong"
fi

# Keep running
wait
