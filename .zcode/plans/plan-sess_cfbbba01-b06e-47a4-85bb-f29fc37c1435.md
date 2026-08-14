## Game-Changing Improvements — Execution Plan

### Phase 1: Critical Infrastructure

1. **Shared file tree walker** — eliminate 12 duplicated `walkDirectory` implementations, add depth limits, maxFiles, file size guards, shared EXCLUDE_DIRS
2. **Fix write_file.ts sync I/O** → async
3. **Add concurrency guards** to `symbol_ops`, `ts_ast_summary`, `test_generator`, `documentation_generator`

### Phase 2: Fix Broken Tools

4. **Fix git_branches ahead/behind** — always returns 0
5. **Fix 4 git tools** throwing raw Error instead of DyadError
6. **Add output size limiting** to `git_diff_staged`, `git_log_file`, `review_pr`
7. **Standardize git execution** in `review_pr` and `repo_pulse` (raw spawn → promisify)

### Phase 3: Game-Changing UX

8. **Inline diff in chat tool cards** — DyadWrite/DyadEdit show before/after diff
9. **Auto-collapse completed tool cards** — reduce visual noise
10. **Debug bundle export UI** — button in Help dialog + Settings

### Phase 4: Missing Workflow Tools

11. **git_commit tool** — agent can't commit
12. **format_code tool** — agent can't format

### Phase 5: Hardening

13. **File size guards** on all file-reading tools (skip >1MB)
14. **Depth limits** on unbounded file walks

Verification: lint + format + type-check after each phase.
