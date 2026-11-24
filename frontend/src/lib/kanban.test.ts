import { describe, expect, it } from "vitest";
import { formulaCards } from "./kanban";

describe("formulaCards", () => {
  it("rounds by the formula and keeps at least 1 card", () => {
    expect(formulaCards(101, 50)).toBe(3);
    expect(formulaCards(100, 50, { roundMode: "UP", allowancePct: 0 })).toBe(2);
    expect(formulaCards(125, 50, { roundMode: "NEAREST", allowancePct: 0 })).toBe(3);
    expect(formulaCards(149, 50, { roundMode: "DOWN", allowancePct: 0 })).toBe(2);
    expect(formulaCards(10, 50, { roundMode: "DOWN", allowancePct: 0 })).toBe(1);
  });
  it("adds the allowance without float noise", () => {
    expect(formulaCards(1000, 50, { roundMode: "UP", allowancePct: 5 })).toBe(21);
    expect(formulaCards(1000, 40, { roundMode: "UP", allowancePct: 10 })).toBe(28);
  });
  it("is 0 for no qty / no packing", () => {
    expect(formulaCards(0, 50)).toBe(0);
    expect(formulaCards(100, 0)).toBe(0);
  });
});
