import type { ImportRow } from "./types";

export type Counts = { ready: number; changed: number; new: number; same: number; check: number; fixed: number };

const hasEdit = (e: Record<string, Record<string, string>> | undefined, k: string) => !!e && Object.keys(e[k] ?? {}).length > 0;

/** Is the row part of the import? NEW/CHANGED, a SIMILAR the user resolved (map has the key; "" = keep as new), an INVALID the user edited. */
export function isReady(r: ImportRow, exclude: string[], map: Record<string, string>, edits: Record<string, Record<string, string>> = {}) {
  if (exclude.includes(r.key)) return false;
  if (r.status === "NEW" || r.status === "CHANGED") return true;
  if (r.status === "SIMILAR") return r.key in map;
  if (r.status === "INVALID") return hasEdit(edits, r.key);
  return false;
}

export function countRows(rows: ImportRow[], exclude: string[], map: Record<string, string>, edits: Record<string, Record<string, string>> = {}): Counts {
  const c: Counts = { ready: 0, changed: 0, new: 0, same: 0, check: 0, fixed: 0 };
  for (const r of rows) {
    if (exclude.includes(r.key)) continue;
    if (r.status === "SAME") c.same++;
    else if (r.status === "NEW") c.new++;
    else if (r.status === "CHANGED") c.changed++;
    if (isReady(r, exclude, map, edits)) {
      c.ready++;
      if (r.status === "SIMILAR" || r.status === "INVALID") c.fixed++;
    } else if (r.status === "DUPLICATE" || r.status === "SIMILAR" || r.status === "INVALID") c.check++;
  }
  return c;
}
