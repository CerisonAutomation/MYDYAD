# GlitchTip Integration for Dyad

## Overview

GlitchTip is a free, open-source error tracking alternative to Sentry. This guide shows how to integrate GlitchTip with Dyad for automatic error reporting.

**Cost: $0** (local logging + self-hosted GlitchTip)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Dyad App                             │
├─────────────────────────────────────────────────────────────┤
│  Main Process                    │  Renderer Process        │
│  ┌─────────────────────┐        │  ┌─────────────────────┐ │
│  │ @sentry/electron    │        │  │ @sentry/react       │ │
│  │ (GlitchTip SDK)     │        │  │ (GlitchTip SDK)     │ │
│  └──────────┬──────────┘        │  └──────────┬──────────┘ │
│             │                   │             │             │
│             └───────────────────┼─────────────┘             │
│                                 │                           │
│                                 ▼                           │
│                    ┌─────────────────────────┐              │
│                    │   GlitchTip (Sentry-    │              │
│                    │   compatible API)       │              │
│                    │   http://localhost:9000 │              │
│                    └─────────────────────────┘              │
└─────────────────────────────────────────────────────────────┘
```

## Setup

### 1. Install Dependencies

```bash
cd /Users/cb/Downloads/dyad-main

# Install Sentry SDK (GlitchTip-compatible)
npm install @sentry/electron @sentry/react
```

### 2. Configure Environment Variables

Add to `.env`:

```bash
# GlitchTip Configuration
GLITCHTIP_DSN=http://localhost:9000/api/1/envelope/
VITE_GLITCHTIP_DSN=http://localhost:9000/api/1/envelope/
```

### 3. Initialize in Main Process

Edit `src/main.ts`:

```typescript
import { initGlitchTip } from "./main/glitchtip";

// Initialize GlitchTip before app ready
initGlitchTip();
```

### 4. Initialize in Renderer Process

Edit `src/renderer.tsx`:

```typescript
import { initGlitchTipRenderer } from "./lib/glitchtip";

// Initialize GlitchTip
initGlitchTipRenderer();
```

### 5. Start GlitchTip

```bash
cd ~/Developer/projects/glitchtip
docker-compose up -d
```

### 6. Run Dyad

```bash
cd /Users/cb/Downloads/dyad-main
npm run dev
```

## Usage

### Automatic Error Capture

Errors are automatically captured and sent to GlitchTip:

```typescript
// This will be automatically captured
throw new Error("Something went wrong");
```

### Manual Error Capture

```typescript
import { captureException, captureMessage } from "./main/glitchtip";

// Capture exception with context
captureException(new Error("API failed"), {
  endpoint: "/api/users",
  method: "POST",
  userId: "123",
});

// Capture message
captureMessage("User performed action", "info");
```

### User Tracking

```typescript
import { setUser } from "./main/glitchtip";

setUser({
  id: "user-123",
  email: "user@example.com",
  username: "john",
});
```

### Breadcrumbs

```typescript
import { addBreadcrumb } from "./main/glitchtip";

addBreadcrumb({
  category: "navigation",
  message: "User navigated to settings",
  data: { path: "/settings" },
});
```

## Viewing Errors

1. Open GlitchTip: http://localhost:9000
2. Login with your credentials
3. Navigate to **Issues** to see captured errors
4. Click on an issue to see details, stack traces, and context

## Cost Comparison

| Service           | Cost       | Notes                    |
| ----------------- | ---------- | ------------------------ |
| **Sentry**        | $26+/month | Paid for error tracking  |
| **GlitchTip**     | $0         | Self-hosted, open-source |
| **Local Logging** | $0         | No remote tracking       |

## Troubleshooting

### Errors Not Appearing

1. Check GlitchTip is running: `docker ps | grep glitchtip`
2. Verify DSN in `.env` matches GlitchTip URL
3. Check browser console for SDK errors
4. Ensure network requests to `localhost:9000` are not blocked

### SDK Not Initialized

1. Ensure `@sentry/electron` and `@sentry/react` are installed
2. Check import paths are correct
3. Verify `initGlitchTip()` is called before app ready

### Performance Impact

- SDK adds ~50KB to bundle
- Errors are sent asynchronously (no blocking)
- Sampling can be reduced in production

## Advanced Configuration

### Sample Rate

```typescript
Sentry.init({
  dsn: GLITCHTIP_DSN,
  tracesSampleRate: 0.1, // 10% of traces
  sampleRate: 0.5, // 50% of errors
});
```

### Environment-Specific

```typescript
Sentry.init({
  dsn: GLITCHTIP_DSN,
  environment: process.env.NODE_ENV,
  enabled: process.env.NODE_ENV === "production",
});
```

### Custom Tags

```typescript
Sentry.setTag("app.version", "1.10.0");
Sentry.setTag("user.plan", "pro");
```
