# Dyad CLI Scripts (Agent2 Mode)

## Quick Start

```bash
# Launch Dyad in Agent2 mode (BYOK providers)
dyad

# Launch with custom engine (optional)
dyad --engine=http://localhost:8080/v1

# Quick rebuild main process only
dyad-rebuild

# Quick launch (skip build if exists)
dyad-quick
```

## Available Scripts

### `dyad` — Full Launcher

The main launcher with best practices:

- ✅ Process cleanup (kills stale Electron, Vite, esbuild)
- ✅ Port clearing (5173, 5174, 8080, 3000)
- ✅ Memory optimization (4GB heap)
- ✅ DNS fix (c-ares bug)
- ✅ Lock file cleanup

**Options:**

- `--engine=<URL>` — Use custom engine (e.g., `--engine=http://localhost:8080/v1`)
- `--engine <URL>` — Same as above
- `--local-engine` — Use local engine at `http://localhost:8080/v1`

**Default:** BYOK mode (no cloud engine)

### `dyad-rebuild` — Fast Rebuild

Rebuild only the main process without restarting Electron:

```bash
dyad-rebuild
# Then restart Electron: dyad
```

### `dyad-quick` — Quick Launch

Skip build if `main.js` already exists:

```bash
dyad-quick
```

## Engine Options

### BYOK Mode (Default)

```bash
dyad
# All LLM calls go directly to your providers
# No cloud engine, no subscription
```

### Custom Engine (Optional)

```bash
dyad --engine=http://localhost:8080/v1
# Uses your custom backend engine
# Set DYAD_ENGINE_URL environment variable
```

### Local Engine

```bash
dyad --local-engine
# Shorthand for --engine=http://localhost:8080/v1
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Dyad App (Agent2 Mode)                │
├─────────────────────────────────────────────────────────┤
│  Main Process (Node.js)                                 │
│  ├── LLM Providers (BYOK)                               │
│  │   ├── OpenAI                                         │
│  │   ├── Anthropic                                      │
│  │   ├── Google                                         │
│  │   ├── Groq                                           │
│  │   ├── OpenRouter                                     │
│  │   └── Custom (LM Studio, Ollama, etc.)               │
│  ├── Local Tools                                        │
│  │   ├── web_search (DuckDuckGo + SearXNG)              │
│  │   ├── web_fetch (built-in fetch)                     │
│  │   ├── web_crawl (local HTML parser)                  │
│  │   ├── code_search (ripgrep)                          │
│  │   └── generate_image (Pollinations.ai)               │
│  └── Optional Engine                                    │
│      └── DYAD_ENGINE_URL (if set)                       │
├─────────────────────────────────────────────────────────┤
│  Renderer Process (React)                               │
│  ├── Chat Interface                                     │
│  ├── Code Editor                                        │
│  ├── Settings                                           │
│  └── All UI Components                                  │
└─────────────────────────────────────────────────────────┘
```

## Troubleshooting

### Port Already in Use

```bash
# Kill processes on specific port
lsof -ti :5173 | xargs kill -9
lsof -ti :5174 | xargs kill -9
```

### Memory Issues

```bash
# Check memory usage
ps aux | grep -E "Electron|vite|esbuild"

# Restart with lower memory limit
NODE_OPTIONS="--max-old-space-size=2048" dyad
```

### Build Errors

```bash
# Clean rebuild
cd /Users/cb/Downloads/dyad-main
rm -rf .vite/build/
dyad-rebuild
```

### Engine Connection Issues

```bash
# Test engine URL
curl http://localhost:8080/v1/models

# Check environment
echo $DYAD_ENGINE_URL

# Reset to BYOK mode
unset DYAD_ENGINE_URL
dyad
```

## Performance Tips

1. **Use `dyad-quick`** — Skip build if already built
2. **Use `dyad-rebuild`** — Rebuild only when source changes
3. **Monitor memory** — Check `Activity Monitor` for Electron processes
4. **Kill stale processes** — Use `pkill -9 -f "Electron"` if app hangs

## Environment Variables

| Variable          | Default                       | Description          |
| ----------------- | ----------------------------- | -------------------- |
| `DYAD_ENGINE_URL` | `""` (disabled)               | Custom engine URL    |
| `NODE_OPTIONS`    | `"--max-old-space-size=4096"` | Node.js memory limit |
| `DNS_NO_ARES`     | `1`                           | Fix c-ares DNS bug   |

## Support

- **Issues**: Check console output for errors
- **Logs**: `~/Library/Application Support/dyad/logs/`
- **Config**: `~/Library/Application Support/dyad/`
