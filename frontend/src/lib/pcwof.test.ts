import { describe, expect, it } from "vitest";
import { daysIn, isLocked, parseQty, rowTotal, stOf } from "./pcwof";

describe("pcwof helpers", () => {
  it("ST. rounds up and is null without pcsPerBox", () => {
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
  it("days in month / lock", () => {
    expect(daysIn("2024-02")).toBe(29);
    expect(isLocked([{ role: "APPROVE", requestedTo: "a", signedBy: "a", signedAt: "x" }])).toBe(true);
    expect(isLocked([{ role: "APPROVE", requestedTo: "a", signedBy: null, signedAt: null }])).toBe(false);
  });
});
