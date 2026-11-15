# HANDOFF — audit fixes (2026-11-15)

Branch `worktree-audit-fixes`, base 27b12fb, 8 commits (not pushed). Plan: PLAN.md.
Commits: ec10093 security · 0ee1072 FE bugs · c560d87 DB load · 73a890f motion/style · 564e2af security follow-up · 40ca7ec screen sizes · 356ef91 tests · e865af8 review follow-ups.
Verified by build only: `dotnet build` 0 errors; `npm run build`, `tsc --noEmit`, `eslint src` clean. Nothing rendered in a browser, nothing run against a DB.

## Status per PLAN slice

### Slice 1 Security
1. DONE chat/support attachments (html/htm/xhtml/svg/xml/mht/mhtml rejected; non-images download; CSP sandbox + nosniff; .bmp inline again).
2. DONE user-admin level rules (see below), incl. Delete, Excel import, self-permissions.
3. DONE login: password checked before "online elsewhere"; wrong password counted in LoginGuard.
4. DONE `Fail(ex)`: SQL/unknown errors -> Thai generic text, detail to BUG LOG. All `Fail(ex.Message)` sites routed through it.
   Caveat: exceptions whose text contains Thai, and InvalidOperation/InvalidData/Format, still pass through (services throw Thai user messages that way).
5. NOT DONE X-Forwarded-For: proxy chain in front of Next is not in the repo; "last hop" could be loopback and merge all users into one key.
6. PARTLY: stock-access check added to Products Detail/Coils and Lookup/parts (when a stock id is given). NOT DONE: PR list/parts/download, Lookup without stock id (would change who can use PR = business rule).
7. DONE cookie Secure when HTTPS or (loopback peer + `X-Forwarded-Proto: https`).

### Slice 2 DB load
1. DONE stock list cached 5 s, cleared on every stock save/create/delete/import. Part count (ItemCount) may lag <=5 s elsewhere.
2. DONE StorePC live view checked every 5 s (was 1 s), min 300 ms between rounds, 10 s command timeout, warnings throttled. NOLOCK on change tokens was added then REMOVED after the re-check (uncommitted-read risk); timeouts kept.
3. DONE remark auto-clear only when data changed, plus 30 s heartbeat sweep.
4. PARTLY MIN REPORT sweep: skips unchanged rows/snapshots. "Last updated" may lag <=60 s. NOT DONE: single batched write.
5. DONE scanner "today": one query per stock; DB error now returns 500 + BUG LOG instead of stock 0.
6. DONE Activity Log: NOLOCK, 60 s timeout on search, ActionType list cached 5 min.
7. DONE LiveCache max 500 keys; BugLog/LogService writers and queues capped (drops warn once/min).
8. DONE `throw;` in AuthService.

### Slice 3 Frontend bugs — all DONE (0ee1072, e865af8)
Only a real 401 goes to Login; Esc/Enter act on topmost window only; chat: one notice per outage, quiet retry, late replies ignored; stale-chunk reload cannot loop (no 2nd reload within 60 s); save buttons busy-locked; Pick List/Approved ignore stale responses; `fmtDate` shows "-" not "Invalid Date"; live long-poll stops on 401, jitter.
Gaps: first-ever load with a network error still lands on /login; no `sameData` skip in ApprovedModal.

### Slice 4 Motion/style (73a890f, e865af8)
1 DONE one page entrance (edp/pp/chem template.tsx removed). 2 DONE MotionConfig reduced motion, one ease, `transition: all` replaced (25 places).
3 PARTLY: tooltip uses translate; sidebar/admin-nav width and gauge fill NOT changed. 4 DONE hover lift only on hover devices for .btn/.cta-btn/.fill-btn (other custom :hover rules untouched).
5 PARTLY: MIN REPORT + MIN sign tabs; SupportChat switch NOT done. 6 DONE focus ring, deeper CTA colours; EDP glider hue NOT done.
7 DONE Loading skeleton, Thai error page, not-found page; global-error.tsx NOT done. 8 DONE modal focus trap/restore, 92dvh.
NOT DONE: ~95 non-house easing curves, ~100 default-ease transitions (left to keep the look).

### Slice 5 Screen sizes (40ca7ec, e865af8)
1 PARTLY: CHEM setup list = cards on phone; PP capacity/workload/CHEM chart scroll inside box with right-edge fade (<1024px; scroll-driven, newer Chrome/Edge/Safari only). No cards for pp-matrix/wl-table/ch-table. 2 DONE fixed widths. 3 DONE vh -> dvh. 4 DONE Login labels, show/hide, inline error.

### Slice 6 Tests + docs
1 DONE tests (frontend 68, backend 40). 2 DONE re-checks (reviewers, security, designer); fixes landed in 564e2af/e865af8.
3 PARTLY: handbook rows drafted (.audit/handbook-rows.md, not inserted anywhere). NOT DONE: devops deploy checklist + rollback note (rollback = revert the commits above).
Re-check items left undone: designer D6 (framer panels vs splash on cold load); security recheck items 2 and 3 (permission model, see decisions).

## What users will notice
- STORE-PC live view refreshes within ~5 s (was ~1 s). Stock list changes show within 5 s elsewhere.
- MIN REPORT "อัพเดทล่าสุด" may lag up to 60 s.
- Product-image endpoint serves only jpg/png/gif/webp/bmp, else 404 (legacy .tif/.ico/.svg in image folders would 404 — unverified).
- Chat/support reject html/svg/xml attachments; non-image files always download.
- Upload/save errors show a Thai generic message (no SQL/paths); detail is in BUG LOG. Some MaxMin messages now use "prefix + newline" instead of ": ".
- Network blip / server error no longer logs out or drops unsaved input.
- Blue, green, red, orange, teal buttons darker (blue #0278b5 sky-like, orange #d0470b); one keyboard-only focus ring; no hover lift stuck on phone/iPad.
- New skeleton loading, Thai error page, 404 page; every page opens with the same rise; reduced-motion devices get plain fades.
- Scanner "today" error shows an error instead of stock 0.
- User admin: smaller level number = higher (1 = admin). Non-admin (not Master Admin, not Level 1) cannot edit/reset/lock/change permissions of, or delete, a Master Admin or higher-level user, nor create/raise above own level (Add, Edit, Excel import). Nobody edits own permissions (import too). A Level-3 caller adding a user with the default Level 2 is denied.

## Run the tests
- Frontend: `cd frontend; npm test` (vitest 3.2.4; 5.x blocked by @types/node ^20).
- Backend: `dotnet test backend\CHR.Nexus.Api.Tests` (sibling folder, not in the API csproj or slnx).

## Open decisions for the owner
1. Level-1 non-master may edit/reset/lock a Master Admin and import ISMASTERADMIN=1 — require Master Admin for that?
2. Equal-level peers: password reset and granting permissions the caller lacks are allowed. Require strictly higher level and cap grants?
3. Sole Master Admin can no longer edit own permissions — acceptable?
4. X-Forwarded-For trust: say what sits in front of Next (Cloudflare Tunnel / IIS / direct).
5. PR read access per stock (PR list/parts/download have no per-stock check).
6. Keep the Thai-text heuristic in `Fail(ex)`? (leak risk: a Thai file path in an IO error.)
7. Blue button hue (#0278b5 sky vs app blue #2563eb); chat bubble gradient top #3b82f6 is 3.7:1 with white (outside scope).
8. Tester SUSPECT list: Qty.cs:42-43 CurrentCulture fallback ("1.2.3" = 123 under de-DE); PackingCardBarcodeParser.cs:20 CurrentCulture; format.ts parseNum accepts "0x10"/"1e3"; pp.ts:364 pc() rounding; pp.ts:124 snap p1=0 forces P1=0.
9. Out of plan: plain-text passwords shared with CIMS; GitHub check on 27b12fb; view definitions (vw_StockSummary/StockMonitoring/StorePcLive) never reviewed.

## NOT verified
- Nothing rendered in a browser or on a phone/iPad; nothing run against a DB or the API. Hand checklist: .audit/test-checklist.md.
- Framer-block detection (`[style*="opacity"]`) untested on real pages; nested `data-reveal` in Chem pages not checked.
- Edge fade needs scroll-driven animation support; low-spec tablet scroll smoothness unknown.
- `transition: all` replacement: ~20 sites not spot-checked for lost width/height transitions.
- Lockfile regenerated (+100 packages for vitest); Linux/Cloudflare build not verified. Tests ran only on Windows, local time zone.
- Frontend handling of a 500 from /api/scanner/today not checked.
- No test covers controllers, services, DB or components.

## 2026-11-16 · Import review everywhere + RowAction red X + User Management menu (branch feature/import-rowaction-admin-ux)
- Shared import contract (`Services/Import/ImportReviewDto.cs`, `components/import/*`): preview -> review (view/edit/exclude/map) -> apply. Used by Customer/Supplier (new), Product Control, Forecast/Order, PP PCS, Workload Excel, Machine STD / Machine Products (new `PpSetupImportController`), Users.
- RowAction: active action renders red X, second click cancels; VIEW = readonly fields; actions hidden without permission.
- Sidebar: USER MANAGEMENT (USER ACCOUNTS, ACCESS CONTROL `/admin/access`) + SYSTEM CONFIGURATION `/admin/setup/[slug]` grouped by system, Level 1 only. `SetupModal.tsx` unused, kept until owner approves delete.
- Users/parts uploads stay in memory (no password file on disk); startup sweep clears upload folder files > 1 h.
- Checks: backend 93 tests, frontend 81 tests, tsc/eslint clean, next build OK. Not run against a DB or in a browser.
