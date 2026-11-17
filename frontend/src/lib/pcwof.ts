// WORK ORDER FOLLOW (PC Digital Workspace): types + grid math shared by the list / sheet pages and the sign alert
export type PcUser = { userId: string; name: string };
export type PcSign = { role: string; requestedTo: string | null; signedBy: string | null; signedAt: string | null };
export type PcSheet = {
  sheetId: number;
  month: string;
  customerCode: string;
  customerName: string;
  workOrderNo: string;
  owner: PcUser;
  editors: PcUser[];
  items: number;
  signs: PcSign[];
};
export type PcCells = Record<string, Record<string, number>>; // ROWKEY -> day -> qty
export type PcItem = { itemId: number; sortNo: number; partId: number; intCode: string; partName: string; partNo: string; material: string; pcsPerBox: number | null; barColor: string | null; remark: string | null; cells: PcCells };
export type PcDetail = { sheet: PcSheet; canEdit: boolean; items: PcItem[] };
export type PcPart = { partId: number; partA: string; partCode: string; partNo: string; name: string; packSize: number | null; customer: string };
export type PcMeta = { ready: boolean; can: { view: boolean; add: boolean; approve: boolean }; me: PcUser };
export type PcQueue = { sheetId: number; role: string; month?: string; customerName?: string; workOrderNo?: string; requestedBy?: string };

export const ROLES = ["PREPARE", "CHECK", "APPROVE"] as const;
export const ROWS = [
  { key: "PL", label: "PL", th: "แผน" },
  { key: "OR", label: "OR", th: "Order" },
  { key: "WO", label: "W/O", th: "Work Order" },
  { key: "ORDER", label: "ORDER", th: "สั่งผลิต" },
  { key: "PROD_D", label: "PROD D", th: "ผลิตได้ D" },
  { key: "PROD_N", label: "PROD N", th: "ผลิตได้ N" },
  { key: "DEL", label: "DEL.", th: "ส่งของ" },
] as const;

export const daysIn = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

/** Total of one row over all days (blank = 0). */
export const rowTotal = (cells: PcCells, key: string) => Object.values(cells[key] ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);

/** ST. = boxes to ship = DEL / pcsPerBox rounded up; null when pcsPerBox is missing / not positive. */
export const stOf = (del: number, pcsPerBox: number | null | undefined) => (pcsPerBox && pcsPerBox > 0 ? Math.ceil(del / pcsPerBox) : null);

/** Parse a typed cell: "" = null (clear), invalid / negative = undefined (reject). */
export function parseQty(s: string): number | null | undefined {
  const t = s.trim().replace(/,/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export const signOf = (signs: PcSign[], role: string) => signs.find((s) => s.role === role);
export const isLocked = (signs: PcSign[]) => !!signOf(signs, "APPROVE")?.signedBy;
export const signChip = (s?: PcSign): { tone: "ok" | "wait" | "none"; text: string } =>
  s?.signedBy ? { tone: "ok", text: `SIGNED · ${s.signedBy}` } : s?.requestedTo ? { tone: "wait", text: `รอ ${s.requestedTo}` } : { tone: "none", text: "ยังไม่ขอ" };

// chat message token from a sign request: [[WOF:<sheetId>]] -> card button that opens the sheet
export const WOF_TOKEN = /\[\[WOF:(\d+)\]\]/;
export function wofTokenOf(body: string): { text: string; id: number } | null {
  const m = WOF_TOKEN.exec(body ?? "");
  return m ? { text: body.replace(WOF_TOKEN, "").trim(), id: Number(m[1]) } : null;
}
