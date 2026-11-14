import { afterEach, describe, expect, it, vi } from "vitest";
import { daysAgo, fmtDate, isoDate, monthStart, num, parseNum, qty, stamp, today } from "@/lib/format";

afterEach(() => vi.useRealTimers());

describe("parseNum", () => {
  it("parses plain, comma-grouped, padded and negative numbers", () => {
    expect(parseNum("1,234.5")).toBe(1234.5);
    expect(parseNum("  42 ")).toBe(42);
    expect(parseNum("-3.5")).toBe(-3.5);
    expect(parseNum("0")).toBe(0);
  });
  it("empty / whitespace / nullish = null", () => {
    expect(parseNum("")).toBeNull();
    expect(parseNum("   ")).toBeNull();
    expect(parseNum(null as unknown as string)).toBeNull();
    expect(parseNum(undefined as unknown as string)).toBeNull();
  });
  it("not a number = NaN", () => {
    expect(parseNum("abc")).toBeNaN();
    expect(parseNum("1.2.3")).toBeNaN();
    expect(parseNum("Infinity")).toBeNaN();
  });
  it("accepts hex / exponent forms (Number() semantics)", () => {
    expect(parseNum("0x10")).toBe(16); // SUSPECT: user typing "0x10" yields 16
    expect(parseNum("1e3")).toBe(1000);
  });
});

describe("isoDate", () => {
  it("zero-pads month and day, uses local date parts", () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(isoDate(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
    expect(isoDate(new Date(2024, 1, 29))).toBe("2024-02-29");
  });
});

describe("today / daysAgo / monthStart (fake clock)", () => {
  it("today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 15, 12, 0, 0));
    expect(today()).toBe("2026-11-15");
  });
  it("daysAgo crosses month and year boundaries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 2, 12, 0, 0));
    expect(daysAgo(0)).toBe("2026-01-02");
    expect(daysAgo(2)).toBe("2025-12-31");
  });
  it("monthStart returns the 1st of the current month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 31, 23, 30, 0));
    expect(monthStart()).toBe("2026-12-01");
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0));
    expect(monthStart()).toBe("2026-01-01");
  });
});

describe("qty / num / stamp", () => {
  it("qty max 3 decimals, no trailing zeros, empty fallback", () => {
    expect(qty(1234.5)).toBe("1,234.5");
    expect(qty(1.23456)).toBe("1.235");
    expect(qty(0)).toBe("0");
    expect(qty(null)).toBe("-");
    expect(qty(undefined, "n/a")).toBe("n/a");
    expect(qty(NaN)).toBe("-");
    expect(qty(Infinity)).toBe("-");
  });
  it("num", () => {
    expect(num(1234567)).toBe("1,234,567");
    expect(num(null)).toBe("-");
    expect(num(undefined)).toBe("-");
  });
  it("stamp DD-MM-YYYY:HH:mm:ss, dash for empty/invalid", () => {
    expect(stamp(new Date(2026, 10, 6, 0, 15, 5))).toBe("06-11-2026:00:15:05");
    expect(stamp(null)).toBe("-");
    expect(stamp("garbage")).toBe("-");
    expect(stamp(new Date("x"))).toBe("-");
  });
});

describe("fmtDate", () => {
  const d = new Date(2026, 10, 6, 14, 5, 9);
  it("empty / null / undefined input returns the fallback dash", () => {
    expect(fmtDate(null, "en-US")).toBe("-");
    expect(fmtDate(undefined, "en-US")).toBe("-");
    expect(fmtDate("", "en-US")).toBe("-");
  });
  it("invalid input returns dash, never 'Invalid Date'", () => {
    expect(fmtDate("not a date", "en-US")).toBe("-");
    expect(fmtDate(new Date("x"), "en-US")).toBe("-");
    expect(fmtDate(NaN, "en-US")).toBe("-");
  });
  it("0 (epoch) is a valid date, not treated as empty", () => {
    expect(fmtDate(0, "en-US", { timeZone: "UTC" }, "date")).toBe("1/1/1970");
  });
  it("part = date / time / both match the native Date methods", () => {
    expect(fmtDate(d, "en-US", undefined, "date")).toBe(d.toLocaleDateString("en-US"));
    expect(fmtDate(d, "en-US", undefined, "time")).toBe(d.toLocaleTimeString("en-US"));
    expect(fmtDate(d, "en-US")).toBe(d.toLocaleString("en-US"));
  });
  it("accepts ISO string, epoch number and Date; options are forwarded", () => {
    const opts = { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" } as const;
    expect(fmtDate("2026-11-06T00:00:00Z", "en-US", opts, "date")).toBe("11/06/2026");
    expect(fmtDate(Date.UTC(2026, 10, 6), "en-US", opts, "date")).toBe("11/06/2026");
    expect(fmtDate(new Date(Date.UTC(2026, 10, 6)), "en-US", opts, "date")).toBe("11/06/2026");
  });
  it("locale is honoured", () => {
    expect(fmtDate(d, "en-GB", { timeZone: "UTC" }, "date")).toBe(d.toLocaleDateString("en-GB", { timeZone: "UTC" }));
  });
});
