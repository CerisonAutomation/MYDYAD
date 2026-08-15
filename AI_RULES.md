# AI_RULES.md

## Tech Stack

- **Electron** desktop app (main process + renderer process, preload bridge via IPC)
- **Vite** for bundling (separate configs: main, preload, renderer, sandbox-worker, code-explorer-worker)
- **React 19** with **TypeScript 6** (strict mode, `react-jsx` transform)
- **Tailwind CSS v4** with `@tailwindcss/vite` plugin (NOT the PostCSS plugin)
- **Jotai** for client-side atomic state management
- **TanStack React Query** for async data fetching, caching, and server-state management
- **TanStack React Router** for file-based-style routing (routes defined in `src/routes/`, wired in `src/router.ts`)
- **better-sqlite3** + **Drizzle ORM** for local SQLite database (schema in `src/db/schema.ts`)
- **Vercel AI SDK** (`ai` package) for LLM streaming with multiple provider adapters (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/xai`, etc.)
- **Vitest** for unit/integration tests, **Playwright** for E2E tests, **Storybook** for component development

## Library Rules

### UI Components — Use shadcn/ui (Radix-based)
- Always use prebuilt shadcn/ui components from `src/components/ui/` for standard UI primitives: buttons, dialogs, dropdowns, inputs, selects, tabs, tooltips, accordions, cards, badges, etc.
- Import from `@/components/ui/...` — do NOT create raw HTML equivalents when a shadcn component exists.
- Use `class-variance-authority` (CVA) + `tailwind-merge` + `clsx` (via the `cn()` utility) for composing variant styles.
- Use **Lucide React** (`lucide-react`) for all icons.

### Styling — Tailwind CSS Only
- Use **Tailwind CSS utility classes** for all styling. No CSS modules, no styled-components, no inline style objects.
- Use the `cn()` helper (`clsx` + `tailwind-merge`) for conditional/merged class names.
- Theme tokens are defined as CSS custom properties and referenced via Tailwind.

### State Management
- Use **Jotai** atoms for UI state that needs to be shared across components (see `src/atoms/`).
- Use **TanStack React Query** for any data that comes from IPC handlers / backend queries and mutations.
- Do NOT use Redux, Zustand, or React Context for global state — Jotai + React Query cover all needs.

### Routing
- Use **TanStack React Router** (NOT React Router DOM). Routes are defined in `src/router.ts`.
- Page components go in `src/routes/` and are imported into the router tree.
- Use `useNavigate`, `useSearch`, `useParams` from `@tanstack/react-router`.

### Forms & Validation
- Use **Zod** for schema validation and runtime type checking.
- Use **Lexical** (`@lexical/react`) for rich text editing (chat input).
- Use native form elements styled with shadcn/ui components — no Formik or React Hook Form.

### Animations
- Use **Framer Motion** (`framer-motion`) for animations and transitions.

### Data Tables & Lists
- Use **react-virtuoso** for virtualized scrolling of long lists.
- Use **Fuse.js** for client-side fuzzy search.

### Markdown & Code
- Use **react-markdown** with `remark-gfm` for rendering markdown.
- Use **react-shiki** / **shiki** for syntax highlighting.
- Use **Monaco Editor** (`@monaco-editor/react`) for the code editor view.

### Terminal
- Use **xterm.js** (`@xterm/xterm`) with its addon ecosystem for the embedded terminal.

### Toasts & Notifications
- Use **Sonner** (`sonner`) for toast notifications — imported from `@/components/ui/sonner` or directly from `sonner`.

### Internationalization
- Use **i18next** + **react-i18next** for translations. Locale files are in `src/i18n/locales/`.

### Database
- Use **Drizzle ORM** for all database interactions. Schema is in `src/db/schema.ts`.
- Tables use `better-sqlite3` (local SQLite). Do NOT use raw SQL unless absolutely necessary.
- Run schema migrations with `drizzle-kit generate` / `drizzle-kit push`.

### IPC Communication
- The renderer communicates with the Electron main process via a typed IPC bridge (`src/ipc/`).
- All IPC handlers are registered in `src/ipc/handlers/`. Types are in `src/ipc/preload/channels.ts`.
- Never import main-process-only modules (like `electron`, `fs`, `better-sqlite3`) directly in renderer code.

### Testing
- **Vitest** for unit and integration tests (`src/__tests__/`, colocated `*.test.ts` / `*.test.tsx` files).
- **Playwright** for E2E tests (`e2e-tests/`).
- **Storybook** for visual component development (`src/**/*.stories.tsx`).
- Test files should be colocated with the source they test (e.g., `MyComponent.tsx` → `MyComponent.test.tsx`).

### Linting & Formatting
- Use **oxlint** for linting (`npx oxlint --fix`).
- Use **oxfmt** for formatting (`npx oxfmt`).
- Pre-commit hooks run via **Husky** + **lint-staged**.

### Analytics
- Use **PostHog** (`posthog-js`) for telemetry. Always check opt-in status before capturing events.

### AI / LLM Integration
- Use the **Vercel AI SDK** (`ai` package) for streaming LLM responses.
- Provider-specific adapters are in `@ai-sdk/*` packages.
- Use **MCP SDK** (`@modelcontextprotocol/sdk`) for Model Context Protocol tool integrations.

## Project Structure

- `src/` — All source code
- `src/components/` — Reusable React components (shadcn/ui primitives in `src/components/ui/`)
- `src/routes/` — Page-level route components
- `src/hooks/` — Custom React hooks
- `src/atoms/` — Jotai atom definitions
- `src/lib/` — Shared utilities and helpers
- `src/contexts/` — React context providers (use sparingly — prefer Jotai)
- `src/i18n/` — Internationalization config and locale files
- `src/db/` — Database schema and connection
- `src/ipc/` — IPC handler registration and type definitions
- `e2e-tests/` — Playwright E2E test specs and helpers
- `packages/` — Internal workspace packages (e.g., `pg-schema-classifier`, `ts-pg-schema-diff`)
- `workers/` — Web Worker source code (code explorer, Supabase dependency analysis)

## Conventions

- Path alias: `@/` maps to `src/` (configured in `tsconfig.app.json` and `vite.renderer.config.mts`).
- All components use TypeScript with strict mode. Prefer explicit types over `any`.
- Export components as named exports (not default exports) unless the file is a route/page module.
- Keep components small and focused. Extract reusable pieces into separate files.
- Co-locate tests, stories, and related utilities with their source files.
- Use `use-mobile.ts` hook for responsive behavior detection.
- Use `useSettings()` hook for accessing user preferences.
