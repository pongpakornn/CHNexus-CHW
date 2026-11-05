// 📍 LAYOUT SETUP: ตำแหน่งจัดเก็บ (ประเภท + ชื่อ) + รูปแบบ QR
export type Loc = { locId: number; locName: string; createdBy: string | null; createdAt: string; qr: string; label: string; typeName?: string };
export type LType = { typeId: number; typeName: string; createdBy: string | null; createdAt: string; locations: Loc[] };
export type LayoutData = {
  ready: boolean;
  settings?: { fields: string[]; sep: string; updatedBy: string | null; updatedDate: string | null };
  types?: LType[];
  can?: { add: boolean; edit: boolean; delete: boolean };
};
