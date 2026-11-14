# PLAN — CHR-Nexus audit fixes (2026-11-15)

Source: read-only audit by designer, reviewer (frontend), reviewer (backend), security, tester.
Full reports: scratchpad `audit/*.md`. Nothing has been changed yet.

Rules for every slice: write only to CHR-Nexus code/DB; ERP .10 / StorePC / EDP_SYSTEM stay read-only; CIMS untouched;
no change to business rules (stock math, permissions model, plan formulas); each slice builds clean (tsc / eslint / next build / dotnet build) and is its own commit.

## Slice 1 — Security (backend agent) · risk: medium · undo: revert commit
1. Chat / Support attachments: block .html .htm .svg .xhtml .xml .mht; non-images always download (Content-Disposition: attachment) + `Content-Security-Policy: sandbox` + `X-Content-Type-Options: nosniff`.
2. User admin: only Master Admin / Level 1 may edit, reset password of, or change permissions of a Master Admin or a higher-level user; nobody edits their own permissions; Add cannot create a level above the caller.
3. Login: check the password before the "online on another machine" check; count that branch in LoginGuard.
4. Error replies: `Fail(ex)` returns a Thai generic message, full detail goes to BUG LOG only (no SQL text / server paths to users).
5. X-Forwarded-For: trust only the value set by our own Next proxy (last hop) — verify Next behaviour first.
6. Lookup / product detail / PR reads: add the same stock-access check the write paths use.
7. Cookie: Secure when the request is HTTPS behind the proxy (ForwardedHeaders).

## Slice 2 — DB / server load (backend agent) · risk: medium · undo: revert commit
1. StockService.GetStocks: shared cache ~5 s (cleared on any stock save) → LiveWatcher, live long-poll, RemarkAutoClear stop reloading all stocks every second.
2. Change-token queries: WITH (NOLOCK); StorePC live-view polled every 5 s instead of 1 s; minimum 300 ms between write-triggered checks.
3. RemarkAutoClear: run only when data changed (DataVersion), not on page-open / chat events.
4. MIN REPORT sweep: update LastSeen / MERGE only rows that changed, in one batch.
5. Scanner "today": one set-based balance query instead of one connection per part; a DB error shows an error, not stock 0.
6. Activity Log: ActionType list cached; search queries get CommandTimeout + NOLOCK.
7. LiveCache: bounded (evict old keys); BugLog / LogService background writes capped (no pool exhaustion); LiveWatcher logs failures as Warning + CommandTimeout.
8. AuthService.cs:159 `throw ex;` → `throw;`.

## Slice 3 — Frontend bugs (frontend agent) · risk: low
1. Session: only a real 401 sends the user to Login (network blip / 500 keeps the page and unsaved input).
2. Esc / Enter close or confirm only the topmost modal / dialog.
3. Chat: no red toast every 4 s when server is down (one notice, quiet retry with backoff); ignore late replies after switching chat; no overlapping polls.
4. Stale-chunk reload flag cleared after a successful load (tabs open across deploys recover).
5. Save buttons busy-locked (FormatsModal, EdpPlanning, ApprovedModal) — no double submit.
6. Pick List / ApprovedModal: ignore out-of-date responses; skip re-render when data unchanged.
7. Safe date formatting helper everywhere ("-" instead of "Invalid Date"); live long-poll stops retrying on 401, adds jitter.

## Slice 4 — Motion & style consistency (frontend agent, designer review) · risk: low
1. One page entrance: `.page-in` (PageBody) uses the launcher-style rise; remove the stacked template motion in EDP/PP/CHEM; route-reveal only for pages without PageBody.
2. `<MotionConfig reducedMotion="user">` in Providers; one `--ease-drop` in :root; replace `transition: all` and default easing with the house curve.
3. Sidebar / glider / gauge / tooltip: animate transform instead of width/left/height (no reflow, smoother on low-spec PCs).
4. Hover lift / scale only on `(hover: hover)` devices (no stuck hover on phones / iPad).
5. Tab switches (MIN REPORT, Admin modal, Support chat…) fade/rise like the rest.
6. One global focus ring (keyboard users); contrast of light-blue / green / red CTA buttons and EDP date arrows raised to ≥ 4.5:1 (same hue, deeper shade).
7. One skeleton `Loading()` (Thai, aria-live) replacing the ~12 "⏳ LOADING..." texts; friendlier error page (Thai, no raw error text) + not-found page.
8. Modal: focus trap / restore, `dvh` height.

## Slice 5 — Every screen size (frontend agent, designer review) · risk: low
1. FitTables phone-card view extended to pp-matrix, ch-table, ff-table, wl-table (or a scroll hint where cards don't fit, e.g. PP capacity matrix).
2. Fixed widths that slip past the phone safety net: ProductionGraph inline width 360, `.pp-pickm>label`, `!w-[...]`, PP sticky column on phones.
3. `vh` → `dvh` where it cuts content on iPhone / iPad.
4. Login page: bound labels, show-password, readable helper text.

## Slice 6 — Tests + docs (tester, docs, devops)
1. First automated tests (pure logic, no DB): pp.ts calcMachine / groupSum, format helpers, PackingCardBarcodeParser, Qty.
2. reviewer re-checks each slice's diff; security re-checks slice 1.
3. Handbook artifact history row; devops deploy checklist (deploy-pm2.cmd) + rollback (revert commits).

## Not in scope / needs the owner
- Plain-text passwords shared with CIMS (needs joint change with CIMS).
- GitHub check ❌ on main: not from repo files (no .github/workflows) — open the Checks tab on commit 27b12fb to see which external app.
- View definitions vw_StockSummary / vw_StockMonitoring / vw_StorePcLive were not reviewed (severity of slice 2 items 1–3 depends on them).
