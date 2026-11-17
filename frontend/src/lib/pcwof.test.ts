import { describe, expect, it } from "vitest";
import { currentStep, daysIn, editableStatus, parseQty, pctOf, rowTotal, stOf } from "./pcwof";

describe("pcwof helpers", () => {
  it("ST. rounds up and is null without packSize", () => {
    expect(stOf(101, 50)).toBe(3);
    expect(stOf(100, 50)).toBe(2);
    expect(stOf(0, 50)).toBe(0);
    expect(stOf(10, null)).toBeNull();
    expect(stOf(10, 0)).toBeNull();
  });
  it("row total sums days, blank = 0", () => {
    expect(rowTotal({ DEL: { "1": 10, "2": 5.5 } }, "DEL")).toBe(15.5);
    expect(rowTotal({}, "DEL")).toBe(0);
  });
  it("parseQty", () => {
    expect(parseQty("")).toBeNull();
    expect(parseQty("1,200")).toBe(1200);
    expect(parseQty("-1")).toBeUndefined();
    expect(parseQty("x")).toBeUndefined();
  });
  it("days in month / status / current step / pct", () => {
    expect(daysIn("2024-02")).toBe(29);
    expect(editableStatus("DRAFT")).toBe(true);
    expect(editableStatus("SENT")).toBe(false);
    const a = (n: number, st: string) => ({ stepNo: n, title: "", users: [], status: st, signedBy: st === "SIGNED" ? "x" : null, signedAt: null });
    expect(currentStep([a(2, "PENDING"), a(1, "SIGNED")])?.stepNo).toBe(2);
    expect(currentStep([a(1, "SIGNED")])).toBeNull();
    expect(currentStep([a(1, "PREVIEW")])).toBeNull();
    expect(pctOf(1, 3)).toBe(33.3);
    expect(pctOf(1, 0)).toBe(0);
  });
});
