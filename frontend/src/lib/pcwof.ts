// WORK ORDER FOLLOW v2 (PC Digital Workspace): types + grid math shared by list / plan / dashboard pages and the sign alert
export type PcUser = { userId: string; name: string };
export type PcApproval = { stepNo: number; title: string; users: PcUser[]; status: string; signedBy: string | null; signedAt: string | null };
export type PcStatus = "DRAFT" | "SENT" | "APPROVED" | "REJECTED" | string;
export type PcPlan = {
  planId: number;
  customerCode: string;
  customerName: string;
  owner: PcUser;
  editors: PcUser[];
  items: number;
  month: { workOrderNo: string; status: PcStatus };
  progress: { order: number; produced: number; delivered: number };
};
export type PcCells = Record<string, Record<string, number>>; // ROWKEY -> day -> qty
export type PcItem = { itemId: number; sortNo: number; partId: number; partCode: string; partA: string | null; partB: string | null; partNo: string; partName: string; packSize: number | null; imageUrl: string | null; remark: string | null; cells: PcCells };
export type PcDetail = {
  plan: Omit<PcPlan, "month" | "progress">;
  canEdit: boolean;
  month: { workOrderNo: string; status: PcStatus; approvals: PcApproval[] };
  items: PcItem[];
};
export type PcPart = { partId: number; partCode: string; partA: string | null; partB: string | null; partNo: string; partName: string; packSize: number | null; imageUrl: string | null; customer?: string };
export type PcMeta = { ready: boolean; can: { view: boolean; add: boolean; approve: boolean; setup: boolean }; me: PcUser };
export type PcQueue = { planId: number; month?: string; customerName?: string; workOrderNo?: string; title?: string; stepNo?: number };
export type PcFlowStep = { stepNo: number; title: string; userIds: string[] };

export const PAGE_SIZE = 6;
export const ROWS = [
  { key: "OR", label: "OR", th: "Order" },
  { key: "WO", label: "W/O", th: "Work Order" },
  { key: "ORDER", label: "สั่งผลิต", th: "สั่งผลิต" },
  { key: "PROD_D", label: "ผลิตได้ D", th: "ผลิตได้ กะ D" },
  { key: "PROD_N", label: "ผลิตได้ N", th: "ผลิตได้ กะ N" },
  { key: "DEL", label: "DEL.", th: "ส่งของ" },
] as const;

export const daysIn = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

/** Total of one row over all days (blank = 0). */
export const rowTotal = (cells: PcCells, key: string) => Object.values(cells[key] ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);

/** ST. = boxes to ship = DEL / packSize rounded up; null when packSize is missing / not positive. */
export const stOf = (del: number, packSize: number | null | undefined) => (packSize && packSize > 0 ? Math.ceil(del / packSize) : null);

/** Parse a typed cell: "" = null (clear), invalid / negative = undefined (reject). */
export function parseQty(s: string): number | null | undefined {
  const t = s.trim().replace(/,/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Plan month is editable only while DRAFT / REJECTED (SENT = waiting for signatures, APPROVED = locked). */
export const editableStatus = (s: PcStatus | undefined) => !s || s === "DRAFT" || s === "REJECTED";

/** Approval step waiting for a signature now (first not signed), null when all signed / no flow. */
export const currentStep = (a: PcApproval[]) => [...a].sort((x, y) => x.stepNo - y.stepNo).find((s) => s.status === "PENDING" && !s.signedBy) ?? null;

export const statusTone = (s: PcStatus): "ok" | "wait" | "bad" | "none" => (s === "APPROVED" ? "ok" : s === "SENT" ? "wait" : s === "REJECTED" ? "bad" : "none");

/** Percent 0-100 (1 decimal) of part / whole; 0 when whole is 0. */
export const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

export const initials = (name: string, id: string) => ((name || id).trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("") || "?").toUpperCase();

// chat message token from a sign request: [[WOF:<planId>]] -> card button that opens the plan
export const WOF_TOKEN = /\[\[WOF:(\d+)(?::(\d{4}-\d{2}))?\]\]/; // [[WOF:planId:yyyy-MM]]
export function wofTokenOf(body: string): { text: string; id: number; month?: string } | null {
  const m = WOF_TOKEN.exec(body ?? "");
  return m ? { text: body.replace(WOF_TOKEN, "").trim(), id: Number(m[1]), month: m[2] } : null;
}

// PL is only a group label (Plan) over OR + W/O in the Excel: never a data row, never rendered or sent
export const PLAN_ROWS = 2;
