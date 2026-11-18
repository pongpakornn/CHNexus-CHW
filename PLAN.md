# PLAN — STORE-FG writes to StorePC (.56) from CHR-Nexus

## Goal
Multi-Scanner IN/OUT and Store (Max-Min) edits on STORE-FG update the StorePC database directly, so CHR-Nexus (STORE-FG) and the StorePC .exe always show the same numbers. StorePC users missing in CHR-Nexus are added with STORE-FG-only rights.

## Design (one source of truth)
- STORE-FG stays a live view of `StorePC.dbo.MST_PART` (stock 18, LiveSource = StorePC). No copy of the data in CHR-Nexus, so no drift.
- Writes go to StorePC exactly as the .exe does (`StorePC/Services/ScanService.cs`):
  - IN : `MST_PART QTY_STK += qty, QTY_STKB += 1` + `TRN_SCAN (…,'IN',…)` in one transaction.
  - OUT: refuse if QTY_STK < qty; `QTY_STK -= qty, QTY_STKB -= 1 (min 0)` + `TRN_SCAN 'OUT'`.
  - CHR-Nexus also logs the scan (Activity Log / scan history) so the web shows who scanned.
- Store (Max-Min) on STORE-FG: MAX / MIN / REMARK editable -> `MST_PART QTY_MAX / QTY_MIN / PT_REMARK` (+ Activity Log). HIDE -> `IS_SHOW_MST`.
- Barcode: STORE-FG uses the StorePC label format (same lookup as `sp_GetPartByScan`).
- Only these StorePC tables are written: MST_PART (stock, max/min/remark/show), TRN_SCAN (insert). Nothing else; no deletes.

## Slices
1. Backend: `StorePcWriter` (scan IN/OUT, max/min/remark/hide) + lift the live-view guards for STORE-FG only (flag on the stock, not hard-coded). Reviewer (opus: production DB write).
2. Frontend: Multi-Scanner lists STORE-FG; Store (Max-Min) edit enabled for STORE-FG.
3. Users: SQL script copies the 18 StorePC users missing in CHR-Nexus (Users row, same password as StorePC, like the existing shared rows) + rights: STORE-FG view/scan + Multi-Scanner with StorePC format only.
4. Test on .56 with one real label IN then OUT (net 0), check both the web and `TRN_SCAN`.

## Risks
- Production write to StorePC: a bug changes live stock. Mitigation: same SQL as the .exe, transaction, reviewer on opus, one IN/OUT test.
- The .exe and the web scanning the same part at the same moment: both use `QTY_STK = QTY_STK ± qty` (atomic), so no lost update.
