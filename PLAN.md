# PLAN: Excel import everywhere + RowAction cancel-X + User Management restructure + global UX

Status: DRAFT, waiting for owner OK. Branch: `feature/import-rowaction-admin-ux` (merge commit, no force-push, no deploy).

## Goal
1. Every master/plan list gets an Excel TEMPLATE + IMPORT in the style of PP Capacity "M/C ACTUAL" (yellow input cells, prefilled read-only keys, Thai GUIDE sheet, preview old -> new, then apply).
2. RowAction: the clicked action turns into a red X that cancels at once; View mode = inputs read-only; only allowed actions shown.
3. User Management: sidebar dropdown group, ADD USERID / PERMISSION split, SETUP section grouped by system.
4. One consistent look, staggered reveal, responsive, reduced-motion respected, reusing what exists.
5. Writes only CHR-Nexus DB, in small shippable slices.

## Out of scope (do NOT build)
- Any write to ERP (.10), StorePC, EDP_SYSTEM; any CIMS Windows app change.
- Password hashing (plain text shared with CIMS, memory: shared-users-password).
- New permission keys / DB schema changes (none planned; see Approval Sheet).
- Import for EDP, Chem, PR, Store/Coil, Max-Min (already have their own; not in the brief).
- Rewriting existing Excel parsers; only wrap/align them.
- Deploy, merge to main, new npm packages.

## Reference pattern (what "aligned" means)
Ref = `backend/CHR.Nexus.Api/Controllers/ProductionPlan/PpImportController.cs:116-338`:
- GET template: View perm (:119), `ImportTemplateService.Header/Body/Guide` (:137,156,172), yellow `#FFF2CC` input (:161), prefilled keys, GUIDE rules for same/changed/blank/0/formula/error (:174-184), `LogService.WriteLog` (:187).
- POST import: Edit perm (:197), parse -> `_uploads.Put` (:298) -> returns structured `{id,file,title,items[{group,label,status NEW|CHANGED|SAME|ZERO,old,new}],errors[{cell,text}],unknown[],rounded,count}` (:103-113). Nothing written.
- POST import/apply: re-check perm (:309), `_uploads.Get(id,Uid,kind)` (:310), write, `_uploads.Remove`, WriteLog, `LiveBus.Publish("pp")` (:331-333).
- UI: `frontend/src/app/(app)/pp/PpImportPreview.tsx:16-24` (summary card -> list -> IMPORT; `useReducedMotion`).
Rules to copy: blank = keep existing; `0` = set 0; formula = Excel cached value; error cell = skip + list in error card.

## Inventory (what exists today)
| Target | Template? | Import? | Preview? | Gaps vs ref | Tables written |
|---|---|---|---|---|---|
| Customer / Supplier (`master/PartnerPage.tsx`, `MasterDataController.cs:33-122`) | no | no (only add/edit/delete one by one) | n/a | all | `Master.Customers`, `Master.Suppliers` (24_Master_Data.sql:21,35) |
| Product Control: Part/Material/Component/Consumable/SparePart (`master/product/InventoryPage.tsx`, `ProductsController.cs:538-610`) | yes, one file per stock or ALL (`ImportTemplateService.CreatePartTemplate`:267) | yes | text only: summary string (`:582`) shown in confirm dialog (InventoryPage:453) | no old->new list; template perm = CanAddProduct not View (:541); no error card; LiveBus not seen on apply (unverified, only :944 elsewhere) | `Nexus.Parts`, `PartStocks`, `PartFieldValues` (PartImportService:425-498): CIMS SHARED |
| Forecast / Order (`master/forecast/ForecastPage.tsx`, `ForecastController.cs:168-245`) | yes (`CreateForecastTemplate`:412) | yes, also summary import (:80) | text summary with diff counts (:209-217) | text not table; keep `withCalc` choice; LiveBus on apply not seen (only :114 summary path, unverified) | forecast/order tables via `MaxMinCalcService.ApplyForecastMerge` (names unverified), `Nexus.ForecastSummary` |
| Forecast FILE page (`master/forecast/file/*`, `ForecastFileController`) | yes | yes | YES rich (`ImportPreview.tsx`) | already good; use as 2nd reference | (unverified) |
| PP Capacity M/C ACTUAL | yes | yes | yes | REFERENCE | `ProductionPlan.DailyActuals` |
| PP Capacity PCS (`PpExcelController.cs:38-184`) | yes | yes | text only (:157-160) | old->new via PpImportPreview; perm already Edit (:102) | `ProductionPlan.PcsOverrides` |
| PP Workload ref + current (`PpExcelController:203`, `PpImportController:341-482`) | yes | yes | current = yes (Workload.tsx:220); ref (`ProductionPlanController:91-118`) older style (unverified) | align ref | `WorkloadRef`, `WorkloadHeads`, `WorkloadNotes` |
| Master PP: Machine STD (`master/production-plan/MachineStd.tsx`) | no | no | n/a | new template+import (machines, settings) | `ProductionPlan.Machines`, `Settings`, `ShiftHours` |
| Master PP: Machine Products (`.../products/MachineProducts.tsx`) | no | no | n/a | new template+import | `ProductionPlan.MachineParts` |
| User Management (`UsersController.cs:366-446`, `UserAdminService.cs:492`) | yes (USERS + PERMISSIONS sheets, Guide :566) | yes | text only (:421-424) | no old->new per user/permission; no LiveBus on apply (only `_cache.Compact` :442); template perm CanAddUser&&CanEditUser (:369) stricter than View | `Nexus.Users`, `Nexus.Permissions`: CIMS SHARED |

Notes: Customer Workdays / Company Workdays already have template+import (`MaxMinController:290-330`); not touched. Product Control "tabs" = 5 stock types sharing ONE endpoint (`?type=`, `lib/menu.ts:24-30`); Coil import lives in Store, Layout QR is export only.

## Slices (shipping order)
Each slice = own commit(s) on the branch, update HANDOFF.md. Agents: backend, frontend, designer, tester.

### S0. Shared import kit (frontend + backend)
- Move `pp/PpImportPreview.tsx` -> `components/import/ImportPreview.tsx` (same props, keep `pp` re-export). Add optional `applyEndpoint`, `oldLabel`.
- Backend: extract `PvCell/PvError/Summary` from PpImportController to `Services/Import/ImportPreviewDto.cs` (internal move, no behavior change).
- Agent: frontend + backend. Check: Capacity/Workload still import; build + vitest green. Risk: PP regression, so move only, no edits.

### S1. RowAction cancel-X (frontend, designer reviews)
- `components/button-action/RowAction.tsx`: when `active` -> render red X icon (new `ra-cancel` style in globals.css near :7620), title "CANCEL"; same `onClick` toggles. Keep old kinds for inactive.
- Callers (each must toggle edit/view off on 2nd click and make form read-only in view):
  - Already toggle: `master/product/InventoryPage.tsx:925-926`, `cims/pr/PrPage.tsx:410`, `cims/max-min/MaxMinPage.tsx:499`.
  - Need toggle + read-only view: `master/PartnerPage.tsx:267-268` (has `ro` mode :81), `master/production-plan/MachineStd.tsx:349-350`, `.../MachineProducts.tsx:360`, `chem/setup/ChemSetup.tsx:363` (view when no setupEdit), `chem/chart/ChemChart.tsx:367`.
  - Modal openers, no inline form: `admin/users/UsersPage.tsx:263-264,315-316` (view = read-only PermissionModal), `cims/pr/ApprovedModal.tsx:181`, `master/product/CoilPanel.tsx:117,155`, `cims/store/CoilManageButtons.tsx:35`: keep behavior, no X (modal has its own close). Confirm with owner (Q3).
  - Not forms, leave: `notifications/MinPending|MinSignList`, `cims/store/MinReport.tsx:346` (document preview), `edp/plan-setting/*` (hide/delete only).
  - `cims/store/TableRows|MobileCards|StockTable` use their own `RowActions` TYPE, not this component: out of scope.
- Permission filter: callers already gate `can.edit/can.delete` (examples above); view is shown to anyone who can open the page. Server rechecks every write. Add a one-line audit: no caller renders edit without a `can.*`/`canEdit` guard (`ChemChart.tsx:367`, `CoilManageButtons.tsx:35`, `MaxMinPage.tsx:499` use disabled, not hidden: change to hidden).
- Check: click Edit -> red X -> click X -> form back to Add, no confirm; View -> inputs disabled; mobile card view same; reduced-motion = no spin.

### S2. Customer + Supplier template/import (backend then frontend)
- Backend: in `MasterDataController` add `GET {kind}/template` (View), `POST {kind}/import` (Add AND Edit), `POST {kind}/import/apply`. Logic in `Services/MasterData/PartnerImportService.cs` (new). Columns: NO | CODE (key) | NAME | STATUS(ACTIVE/INACTIVE) | USED BY PARTS (read-only). Reuse `Clean()` code rules (:45-53). Rules: blank NAME/STATUS = keep; code with Parts>0 not renamed (key match only, :88); NO delete via import; unknown/invalid code -> error card. Log `MASTER_CUSTOMER_IMPORT`/`..._SUPPLIER_...`; `LiveBus.Publish("master")` (page listens `PartnerPage.tsx:66`).
- Frontend: `PartnerPage.tsx` header: ActionMenu "EXCEL: TEMPLATE / IMPORT" (same as `UsersPage.tsx:163-170`) + shared ImportPreview. Show only with `can.add && can.edit`.
- Agent: backend -> frontend -> tester. Check: round trip template -> edit -> preview shows NEW/CHANGED/SAME -> apply -> list refreshes on 2nd browser.

### S3. Product Control align (backend + frontend)
- Keep `PartImportService` parsing. Add structured preview (NEW/CHANGED/SAME per part, old->new for changed fields) from `PartImportRow`; keep text `summary` field for old clients until frontend ships.
- Template perm -> View (`CanViewProductControl`), import/apply keep CanAddProduct (+CanEditProduct if rows update). Yellow input cells + prefilled read-only STOCK1 already partly there (verify in `CreatePartTemplate`:267-300); add error card.
- Apply: add `LiveBus.Publish("store:"+id,"store")` per stock + `"master"` if absent. Frontend: replace dialog at `InventoryPage.tsx:453` with ImportPreview. Same flow for all 5 types (one component).
- CIMS: `Nexus.Parts` shared: no column/format change, parser unchanged. Check: import of old-format file still works.

### S4. Forecast / Order align (backend + frontend)
- Return structured `items` from `ForecastDiff` (`MaxMinCalcService`), keep `withCalc` choice (`import/choice`), show ImportPreview in `ForecastPage.tsx:156`. Confirm LiveBus("forecast") on apply path. Template perm stays `CanImportForecastOrder`.

### S5. Production Plan group
- 5a PCS: change `PcsImport` summary (:157) to structured items; reuse ImportPreview in `Capacity.tsx:62`.
- 5b Workload ref: align `ProductionPlanController:91-118` to same preview (inspect first).
- 5c Machine STD + Machine Products: new `PpSetupImportController` (`api/pp/setup/*`): template/import/apply; keys = DEPT + MACHINE CODE (+ PART A / PROCESS); perms `CanViewPpSetup` for template, `CanAddPpSetup && CanEditPpSetup` for import (`ProductionPlanController:170`); no delete via import; `LiveBus.Publish("pp")`. Frontend ActionMenu in `MachineStd.tsx` / `MachineProducts.tsx`.
- Agent: backend, frontend, tester. Check: Capacity page updates live after setup import.

### S6. User Management import align (backend + frontend)
- Structured preview: per user NEW/CHANGED (name, level, lock) and permission old->new count; keep self-edit and level rules (`UsersController:391-414`). NEVER echo or log passwords. Add `LiveBus.Publish("data")` (page listens `UsersPage.tsx:63`). Replace confirm dialog `UsersPage.tsx:119`.
- Risk: permissions apply live to CIMS users: add "will change N people's permissions" banner in preview.

### S7. User Management restructure (frontend + small backend, designer first)
- Sidebar: new `ADMIN_MENU` in `lib/menu.ts` (today `ADMIN.menu=[USERS_ITEM]` :109; /admin returns `systemOf=null` :215, Sidebar already renders `children` groups + `caption`, `Sidebar.tsx:104-125`). Group "User Management":
  - ADD USERID -> `/admin/users` (list, add/edit/delete, import)
  - PERMISSION -> `/admin/permission` (user picker + existing `PermissionModal`, `UsersPage.tsx:33,263`)
  - caption SETUP, sub-groups (only groups with panels render; `allowed()` :202 hides empty):
| Group | Item (route `/admin/setup/<slug>`) | Today's panel |
|---|---|---|
| CIMS - CHR Inventory Management | PR SETTINGS `pr-settings`; EXCEL SETUP `excel`; DEPARTMENTS `departments`; MIN REPORT `min-report`; MIN REASONS `min-reasons`; SIGN FLOW (MIN) `sign-flow-min`; LAYOUT SETUP `layout` | PrPanel, ExcelPanel, DeptPanel, MinReportPanel, MinReasonPanel, SignFlowPanel, LayoutPanel (`SetupModal.tsx:114-141`) |
| Chemical Control | SIGN FLOW (CHEM) `sign-flow-chem` | same SignFlowPanel, doc preset (`SignFlowPanel.tsx:23-26`) |
| EDP Planning | EDP ALERT `edp-alert` | EdpAlertPanel |
| User Management | USER OPTIONS (old "ADD USERID" tab: position/dept dropdowns) `user-options` | UserOrgPanel |
| Production Plan, Master Data | none today: no placeholder; add when a setting exists | - |
- Routing: routes, not modal. Each panel page = thin `page.tsx` rendering the existing panel; delete `SetupModal` shell only after all panels moved (needs approval, deletion). Keep ALERT CONTACT and ACTIVITY LOG in UsersPage ActionMenu.
- Gating: all setup routes need `can.setup`. Backend `SetupController` is Level 1 only (`AdminOnly` :14) while frontend flag = `CanManagePrSettings` (`UsersController:38`): mismatch to settle (Q2). Route guard: redirect to /systems if no flag; server stays the real check.
- Dirty guard: modal `tryClose` (`SetupModal.tsx:64`) disappears; add `beforeunload` + in-app link confirm via a shared `useUnsavedGuard`. Risk: Next client nav is not interceptable by beforeunload; test.
- Update text hints that say "User Management › SETUP › X" (`MinReport.tsx:52,155`, `ChemChart.tsx:470`, `ApprovedModal.tsx:216`, `HistoryModal.tsx:265`) to deep-link to routes.
- Check: each old tab reachable by URL, same data; non-admin sees no SETUP; mobile sidebar group opens.

### S8. Global UX pass (frontend, designer)
Already exists (reuse, do not rebuild):
- `lib/motion.ts`: EASE, DUR, STAGGER, `fadeUp/fadeDown/panelIn/pageIn/fadeOnly`, springs.
- `PageBody` adds `.page-in` (globals.css:4714) = staggered child reveal for every page using it; `MotionConfig reducedMotion="user"` in `Providers.tsx:11`; 49 `prefers-reduced-motion` rules in globals.css.
- `FitTables` mounted globally in `Shell.tsx:138` (tight/stacked cards on small screens, globals.css:258-284).
- `components/ui/blur-fade.tsx` exists but is used NOWHERE and imports `motion/react` (rest uses `framer-motion`): do not adopt; use `.page-in` / `fadeUp` instead.
To do: grep `app/(app)/**/page.tsx` for pages not under `PageBody`/`.page-in` and wrap; make new import/preview/setup pages use `PageHeader` + `Card`; check each new page at 375px and 768px; any new animation = transform/opacity only. Check: reduced-motion emulation shows no movement; no horizontal page scroll at 375px.

## Tests (tester, per slice)
- Backend xunit (project already has tests): importer parsers (blank/0/formula/error/duplicate rows) for Partner, PPSetup, preview status logic; permission denial for template/import/apply.
- Frontend vitest: RowAction toggle, ImportPreview status counts.
- Manual: round trip each template; second browser sees LiveBus update; Activity Log row written.

## Risks
- CIMS shares `Nexus.Parts / Users / Permissions`: no schema or semantics change; permission import changes live access.
- Upload cache is per user + kind (`_uploads.Get(id,Uid,kind)`): give each new import a unique kind string.
- Preview must not write; apply re-checks permission and re-reads current values.
- Setup move breaks hint texts / bookmarks: keep `/admin/users` as is.
- Large templates (Machine Products): keep 30 MB request limit like ref.

## Approval Sheet (nothing executed until OK)
1. DB schema/data: NONE planned. If Machine STD import needs a unique key on `ProductionPlan.Machines(Dept,Code)`: script `database/nexus/51_PP_Machine_Unique_Key.sql` (undo: drop index; affects CIMS: no).
2. Deleting `admin/users/SetupModal.tsx` shell (S7 end). Undo: git.
3. Installs: none.
4. Branch `feature/import-rowaction-admin-ux`; no push/deploy.

## Owner decisions (2026-11-16) — these override the slices above
1. **Names: formal MES wording.** Sidebar group USER MANAGEMENT → `USER ACCOUNTS` (list/add/edit, was "ADD USERID" request), `ACCESS CONTROL` (permissions), caption `SYSTEM CONFIGURATION` (SETUP groups). Old SETUP tab "ADD USERID" (position/dept options) → `ORGANIZATION MASTER`. Group labels: `PR MANAGEMENT` (PR SETTINGS, EXCEL SETUP, DEPARTMENTS), `CIMS - CHR INVENTORY MANAGEMENT` (MIN REPORT, MIN REASONS, SIGN FLOW, LAYOUT SETUP), `CHEMICAL CONTROL`, `EDP PLANNING` (EDP ALERT), `USER MANAGEMENT` (ORGANIZATION MASTER).
2. **SETUP access: Admin Level 1 only** (match SetupController). Frontend gate = `UserLevel == 1`, not CanManagePrSettings. No new permission keys.
3. **Red X: every row Action button in every TABLE** (incl. modal openers and `cims/store` RowActions type). Modal openers: button shows X while the modal is open; X or modal close both cancel. Non-table action buttons unchanged for now.
4. **Customer/Supplier import: add new + edit only, never delete.** New rows default STATUS = ACTIVE; status is changed only by users with edit right on the page, not via import.
5. **Every import uses the Forecast-FILE review flow** (`master/forecast/file/ImportPreview.tsx` is the UX reference, not the PP text list): summary cards (READY = new + changed, CHANGED old→new, NEW, SAME untouched, DUPLICATE/SIMILAR/INVALID needs check) → click card to see rows → per row: view, edit value, exclude ("ไม่ใช้"), pick existing match for SIMILAR → final IMPORT confirm. Server re-validates everything on apply.

### Shared import contract (S0 builds this; S2-S6 use it)
- Preview response: `{ id, file, title, rows: Row[], errors: {cell,text}[] }`
  `Row = { key, status: "NEW"|"CHANGED"|"SAME"|"DUPLICATE"|"SIMILAR"|"INVALID", label, sub?, fields: {name, old: string|null, new: string|null, edit?: boolean}[], note?, suggest?: {key,label}[] }`
  DUPLICATE = same key twice in file (last row wins unless user excludes); SIMILAR = no exact key but near match in DB (trim/space/case/dash) → user picks a suggestion or keeps as NEW.
- Apply body: `{ id, exclude: string[], edits: { [key]: { [field]: string } }, map: { [key]: string } }`
- Frontend: `components/import/ImportReview.tsx` (generic, modal, cards → list → edit drawer), `components/import/ExcelMenu.tsx` (TEMPLATE / IMPORT button pair, permission-gated).
- PP M/C ACTUAL and Forecast FILE keep their current previews (already good); migrate later only if trivial.

## Not checked (unsure)
Forecast apply LiveBus, forecast/order table names, `ProductionPlanController` workload/excel style, whether every page already uses `PageBody`, how `Me.can` flags are built server-side, `CreatePartTemplate` yellow cells/Guide detail.

---

# PENTA STOCK IMPORT for STORE-MAT / STORE-PANTA (2026-11-17, waiting for OK)

Goal: import the supplier file `PentaOnlineStock_*.xlsx` (sheet "Penta Online Stock", 36 columns, 1 row = 1 coil)
into a review screen like FORECAST / ORDER (shared `components/import/ImportReview` + `ImportReviewDto`), from the
EXCEL menu of STORE-MAT and STORE-PANTA only. Which columns get written to stock is decided by the owner after slice 1.

## File check (17-11-2026 09:00, 682 coils)
| MAT_TYPE | match, same KG | match, KG differs | match, coil 0 KG | not in CHR-Nexus |
|---|---|---|---|---|
| MC Mother Coil (327) | 212 | 12 | 61 | 42 |
| FG Finish Goods / slit (355) | 11 | 264 | 2 | 78 |
Match order: MAT_NO = Number Coil -> COIL_NO = coil -> COIL_NO = Master Coil. FG "KG differs" is mostly a slit row
matched to its mother coil (REMAIN_WT of the slit vs the mother weight), so FG needs its own rule (owner decides).

## Slices
1. DB `56_Stock_SupplierImport.sql`: `Nexus.Stocks.InSupplierImport BIT NOT NULL DEFAULT 0`; set 1 for STORE-MAT, STORE-PANTA.
   Stock settings (StockEditor, add/edit stock): checkbox "IMPORT PENTA STOCK (ใช้กับคลังนี้)" next to IMPORT EXCEL.
2. Backend `Services/Store/PentaStockImportService.cs` + `POST /store/{id}/penta/preview`:
   read by header name (not position), key = MAT_NO (fallback COIL_NO), status SAME / CHANGED (KG old -> new) / NEW
   (coil not in register) / DUPLICATE / INVALID, fields shown: COIL_NO, MAT_NO, MAT_TYPE, MAT_SPEC, DESCRIPTION,
   REMAIN_QTY, REMAIN_WT, STATUS, ZONE, PD CODE, NEXUS KG. Permission = CanImportStock + flag on. Read only.
3. Frontend: StockTable EXCEL menu -> when flag on, "TEMPLATE COIL" item is replaced by "IMPORT PENTA STOCK"
   (other stocks unchanged). Opens ImportReview (filter cards, search, view rows, exclude, export).
4. (after owner picks columns) `POST /store/{id}/penta/apply`: one transaction, per-coil update of the chosen fields,
   CoilManageLog + SystemLogs, recount like RecountCoils. Until then the IMPORT button is hidden (preview only).

## Team
backend + frontend: solo by tech lead (small, reuses ImportReview) · tester: parser + matcher unit test ·
reviewer (sonnet): before commit (touches stock data + permissions).

## Approval Sheet
1. Run DB script 56 (adds 1 column, sets 2 stocks) — undo: drop column.
2. Build slices 1-3 (preview only, writes nothing to stock).
3. Commit / push / copy to .56 after review.

## Owner questions (needed for slice 4, not for 1-3)
- Which columns update CHR-Nexus (REMAIN_WT -> coil KG? STATUS / ZONE -> remark?) and for which MAT_TYPE.
- Coils not in CHR-Nexus (120): add them (needs PD CODE: from MAT_SPEC/DESCRIPTION?) or only report.

---

# 2026-11-17 batch 2: Manage Stock toggle · PR department per user · filters visible before a file (waiting for OK)

1. MANAGE STOCK show/hide per stock — script 57 `Nexus.Stocks.ShowManageStock BIT DEFAULT 1` + StockEditor checkbox;
   button shown = flag AND existing right (CountCoil + EDIT + APPROVE of that stock, not live view). Server unchanged.
2. PR department per user — script 58 `Nexus.DepartmentUsers (UserID PK, DepartmentName)`; User Management › SETUP ›
   DEPARTMENTS: pick users per department. New PR (manual form default, AutoPrForDeduct, trigger trg_ScanTransactions_AutoPR)
   take the requester's mapped department ("code-name", text after "@" dropped); no mapping = old behaviour.
   History fix: PRs of UserID 33310 (ไพโรจน์, 104 rows) -> "11201122-จัดซื้อและพัสดุ"; other users after the owner maps them.
3. FORECAST FILE: FILTER + table always shown (empty/disabled until a file is read).
   IMPORT PENTA STOCK: review modal opens first with empty cards + "เลือกไฟล์" inside (same idea).
Team: build solo (small edits) · reviewer (sonnet) before commit (PR trigger + permissions) · tester: dept mapping helper.

---

# 2026-11-17 system audit -> fix plan (waiting for OK)
Reports: scratchpad audit_realtime_perf.md · audit_security.md · audit_responsive.md (read-only audits; nothing changed).

## Batch 1 — small, safe, high value (effort S each)
Security: Next.js 16.4.2 -> 16.4.6 (install) · client IP from last X-Forwarded-For · login lock per user+IP (+ sweep old keys) ·
  CSRF: check Origin on writes · rate-limit change-password · cap Activity Log / Scan History export (range, rows, 60 s).
Realtime: Master Product page listens live · Layout 3D listens to "layout3d" · tab focus refetch only after >30 s hidden ·
  boot id so clients refetch after an app restart · PR page: cheap /pr/signature instead of full list every 15 s.
Responsive: iPad hover-only buttons (store cards) · allow pinch-zoom · touch targets >= 40px on touch screens ·
  .md-seg min-width on 360px phones · forecast table nested scroll on phones · popups past the right edge.
## Batch 2 — medium (effort M)
LiveBus: stop the global "data" topic waking every page on any write · one shared MIN/alert hook (drop 60 s duplicates) ·
LiveWatcher token cost per watched stock · Excel upload guard (uncompressed size, one import at a time) + attachment quota ·
custom tables (forecast/pp/workload/chem lists) card mode on phones.
## Batch 3 — large, needs CIMS together
Password hashing + min length (Users table shared with CIMS).
Team: build solo/frontend+backend agents per batch · reviewer + tester before each commit.

---

# WORK ORDER FOLLOW (PC DIGITAL WORKSPACE) — 2026-11-17, waiting for OK
Source: Excel "แผนการผลิตชิ้นส่วน / WORK ORDER FOLLOW" (1 sheet = customer + work order + month; per part 8 rows x day 1-31 + Total).
Owner answers: manual entry only · monthly signatures per sheet · edit only by the sheet owner (others view) · Excel import later.

## Data (script 61, CHR-Nexus only, new schema PC)
PC.WoSheets (SheetID, MonthStart, CustomerCode, CustomerName, WorkOrderNo, OwnerUserID, Created/Updated, IsDeleted)
PC.WoItems  (ItemID, SheetID, SortNo, PartID -> Nexus.Parts (Product Control), IntCode, PartName, PartNo, Material, PcsPerBox, BarColor, Remark)
PC.WoCells  (ItemID, RowKey PL|OR|WO|ORDER|PROD_D|PROD_N|DEL, Day 1-31, Qty) PK(ItemID,RowKey,Day)
PC.WoSigns  (SheetID, Role PREPARE|CHECK|APPROVE, UserID, SignedAt) — reuse the existing user signature image
Computed: Total per row, ST. = DEL / PcsPerBox. Permission SystemID PC_WOF (view/add/edit/delete/approve).
Rules: add sheet = you are owner; only owner (or Level 1) edits; APPROVE signed = sheet locked; edit after CHECK clears CHECK.

## UI
Systems page: PC Digital Workspace card live -> own sidebar: WORK ORDER FOLLOW (list) · sheet page.
List: month picker, cards/table of sheets (customer, W/O, owner, items, sign status), + ADD.
Sheet: Workload/Capacity-style grid (sticky part column, 8 rows per part, days 1-31, Total, weekend shading),
  + ADD PART (pick from Product Control), inline cell edit (owner), SIGN panel (3 roles), print-friendly, realtime, mobile cards.

## Team
designer (sonnet, spec only) -> backend + frontend agents in parallel on the agreed API -> tester (calc) + reviewer -> commit after OK.

---

# WORK ORDER FOLLOW v2 (owner redesign 2026-11-17) — replaces the monthly-sheet model
PC Digital Workspace = landing with system cards (first card: Work Order Follow, icon images/systems/work-order-follow.webp);
  PC landing sidebar: SYSTEMS + SETUP FLOW (approval flow setup like MIN REPORT setup).
Work Order Follow sidebar: DASHBOARD · WORK ORDER FOLLOW.
Plan (Register Plan) = owner + customer (Master.Customers code -> name auto); parts persist across months (picked from
  Nexus.Parts filtered by Parts.Customer = customer code: Part No, Part Name, image, Part A/B, PackSize); month switch keeps
  the parts, only quantities differ; remove part = others move up. Grid like PP Workload, 5-6 parts per page + pager,
  rows/totals as the Excel, autosave. Owner + editors edit, everyone else view. Card per plan shows the owner (UserID/name).
  SEND FOR SIGN button -> flow from SETUP FLOW (steps of approvers, sequential, MIN REPORT style notify + signature image).
Dashboard: month KPIs (plans, parts, order/plan, produced D+N, delivered, achievement %, pending approvals, per customer).
DB script 62 (approved by owner): drop the empty v1 PC tables (only 2 owner test sheets) and create
  PC.WoPlans, PC.WoEditors, PC.WoItems (persistent), PC.WoMonths (plan+month: W/O no, status), PC.WoCells (+MonthStart),
  PC.Flows (steps/approvers), PC.WoApprovals (plan+month+step).
Team: backend + frontend agents (resume, they know v1) -> reviewer -> commit after owner OK.

---

# 2026-11-18 batch (owner list, 18 items) — only what was asked, no other rule changes
A1 MIN: Min Report = only items whose STOCK(BOX) stayed below MIN for 3 full days; daily report reminder until above MIN;
   report reason -> Remark; Remark auto-cleared when STOCK(BOX) > MIN; MIN HISTORY/TRACKING slide smooth + STORE-MAT table style.
A2 STORE: Layout slot detail wider for long Number Coil; MANAGE STOCK HIDE: hidden rows not listed in store (unhide in Master Data),
   multi-select + HIDE; store search also matches Master Coil / Number Coil with near-match suggestions.
B  SCANNER: TEST mode never writes and never blocks on "Number Coil exists"; HISTORY limited to the selected stock;
   SCAN OUT alerts parity with SCAN IN; new MOVE LOCATION mode (scan location QR, then coil barcodes).
C1 PICK LIST export: drop 3rd PDF button, wider A4 preview. MAX-MIN CALC: Excel TEMPLATE = export "Template Set Max-Min"
   styled like Actual Capacity (No, Part A, Part No, Product Name, Max(Day), Min(Day)); IMPORT FORECAST ORDER like Master Data Forecast/Order (calc only).
C2 PR: APPROVE / REJECT selection modes like MANAGE STOCK (approve modal with qty adjust, reject confirm); remove APPROVE LIST button
   beside SUBMIT PR; Export Excel styled like Actual Capacity.
D  PC/WOF: PC landing hero like main Systems page; plan page: table right after customer, part search by typed text (Part B etc.)
   with suggestions even without customer, part image in the part cell like the Excel; fix owner chip, use the house month picker,
   fix sticky columns on horizontal scroll (like Workload), auto-scroll to today, motion reveal; WOF Excel TEMPLATE + IMPORT like Actual Capacity.
Then reviewer -> owner approval -> commit/copy.
