// Shared import contract (PLAN.md "Shared import contract")
export type RowStatus = "NEW" | "CHANGED" | "SAME" | "DUPLICATE" | "SIMILAR" | "INVALID";
export type ImportField = { name: string; old: string | null; new: string | null; edit?: boolean };
export type ImportRow = { key: string; status: RowStatus; label: string; sub?: string; fields: ImportField[]; note?: string; suggest?: { key: string; label: string }[] };
export type ImportPreview = { id: string; file: string; title: string; rows: ImportRow[]; errors: { cell: string; text: string }[] };
export type ApplyBody = { id: string; exclude: string[]; edits: Record<string, Record<string, string>>; map: Record<string, string> };
