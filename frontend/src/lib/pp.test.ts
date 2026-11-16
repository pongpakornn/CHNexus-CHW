import { describe, expect, it } from "vitest";
import { calcMachine, dowOf, effTone, f0, f1, f2, groupSum, mcHrOf, pc, shortN, sphOf, strokeOf, totalSum, type PpMachine, type PpMonth, type PpPart } from "@/lib/pp";

const part = (o: Partial<PpPart> = {}): PpPart => ({
  id: 1, machineId: 1, sort: 1, partAId: 1, partA: "A", pdCode: "PD1", customer: "C", partBId: null, partB: null, name: "P",
  process: null, tp: 2, col: 1, ct: 36, man: null, active: true, pcs: 1000, pcsFrom: "MANUAL", ...o,
});
const machine = (o: Partial<PpMachine> = {}): PpMachine => ({
  id: 1, code: "1.1", group: "G1", subGroup: null, sort: 1, qty: 2, eff: 0.8, man: 3, sph: null, byPcs: false, parts: [part()], actual: [], snap: null, ...o,
});
const month = (o: Partial<PpMonth> = {}): PpMonth => ({
  dept: "PRESS1", month: "2026-11", days: 30, workdays: Array.from({ length: 20 }, (_, i) => i + 1), workdaySource: "DEFAULT",
  shifts: [{ id: 1, name: "S1", hours: 7.75, sort: 1 }, { id: 2, name: "S2", hours: 10.75, sort: 2 }], settings: {}, machines: [], ...o,
});

describe("part helpers", () => {
  it("sphOf = 3600/ct, 0 when ct <= 0", () => {
    expect(sphOf({ ct: 36 })).toBe(100);
    expect(sphOf({ ct: 0 })).toBe(0);
    expect(sphOf({ ct: -5 })).toBe(0);
  });
  it("strokeOf multiplies by tp unless byPcs; 0 when col = 0", () => {
    expect(strokeOf({ pcs: 1000, tp: 2, col: 1 })).toBe(2000);
    expect(strokeOf({ pcs: 1000, tp: 2, col: 1 }, true)).toBe(1000);
    expect(strokeOf({ pcs: 1000, tp: 2, col: 4 })).toBe(500);
    expect(strokeOf({ pcs: 1000, tp: 2, col: 0 })).toBe(0);
  });
  it("mcHrOf = stroke / sph, 0 when ct = 0", () => {
    expect(mcHrOf({ pcs: 1000, tp: 2, col: 1, ct: 36 })).toBe(20);
    expect(mcHrOf({ pcs: 1000, tp: 2, col: 1, ct: 0 })).toBe(0);
  });
});

describe("calcMachine - computed from parts", () => {
  const c = calcMachine(machine(), month());
  it("condition and plan values", () => {
    expect(c.C1).toBe(20);
    expect(c.C2).toBe(2);
    expect(c.C3).toBe(100); // sum stroke / sum hr = 2000/20
    expect(c.C3auto).toBe(true);
    expect(c.C4).toBe(0.8);
    expect(c.P1).toBe(2000);
    expect(c.P2).toBe(100);
    expect(c.P3).toBe(20);
    expect(c.P4).toBeCloseTo(25, 10);
    expect(c.P5).toBeCloseTo(1.25, 10);
    expect(c.P6).toBeCloseTo(0.625, 10);
    expect(c.P7).toBe(3);
    expect(c.P8).toBeCloseTo(0.625 * 3 * 2 * 1.023, 10);
    expect(c.P9).toBeCloseTo(c.P8 / 11, 10);
    expect(c.pcs).toBe(1000);
  });
  it("shift capacities: next shift hidden when previous already covers P1", () => {
    expect(c.sh[0]).toBeCloseTo(20 * 2 * 100 * 0.8 * 7.75, 6);
    expect(c.sh[1]).toBeNull();
    expect(c.needIdx).toBe(0);
    expect(c.capHr).toBe(10.75);
    expect(c.cap).toBeCloseTo(3200 * 10.75, 6);
    expect(c.needHr).toBe(7.75);
  });

  it("c8 = 4th shift capacity even when an earlier shift covers P1; no 4th shift = top shift", () => {
    const five = calcMachine(machine(), month({ shifts: [7.75, 10.75, 15.5, 18.5, 21.5].map((hours, i) => ({ id: i + 1, name: `S${i + 1}`, hours, sort: i + 1 })) }));
    expect(five.c8Hr).toBe(18.5);
    expect(five.c8).toBeCloseTo(3200 * 18.5, 6);
    expect(c.c8Hr).toBe(10.75);
  });
  it("daily arrays: plan only on workdays, length = days", () => {
    expect(c.plan).toHaveLength(30);
    expect(c.plan[0]).toBe(100);
    expect(c.plan[19]).toBe(100);
    expect(c.plan[20]).toBeNull();
    expect(c.planAcc[29]).toBe(2000);
    expect(c.last).toBe(-1);
  });
  it("honours ManHourFactor / ManHourPerDay settings", () => {
    const x = calcMachine(machine(), month({ settings: { ManHourFactor: 2, ManHourPerDay: 5 } }));
    expect(x.P8).toBeCloseTo(0.625 * 3 * 2 * 2, 10);
    expect(x.P9).toBeCloseTo(x.P8 / 5, 10);
  });
  it("m.sph (STD) beats computed C3 and clears C3auto", () => {
    const x = calcMachine(machine({ sph: 50 }), month());
    expect(x.C3).toBe(50);
    expect(x.C3auto).toBe(false);
  });
  it("needs a later shift when P1 exceeds shift 1 capacity", () => {
    const x = calcMachine(machine({ parts: [part({ pcs: 15_000 })] }), month());
    expect(x.sh[0]).not.toBeNull();
    expect(x.sh[1]).not.toBeNull();
    expect(x.needIdx).toBe(1);
  });
  it("exceeding all shifts: needIdx -1, needCap = cap", () => {
    const x = calcMachine(machine({ parts: [part({ pcs: 100_000_000 })] }), month());
    expect(x.needIdx).toBe(-1);
    expect(x.needCap).toBe(x.cap);
    expect(x.needHr).toBe(x.capHr);
  });
  it("byPcs machine ignores tp", () => {
    const x = calcMachine(machine({ byPcs: true }), month());
    expect(x.P1).toBe(1000);
  });
});

describe("calcMachine - MonthPlans snapshot", () => {
  const snap = { p1: 5000, c3: 200, qty: 3, eff: 0.9, man: 4, source: "xls" };
  it("P1/C3/C2/C4/P7 come from snap when present", () => {
    const c = calcMachine(machine({ snap }), month());
    expect(c.P1).toBe(5000);
    expect(c.C3).toBe(200);
    expect(c.C2).toBe(3);
    expect(c.C4).toBe(0.9);
    expect(c.P7).toBe(4);
    expect(c.P2).toBe(250);
    expect(c.P3).toBe(25);
    expect(c.pcs).toBe(1000); // pcs still from parts
  });
  it("snap beats m.sph for C3", () => {
    expect(calcMachine(machine({ snap, sph: 50 }), month()).C3).toBe(200);
  });
  it("null / non-positive snap fields fall back to machine values; p1 is taken as-is", () => {
    const c = calcMachine(machine({ snap: { p1: 0, c3: null, qty: 0, eff: null, man: null, source: null } }), month());
    expect(c.P1).toBe(0); // snap present => P1 = snap.p1 even if 0
    expect(c.C3).toBe(100);
    expect(c.C2).toBe(2);
    expect(c.C4).toBe(0.8);
    expect(c.P7).toBe(3); // man null -> machine man
  });
  it("snap.man = 0 is honoured (not treated as missing)", () => {
    expect(calcMachine(machine({ snap: { ...snap, man: 0 } }), month()).P7).toBe(0);
  });
  it("snap null = computed path", () => {
    expect(calcMachine(machine({ snap: null }), month()).P1).toBe(2000);
  });
});

describe("calcMachine - edge cases", () => {
  const finite = (c: ReturnType<typeof calcMachine>) => {
    for (const k of ["C3", "C4", "P1", "P2", "P3", "P4", "P5", "P6", "P8", "P9", "A3", "A4", "A5", "actHrDay"] as const) expect(Number.isFinite(c[k]), k).toBe(true);
  };
  it("empty parts: zeros, no NaN/Infinity", () => {
    const c = calcMachine(machine({ parts: [] }), month());
    expect(c.P1).toBe(0);
    expect(c.C3).toBe(0);
    expect(c.pcs).toBe(0);
    finite(c);
  });
  it("PcsPerStroke (col) = 0: stroke 0, no NaN", () => {
    const c = calcMachine(machine({ parts: [part({ col: 0 })] }), month());
    expect(c.P1).toBe(0);
    finite(c);
  });
  it("ct = 0: SPH 0 so C3 falls back to avgSph = 0, no NaN", () => {
    const c = calcMachine(machine({ parts: [part({ ct: 0 })] }), month());
    expect(c.C3).toBe(0);
    expect(c.P3).toBe(0);
    finite(c);
  });
  it("pcs 0 but ct set: C3 = average SPH of parts", () => {
    const c = calcMachine(machine({ parts: [part({ pcs: 0, ct: 36 }), part({ pcs: 0, ct: 18 })] }), month());
    expect(c.C3).toBe(150);
  });
  it("hours = 0 shifts: capacity 0", () => {
    const c = calcMachine(machine(), month({ shifts: [{ id: 1, name: "S", hours: 0, sort: 1 }] }));
    expect(c.sh[0]).toBe(0);
    expect(c.cap).toBe(0);
    expect(c.capHr).toBe(0);
  });
  it("no shifts: capHr 0, needIdx -1", () => {
    const c = calcMachine(machine(), month({ shifts: [] }));
    expect(c.sh).toEqual([]);
    expect(c.capHr).toBe(0);
    expect(c.needIdx).toBe(-1);
  });
  it("no workdays: C1 = 0, per-day values 0", () => {
    const c = calcMachine(machine(), month({ workdays: [] }));
    expect(c.C1).toBe(0);
    expect(c.P2).toBe(0);
    expect(c.plan.every((v) => v === null)).toBe(true);
    finite(c);
  });
  it("qty = 0: P6 = 0", () => {
    const c = calcMachine(machine({ qty: 0 }), month());
    expect(c.P6).toBe(0);
    finite(c);
  });
  it("actuals: totals, A3/A4, A5 averages only positive man, running totals stop at last day", () => {
    const c = calcMachine(
      machine({ actual: [{ day: 1, hr: 10, stroke: 1000, man: 4 }, { day: 2, hr: 10, stroke: 500, man: 0 }, { day: 5, hr: null, stroke: null, man: 2 }] }),
      month(),
    );
    expect(c.A1).toBe(1500);
    expect(c.A2).toBe(20);
    expect(c.A3).toBe(75);
    expect(c.A4).toBeCloseTo(0.75, 10);
    expect(c.A5).toBe(3); // (4 + 2) / 2
    expect(c.last).toBe(1);
    expect(c.actAcc[1]).toBe(1500);
    expect(c.actAcc[2]).toBeNull();
    expect(c.sphDay[0]).toBe(100);
    expect(c.sphDay[2]).toBeNull();
    expect(c.effDay[0]).toBeCloseTo(1, 10);
    expect(c.actHrDay).toBeCloseTo(20 / 2 / 2, 10);
    finite(c);
  });
});

describe("groupSum / totalSum", () => {
  const a = calcMachine(machine(), month());
  const b = calcMachine(machine({ id: 2, qty: 3, eff: 0.5, man: 2, actual: [{ day: 1, hr: 10, stroke: 800, man: 2 }] }), month());
  it("groupSum sums P1/P3/C2/P7/A and derives C3/C4", () => {
    const g = groupSum([a, b]);
    expect(g.P1).toBe(a.P1 + b.P1);
    expect(g.C2).toBe(5);
    expect(g.C1).toBe(20);
    expect(g.P3).toBeCloseTo(a.P3 + b.P3, 10);
    expect(g.C3).toBeCloseTo(g.P1 / g.P3, 10);
    expect(g.C4).toBeCloseTo(g.P3 / (a.P4 + b.P4), 10);
    expect(g.P7).toBe(5);
    expect(g.A1).toBe(800);
    expect(g.A2).toBe(10);
    expect(g.P9).toBeCloseTo(a.P9 + b.P9, 10);
    expect(g.P8).toBeCloseTo(g.P6 * g.P7 * g.C2 * 1.023, 10);
  });
  it("groupSum shift columns: sums non-null, null if all null", () => {
    const g = groupSum([a, b]);
    expect(g.sh[0]).toBeCloseTo((a.sh[0] as number) + (b.sh[0] as number), 6);
    expect(g.sh[1]).toBeNull();
  });
  it("groupSum custom factor", () => {
    expect(groupSum([a], 2).P8).toBeCloseTo(a.P6 * a.P7 * a.C2 * 2, 10);
  });
  it("groupSum of empty list is all zero, no NaN", () => {
    const g = groupSum([]);
    expect(g.P1).toBe(0);
    expect(g.C3).toBe(0);
    expect(g.C4).toBe(0);
    expect(g.sh).toEqual([]);
  });
  it("totalSum aggregates groups", () => {
    const g1 = groupSum([a]);
    const g2 = groupSum([b]);
    const t = totalSum([g1, g2]);
    expect(t.P1).toBe(g1.P1 + g2.P1);
    expect(t.C2).toBe(5);
    expect(t.C3).toBeCloseTo(t.P1 / t.P3, 10);
    expect(t.C4).toBeCloseTo(t.P3 / t.P4, 10);
    expect(t.P2).toBeCloseTo(g1.P2 + g2.P2, 10);
  });
  it("totalSum of empty list is zeros", () => {
    const t = totalSum([]);
    expect(t.P1).toBe(0);
    expect(t.C1).toBe(0);
    expect(t.C4).toBe(0);
  });
});

describe("number formatters", () => {
  it("f0 / f1 / f2 / pc show dash for null, undefined, NaN, Infinity", () => {
    for (const fn of [f0, f1, f2, pc]) {
      expect(fn(null)).toBe("–");
      expect(fn(undefined)).toBe("–");
      expect(fn(NaN)).toBe("–");
      expect(fn(Infinity)).toBe("–");
    }
  });
  it("f0 rounds with thousands separators", () => {
    expect(f0(1234.5)).toBe("1,235");
    expect(f0(0)).toBe("0");
  });
  it("f1 / f2 fixed decimals", () => {
    expect(f1(1234.56)).toBe("1,234.6");
    expect(f1(2)).toBe("2.0");
    expect(f2(3)).toBe("3.00");
    expect(f2(1.234)).toBe("1.23");
  });
  it("pc = percent with 1 decimal", () => {
    expect(pc(0.8)).toBe("80.0%");
    expect(pc(0)).toBe("0.0%");
    expect(pc(1.5)).toBe("150.0%");
  });
  it("shortN", () => {
    expect(shortN(0)).toBe("0");
    expect(shortN(999)).toBe("999");
    expect(shortN(1500)).toBe("1.5K");
    expect(shortN(1000)).toBe("1K");
    expect(shortN(12500)).toBe("13K");
    expect(shortN(2_500_000)).toBe("2.5M");
    expect(shortN(-1500)).toBe("-1.5K");
  });
});

describe("effTone", () => {
  it("thresholds: >= target ok, >= 85% target mid, else low", () => {
    expect(effTone(0.8, 0.8)).toBe("ok");
    expect(effTone(0.9, 0.8)).toBe("ok");
    expect(effTone(0.79, 0.8)).toBe("mid");
    expect(effTone(0.69, 0.8)).toBe("mid");
    expect(effTone(0.67, 0.8)).toBe("low");
    expect(effTone(0, 0.8)).toBe("low");
  });
});

describe("dowOf", () => {
  it("returns local weekday (0 = Sunday)", () => {
    expect(dowOf("2026-11", 15)).toBe(0); // 15 Nov 2026 is a Sunday
    expect(dowOf("2026-11", 16)).toBe(1);
    expect(dowOf("2024-02", 29)).toBe(4); // leap day, Thursday
    expect(dowOf("2026-01", 1)).toBe(4);
  });
});
