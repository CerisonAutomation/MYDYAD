#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  DYAD BULLETPROOF LAUNCHER
#  Handles: singleton locks, port conflicts, auto-update crashes,
#  stale processes, cache corruption, missing deps
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

CDYAD_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="/tmp/dyad-launcher"
mkdir -p "$LOG_DIR"

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
fail() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ─── Phase 1: Kill Everything ─────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  DYAD BULLETPROOF LAUNCHER"
echo "═══════════════════════════════════════════════════"
echo ""

echo "Phase 1: Cleaning up..."
# Kill all Dyad/Electron instances
for proc in "Dyad-Zenith" "Electron.*dyad" "electron.*dyad-main"; do
  pkill -9 -f "$proc" 2>/dev/null || true
done
sleep 2

# Kill any vite processes on port 5173
lsof -ti:5173 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

# Remove singleton locks
rm -f ~/Library/Application\ Support/dyad/SingletonLock
rm -f ~/Library/Application\ Support/dyad/SingletonSocket
rm -f ~/Library/Application\ Support/dyad/SingletonCookie
log "All instances killed, locks removed"

# ─── Phase 2: Fix Settings ────────────────────────────────────────
echo ""
echo "Phase 2: Fixing settings..."

SETTINGS=~/Library/Application\ Support/dyad/user-settings.json
if [ -f "$SETTINGS" ]; then
  # Disable auto-update (causes Squirrel crash on macOS 26)
  if grep -q '"enableAutoUpdate": true' "$SETTINGS" 2>/dev/null; then
    sed -i '' 's/"enableAutoUpdate": true/"enableAutoUpdate": false/' "$SETTINGS"
    warn "Disabled auto-update (was causing crashes)"
  fi
  log "Settings OK"
else
  warn "No settings file found — will create on first launch"
fi

# ─── Phase 3: Clear Corrupt Caches ────────────────────────────────
echo ""
echo "Phase 3: Clearing caches..."
rm -rf ~/Library/Application\ Support/dyad/Cache 2>/dev/null
rm -rf ~/Library/Application\ Support/dyad/Code\ Cache 2>/dev/null
rm -rf ~/Library/Application\ Support/dyad/GPUCache 2>/dev/null
rm -rf ~/Library/Application\ Support/dyad/DawnWebGPUCache 2>/dev/null
rm -rf ~/Library/Application\ Support/dyad/DawnGraphiteCache 2>/dev/null
log "Caches cleared"

# ─── Phase 4: Check Node.js ───────────────────────────────────────
echo ""
echo "Phase 4: Checking Node.js..."

cd "$CDYAD_DIR"

# Load fnm
export PATH="$HOME/.local/share/fnm:$HOME/.fnm:$PATH"
eval "$(fnm env 2>/dev/null)" || true

# Try to use Node 24
if fnm list 2>/dev/null | grep -q "24"; then
  fnm use 24.15.0 2>/dev/null || fnm use 24 2>/dev/null || true
fi

NODE_VER=$(node --version 2>/dev/null || echo "NOT FOUND")
ELECTRON_VER=$(./node_modules/.bin/electron --version 2>/dev/null || echo "NOT FOUND")

if [ "$NODE_VER" = "NOT FOUND" ]; then
  fail "Node.js not found. Run: fnm install 24.15.0"
fi
if [ "$ELECTRON_VER" = "NOT FOUND" ]; then
  fail "Electron not found. Run: npm install"
fi

log "Node: $NODE_VER, Electron: $ELECTRON_VER"

# ─── Phase 5: Verify node_modules ─────────────────────────────────
echo ""
echo "Phase 5: Verifying dependencies..."

if [ ! -d "node_modules/electron" ]; then
  warn "node_modules missing — running npm install..."
  npm install --force 2>&1 | tail -3
fi

if [ ! -f "node_modules/.bin/electron" ]; then
  fail "Electron binary missing. Run: npm install"
fi

if [ ! -f "node_modules/.bin/vite" ]; then
  fail "Vite binary missing. Run: npm install"
fi

log "Dependencies OK"

# ─── Phase 6: Start Vite ──────────────────────────────────────────
echo ""
echo "Phase 6: Starting Vite dev server..."

# Verify Vite config exists
if [ ! -f "vite.renderer.config.mts" ]; then
  fail "vite.renderer.config.mts not found"
fi

# Start Vite
npx vite --config vite.renderer.config.mts --port 5173 --host 127.0.0.1 \
  > "$LOG_DIR/vite.log" 2>&1 &
VITE_PID=$!

# Wait for Vite to be ready (up to 30 seconds)
echo -n "  Waiting for Vite"
READY=false
for i in $(seq 1 30); do
  HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/ 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    READY=true
    break
  fi
  echo -n "."
  sleep 1
done
echo ""

if [ "$READY" = "false" ]; then
  fail "Vite failed to start after 30 seconds. Check $LOG_DIR/vite.log"
fi

# Verify Vite serves valid HTML
HTML_CHECK=$(curl -s http://127.0.0.1:5173/ | grep -c "renderer.tsx" || echo "0")
if [ "$HTML_CHECK" -eq 0 ]; then
  fail "Vite is running but not serving Dyad HTML"
fi

log "Vite ready on http://127.0.0.1:5173 (PID: $VITE_PID)"

# Warm up Vite — pre-compile bundles so Electron loadURL doesn't time out
echo "  Warming up Vite (pre-compiling bundles)..."
curl -s -o /dev/null http://127.0.0.1:5173/
curl -s -o /dev/null http://127.0.0.1:5173/
log "Vite warmed up"

# ─── Phase 7: Launch Electron ─────────────────────────────────────
echo ""
echo "Phase 7: Launching Electron..."

# Verify main process source exists
if [ ! -f "src/main.ts" ]; then
  fail "src/main.ts not found"
fi

MAIN_WINDOW_VITE_DEV_SERVER_URL="http://127.0.0.1:5173" \
  ./node_modules/.bin/electron . \
  > "$LOG_DIR/electron.log" 2>&1 &
ELECTRON_PID=$!

echo "  Electron PID: $ELECTRON_PID"

# ─── Phase 8: Verify App is Running ───────────────────────────────
echo ""
echo "Phase 8: Verifying app is running..."

# Wait up to 20 seconds for renderer to load
echo -n "  Waiting for renderer"
RENDERER_OK=false
for i in $(seq 1 20); do
  # Check if Electron is still alive
  if ! kill -0 $ELECTRON_PID 2>/dev/null; then
    echo ""
    echo ""
    fail "Electron crashed! Check $LOG_DIR/electron.log for errors:"
    tail -20 "$LOG_DIR/electron.log" 2>/dev/null
  fi

  # Check renderer memory (loaded = >50MB)
  RENDERER_MEM=$(ps aux | grep "Electron Helper (Renderer)" | grep -v grep | grep dyad | awk '{print $6/1024}' | head -1)
  if [ -n "$RENDERER_MEM" ]; then
    MEM_INT=$(echo "$RENDERER_MEM" | cut -d. -f1)
    if [ "$MEM_INT" -gt 50 ] 2>/dev/null; then
      RENDERER_OK=true
      break
    fi
  fi
  echo -n "."
  sleep 1
done
echo ""

if [ "$RENDERER_OK" = "false" ]; then
  warn "Renderer may not have loaded fully (memory: ${RENDERER_MEM:-0}MB)"
  warn "Checking for errors..."
  
  # Check for common errors
  if grep -q "ERR_CONNECTION_REFUSED" "$LOG_DIR/electron.log" 2>/dev/null; then
    fail "Connection refused — Vite may have crashed"
  fi
  if grep -q "SIGTERM" "$LOG_DIR/electron.log" 2>/dev/null; then
    fail "Process was killed"
  fi
fi

# ─── Phase 9: Final Status ────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo -e "  ${GREEN}✓ DYAD IS RUNNING${NC}"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  Main process:  $(ps aux | grep 'Dyad-Zenith.app\|electron .' | grep -v grep | awk '{sum+=$6} END {printf "%.0fMB", sum/1024}' 2>/dev/null || echo "?")"
echo "  Renderer:      ${RENDERER_MEM:-?}MB"
echo "  Vite:          http://127.0.0.1:5173"
echo "  Electron PID:  $ELECTRON_PID"
echo ""
echo "  Use Cmd+Tab to switch to the Dyad window."
echo "  Press Ctrl+C to stop."
echo ""

# Bring window to front
osascript -e 'tell application "System Events" to set frontmost of process "Electron" to true' 2>/dev/null || true

# ─── Phase 10: Monitor ────────────────────────────────────────────
# Wait for Electron to exit, then clean up
cleanup() {
  echo ""
  echo "Stopping Dyad..."
  kill $ELECTRON_PID 2>/dev/null
  kill $VITE_PID 2>/dev/null
  echo "Done."
}
trap cleanup EXIT INT TERM

wait $ELECTRON_PID 2>/dev/null || true
