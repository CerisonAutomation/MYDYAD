#!/bin/bash
cd "$(dirname "$0")"
eval "$(fnm env 2>/dev/null)"
fnm use 24.15.0 2>/dev/null

echo "Starting Dyad..."
lsof -ti:5173 2>/dev/null | xargs kill -9 2>/dev/null
sleep 1

npx vite --config vite.renderer.config.mts --port 5173 --host 127.0.0.1 &
for i in $(seq 1 15); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/ 2>/dev/null)" = "200" ] && break
  sleep 1
done

MAIN_WINDOW_VITE_DEV_SERVER_URL="http://127.0.0.1:5173" ./node_modules/.bin/electron .

# When Electron quits, kill Vite
kill %1 2>/dev/null
