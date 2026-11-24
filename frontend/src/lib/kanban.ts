// 🏭 KANBAN card formula (script 75) · same math as KFormula.Cards on the server
//   CARDS = ROUND( QTY x (1 + ALLOWANCE % / 100) / PACKING ) · UP / NEAREST / DOWN · at least 1 card · no formula = round up
export type CardFormula = { roundMode: "UP" | "NEAREST" | "DOWN"; allowancePct: number };

export function formulaCards(qty: number, packing: number, f?: CardFormula | null) {
  if (!(Number.isSafeInteger(qty) && qty > 0 && packing > 0)) return 0;
  const x = (qty * (1 + (f?.allowancePct ?? 0) / 100)) / packing;
  // 1e-9: float noise (1000 x 1.05 / 50 = 21.000000000000004) must not add a card
  const n = f?.roundMode === "DOWN" ? Math.floor(x + 1e-9) : f?.roundMode === "NEAREST" ? Math.round(x) : Math.ceil(x - 1e-9);
  return Math.max(1, n);
}
