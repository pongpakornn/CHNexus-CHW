import { describe, expect, it } from "vitest";
import { countRows, isReady } from "./counts";
import type { ImportRow, RowStatus } from "./types";

const r = (key: string, status: RowStatus): ImportRow => ({ key, status, label: key, fields: [] });
const rows = [r("a", "NEW"), r("b", "CHANGED"), r("c", "SAME"), r("d", "SIMILAR"), r("e", "INVALID"), r("f", "DUPLICATE"), r("g", "NEW")];

describe("countRows", () => {
  it("counts the untouched preview", () => {
    expect(countRows(rows, [], {})).toEqual({ ready: 3, changed: 1, new: 2, same: 1, check: 3, fixed: 0 });
  });
  it("excluded rows leave every count", () => {
    expect(countRows(rows, ["a", "d"], {})).toEqual({ ready: 2, changed: 1, new: 1, same: 1, check: 2, fixed: 0 });
  });
  it("a resolved SIMILAR (also keep-as-new = empty string) and an edited INVALID become ready", () => {
    expect(countRows(rows, [], { d: "" }, { e: { NAME: "x" } })).toEqual({ ready: 5, changed: 1, new: 2, same: 1, check: 1, fixed: 2 });
  });
});

describe("isReady / countRows edge cases", () => {
  const sim = r("s", "SIMILAR");
  it("excluded wins over resolved SIMILAR and edited INVALID", () => {
    expect(isReady(sim, ["s"], { s: "X" })).toBe(false);
    expect(isReady(r("e", "INVALID"), ["e"], {}, { e: { NAME: "x" } })).toBe(false);
  });
  it("INVALID with an empty edit object is not fixed; DUPLICATE/SAME are never ready", () => {
    expect(isReady(r("e", "INVALID"), [], {}, { e: {} })).toBe(false);
    expect(isReady(r("f", "DUPLICATE"), [], { f: "X" }, { f: { A: "1" } })).toBe(false);
    expect(isReady(r("c", "SAME"), [], {})).toBe(false);
  });
  it("SIMILAR mapped to existing counts ready+fixed but not new/changed; excluded one is not in check", () => {
    expect(countRows([sim], [], { s: "ABC" })).toEqual({ ready: 1, changed: 0, new: 0, same: 0, check: 0, fixed: 1 });
    expect(countRows([sim], ["s"], {})).toEqual({ ready: 0, changed: 0, new: 0, same: 0, check: 0, fixed: 0 });
  });
  it("skip list for apply (unresolved SIMILAR/INVALID, not DUPLICATE) equals the check rows minus duplicates", () => {
    // mirrors ImportReview.doImport: rows that are not ready and are SIMILAR/INVALID get excluded
    const list = [r("s1", "SIMILAR"), r("s2", "SIMILAR"), r("i1", "INVALID"), r("d", "DUPLICATE"), r("n", "NEW")];
    const skip = list.filter((x) => (x.status === "SIMILAR" || x.status === "INVALID") && !isReady(x, [], { s2: "" }, {})).map((x) => x.key);
    expect(skip).toEqual(["s1", "i1"]);
  });
});
