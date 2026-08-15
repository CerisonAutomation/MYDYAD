const buildTestWritingGuidance = (emitInstruction: string) =>
  `# Writing end-to-end tests

When writing an end-to-end (e2e) test for a feature or flow, write a Playwright test.

- FIRST, explore the codebase before writing any test. Read the relevant routes, pages, and components for the flow under test so your test reflects how the app ACTUALLY behaves — the real URLs/paths, the actual labels, roles, and placeholder text of the elements you'll target, the form fields and their validation, and any auth or data requirements. Do NOT guess selectors or invent UI that doesn't exist; base every locator and assertion on what you find in the code.
- Write the spec file under the app's \`e2e-tests/\` folder, named after the flow (e.g. \`e2e-tests/signup.spec.ts\`).
${emitInstruction}
- Make sure \`@playwright/test\` is installed as a dev dependency. If it isn't already in \`package.json\`, install it (Playwright is required to run the test).
- Import from \`@playwright/test\`: \`import { test, expect } from "@playwright/test";\`.
- Do NOT create or edit \`playwright-dyad.config.ts\`. Dyad generates and owns that file, and every test run uses it: it points \`baseURL\` at the running dev server via the \`DYAD_TEST_BASE_URL\` env var and configures the reporter, workers, and browser. You do NOT need to write a Playwright config at all — just write specs under \`e2e-tests/\`.
- Navigate with \`await page.goto("/")\` — the base URL is configured automatically, so use app-relative paths.
- Prefer role- and text-based locators (\`page.getByRole\`, \`page.getByText\`, \`page.getByLabel\`, \`page.getByPlaceholder\`) over CSS/XPath selectors. They are far more robust.
- Rely on \`await expect(locator).toBeVisible()\` / \`toHaveText()\` etc. — these auto-wait, so you do NOT need manual sleeps or \`waitForTimeout\`.
- When a UI element is hard to target reliably, add a \`data-testid\` attribute to the component you build and select it with \`page.getByTestId("...")\`. It's fine to edit the app's components to add \`data-testid\`s for this purpose.
- Keep each test focused on one happy-path user flow. Write tests that the app is expected to PASS.
- These tests are a starting point for the user to review and re-run — keep them simple and readable.

## Debugging a failing test

When a test is failing and you're asked to fix it, do NOT guess at the cause from the error message alone. Playwright writes concrete failure evidence to a \`test-results/<test-name>/\` folder on every failure — READ it FIRST, before changing anything:
- \`error-context.md\` — an accessibility-tree snapshot of the page at the moment of failure. This is the most useful artifact: it shows what was ACTUALLY on the page (the roles, labels, and text that were present), which tells you whether your locator was wrong or the app never rendered what the test expected.
- \`test-failed-1.png\` — a screenshot of the page at the point of failure. Look at it to see the real UI state (an error page, a loading spinner, an empty list, a modal covering the target, etc.).

The error message and test output usually reference these paths directly — open them. Use what you find to decide whether the TEST's expectation is wrong (fix the locator/assertion) or the APP is broken (fix the app), then fix the real cause instead of tweaking selectors blindly.

## Isolated test data (database-connected apps)

For Dyad-managed Neon and Supabase apps, Dyad isolates each test session so tests can create, update, and delete data without touching the user's real data. Depending on the provider this is either a temporary, throwaway COPY of the database, or a dedicated, pre-provisioned TEST USER whose data is scoped by Row-Level Security. You do NOT need to write any setup/teardown code; Dyad handles the isolation around the run.

Custom databases, custom backends, and providers Dyad cannot manage may NOT be isolated. If the Tests panel warns that isolation is unavailable, assume the test can touch the app's current data: keep setup minimal, avoid destructive flows unless the user explicitly asks for them, and prefer creating disposable records through the app itself.

Because the isolated session starts effectively empty (a fresh copy, or a brand-new user that owns no rows yet), do NOT assume specific rows exist. Instead, set up the data each test needs as part of the test (fixtures), then assert against it.

### Fixtures: seeding the data a test needs

- Put reusable setup in files under \`e2e-tests/fixtures/\` (e.g. \`e2e-tests/fixtures/todos.ts\`) and import them into your specs. Write fixtures as plain files so the user can review and edit them — never hide setup in a way that regenerates differently each run.
- Seed data THROUGH THE APP (its UI or its API routes), the same way a user would — e.g. create a todo by filling the app's "new todo" form, or POSTing to the app's own API route. This guarantees the data is written within the isolated session (the throwaway copy, or owned by the isolated test user so Row-Level Security scopes it correctly).
- Do NOT seed by connecting to the database directly from the test, and do NOT run SQL/migrations against the database while authoring the test — that would write to the user's REAL data, outside the isolated session.
- Base the fixture data on the app's actual schema and on what the specific test needs. Keep it minimal: seed only what the test asserts on.

### Improving a recorded test

When asked to improve a test Dyad's recorder generated, PRESERVE its recorded interactions, locators, and its \`signIn\` fixture usage — your job is to make the flow's outcomes verified, not to rewrite the flow or re-pick the selectors.

### Authenticated tests (signing in a test user)

This section applies ONLY when the specific flow under test genuinely requires a logged-in user. If the flow is reachable without signing in, or the user asked for a test that doesn't need authentication (or explicitly doesn't want auth), skip everything below — test the reachable flow as it is and do NOT add any login/signup UI. Note that \`process.env.DYAD_TEST_USER_*\` being set means Dyad provisioned a test user for the session; it does NOT mean this particular test needs a login. If a flow truly can't be tested without a sign-in that the app doesn't have yet, say so and ask the user before building auth — don't add it silently.

When a flow requires a logged-in user, use the built-in auth fixture in \`e2e-tests/fixtures/test-user.ts\` instead of hand-rolling credentials. Expose a \`signIn(page)\` helper (and \`signUp\` where relevant) from there and import it into your specs.
- If \`e2e-tests/fixtures/test-user.ts\` already exists (Dyad's test recorder generates it), REUSE its \`signIn(page)\` — import and call it. Do NOT hand-roll credentials, re-implement it, or drive the login UI when it exists; it already signs in programmatically from \`process.env.DYAD_TEST_USER_*\`.
- Otherwise, if \`process.env.DYAD_TEST_USER_EMAIL\` and \`process.env.DYAD_TEST_USER_PASSWORD\` are set, Dyad has ALREADY provisioned an isolated test user (for Supabase AND Neon Auth apps) — read the credentials from those env vars and sign that user in (via the fixture, or by driving the app's OWN login UI). Do NOT sign them up; they already exist. If the flow needs a login and the app has no login UI yet, build one before writing the auth-gated test.
- Otherwise, define a shared test user and create it by driving the app's OWN signup flow (so the user can really authenticate). If the flow needs a login and the app has no signup flow yet, build one (or an equivalent way to create a user) first. Say so clearly if you add it.
- Never INSERT users directly into auth tables; that commonly produces a user that exists but cannot log in.
- If you sign in programmatically with \`page.request.*\` against the app's own auth endpoint, remember that \`page.request\` is an API client, not the browser — it sends no \`Origin\`/\`Referer\`, and \`signIn\` typically runs before the first navigation (the page is still \`about:blank\`). Auth servers with a CSRF / trusted-origin check (e.g. Better Auth) answer that with a 403. Pass the app's own origin explicitly: \`const origin = new URL(process.env.DYAD_TEST_BASE_URL || "http://localhost:32100").origin;\` then send \`headers: { origin, referer: origin + "/" }\`. A 403 from a sign-in endpoint is almost always this, not bad credentials — fix the test, not the app.`;

/**
 * Guidance for running tests and iterating on failures with the `run_tests`
 * tool. Appended to the agent test-writing guidance.
 */
const AGENT_RUN_TESTS_GUIDANCE = `## Running tests and fixing failures

After you write or edit a spec, VERIFY it with the \`run_tests\` tool — never claim a test works without running it. \`testFile\` is required: always pass the single spec you're working on (e.g. \`run_tests({ testFile: "e2e-tests/signup.spec.ts" })\`) so you get fast, focused feedback. By default the whole file runs, so a pass means every test in the spec passes.

Run the whole file by default. Only narrow the run with \`grep\` (a regex matched against \`test()\` titles, same as Playwright's --grep, e.g. \`run_tests({ testFile: "e2e-tests/signup.spec.ts", grep: "user can sign up" })\`) when you have a specific reason — typically when ONE test keeps failing while the spec's other tests already passed and rerunning them all is slow. A narrowed pass only verifies the tests it matched, not the rest of the file. If the pattern matches no title, the tool runs nothing and replies with the titles that DO exist.

Use the EXACT path of a spec that exists under e2e-tests/ — don't guess it. If your \`testFile\` doesn't match a real spec, \`run_tests\` runs nothing and replies with the specs that DO exist so you can retry with a correct path.

Unless you just wrote or edited the spec this turn, READ it with \`read_file\` before running it. You need its current content to target a test by title with \`grep\` and to judge whether a failure comes from the test or the app — never run or edit a spec you haven't seen this turn.

The tool needs the app's dev server to be running; if it reports the app isn't running, ask the user to start it with the Run button in the preview panel.

When \`run_tests\` reports a failure, work the fix loop:
1. READ the \`error-context.md\` the result points at (use \`read_file\`) — it's the page snapshot and the most useful artifact. The failure screenshot is attached as an image; look at it too. Only read the artifacts from the CURRENT run's directory.
2. Decide whether the TEST is wrong (fix the locator/assertion) or the APP is wrong (fix the app), then make ONE targeted change.
3. Call \`run_tests\` again for the same spec.
4. If the tool says your last change did NOT alter the failure, do NOT retry a small variation — step back and try a different approach (a different locator strategy, or inspect the app code more closely).
5. If you suspect the failure is flaky (passes/fails inconsistently) rather than a real bug, rerun once with \`flakeCheck: true\` — this doesn't count against the attempt limit.

You have a limited number of fix attempts per spec (the tool tells you how many remain). When it says the limit is reached, STOP editing and running: summarize for the user what the test covers, what still fails, what you tried, and what you recommend.

When a task touches multiple specs, verify each one with its own \`run_tests\` call — one spec per call.`;

/**
 * Proactive test-maintenance policy for the local agent. Only injected when the
 * app has opted into testing, so the agent keeps the e2e suite in sync with
 * feature work by default — without waiting to be asked.
 */
const AGENT_PROACTIVE_TESTS_GUIDANCE = `# Keeping end-to-end tests up to date

This app has end-to-end testing enabled, so treat test coverage as PART OF THE WORK, not a separate favor to wait for. Whenever you finish implementing or changing app behavior, keep the \`e2e-tests/\` suite in sync in the SAME turn:

- **Added a new user-facing feature or flow** (a new page, form, action, CRUD operation, auth flow, or meaningful interaction) → write a new Playwright spec covering its happy path.
- **Changed how an existing feature behaves** → find the spec(s) that cover it and update them to match the new behavior rather than creating a duplicate; only add a new spec when no existing one covers the flow.
- **Review existing tests for impact — ALWAYS, whether you added or modified behavior.** Any change to app behavior can break specs that exercise the code paths you touched (a renamed label, a moved route, a changed field, a new required step). Before finishing, look at the EXISTING tests that might be affected and decide which need updating:
  - \`list_files\` on \`e2e-tests/\`, then \`read_file\` the specs whose flows touch what you changed — the ones that visit the affected route/page, target the elements you edited, or depend on the behavior you altered. This is a STATIC code review of the spec files; you do NOT need to run the whole suite to figure out which are affected.
  - Update any spec whose selectors, assertions, navigation, or setup no longer match the app's new behavior. Leave unrelated specs alone.
  - If, after reading them, none of the existing specs are affected, that's fine — say so briefly and move on.

Use judgment about what DESERVES a test — don't test everything:
- DO cover meaningful, user-facing behavior a user could break: the core flows of the feature you just built or changed.
- SKIP purely cosmetic or non-behavioral changes: styling/layout tweaks, copy/text edits, refactors that don't change behavior, config changes, and internal-only code. Don't add a test for these.
- Keep it proportionate: ONE focused happy-path spec per feature/flow is usually enough. Don't bloat the suite with redundant or trivial tests.

After writing or updating a spec, VERIFY it with \`run_tests\` and fix any failures (see below) before you consider the task done. Briefly tell the user which flow you added or updated a test for.

If you're genuinely unsure whether a change warrants a test, lean toward covering real user-facing behavior; skip it (and say so) for trivial changes.`;

/**
 * Guidance for the recorder's test proposal, which goes through the
 * `generate_test_assertions` tool's review card instead of a file write.
 */
const AGENT_RECORDED_TEST_GUIDANCE = `## A test proposal for a just-recorded flow

Dyad's recorder captures a flat list of interactions and does NOT write a file. When the user asks for assertions on a flow they just recorded, their message contains the recorded statements, numbered. There is nothing to \`read_file\` — the spec does not exist yet.

Call \`generate_test_assertions\` with a name for the test, one plain-English step description per statement, plus the assertions you'd propose, then WAIT for its result. Name it from what the steps actually do, unless the user already named it, in which case use theirs exactly. It shows the user a card where they can reword, delete, add, and reorder assertions, and it does not return until they answer it. While that card is open there is nothing to edit and nothing to run — do not call \`run_tests\`.

Approving the card is what generates the spec file. The tool then returns to you, in this same turn, with the path it wrote: verify that spec with \`run_tests\` and fix any failures as usual. If the tool comes back saying the card was closed without approving, no file was written — don't run anything and don't propose again.

This applies only to a recording that hasn't become a file yet. Write and edit specs that exist on disk normally with \`write_file\` / \`search_replace\`.`;

/**
 * Local-agent test-writing guidance: proactively keep tests in sync, write the
 * spec with the `write_file` tool, then verify and iterate with `run_tests`.
 * Dyad detects `.spec.ts` files and surfaces them in the Tests panel where the
 * user can also run them.
 */
export const AGENT_TEST_WRITING_GUIDANCE = `${AGENT_PROACTIVE_TESTS_GUIDANCE}

${buildTestWritingGuidance(
  `- Write it with the \`write_file\` tool to a path ending in \`.spec.ts\` under \`e2e-tests/\` (e.g. \`e2e-tests/signup.spec.ts\`). Dyad detects \`.spec.ts\` spec files and surfaces them in the Tests panel where the user can run them.`,
)}

${AGENT_RECORDED_TEST_GUIDANCE}

${AGENT_RUN_TESTS_GUIDANCE}`;
