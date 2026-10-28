export type InvStock = { stkId: number; code: string; name: string; stockType?: string | null; isMain: boolean; countCoil: boolean; showCoilRows: boolean; isLiveView: boolean; canView: boolean; canAdd: boolean; canEdit: boolean; canDelete: boolean };
export type Layout = { stockId: number; columns: string[]; groupBy: string; qrFields: string[]; qrLabel: string[]; formFields: string[] };
export type Meta = {
  can: { add: boolean; edit: boolean; delete: boolean; admin: boolean };
  /** มีสิทธิ์ดูทุกคลัง = เลือก ALL STOCKS ได้ */
  canAll: boolean;
  stocks: InvStock[];
  columns: { key: string; label: string }[];
  layouts: { stkId: number; layout: Layout }[];
  suggestions: { suppliers: string[]; customers: string[]; categories: string[] };
  savedFilter: number | null;
  savedStocks: string;
  hasCoilRegister: boolean;
  /** ➕ ช่องกรอกเพิ่มเองของคลัง (ADMIN > CUSTOM FIELDS) - key = CF12 */
  customFields?: CustomField[];
};
export type CustomField = { fieldId: number; stockId: number; key: string; label: string; type: "TEXT" | "NUMBER" | "DATE" | "SELECT"; unit?: string | null; options?: string[] };
export type Part = {
  ptId: number;
  partCode: string;
  partName: string;
  packSize: string;
  category: string;
  location: string;
  qrCodeData: string;
  max: string;
  min: string;
  stock: string;
  supplier: string;
  customer: string;
  partA: string;
  partB: string;
  partNo: string;
  model: string;
  isShow: boolean;
  isShowMain: boolean;
  imageFileName: string | null;
  motherCoil: string | null;
  coilNo: string | null;
  coilCount: number;
  masterCount: number;
  groupKey: string;
  imageUrl: string | null;
  /** ค่าช่องเพิ่มเองที่อยู่ในคอลัมน์ { CF12: "..." } */
  cf?: Record<string, string>;
};

export type Form = {
  supplier: string;
  category: string;
  partCode: string;
  partName: string;
  packSize: string;
  bin: string;
  qrCode: string;
  customer: string;
  partA: string;
  partB: string;
  partNo: string;
  model: string;
  imageFileName: string | null;
  imageUrl: string | null;
  coilNo: string;
  masterCoil: string;
  coilKg: string;
  partWeight: string;
  /** ➕ ค่าช่องเพิ่มเอง { CF12: "..." } */
  cf: Record<string, string>;
};

export const EMPTY_FORM: Form = {
  supplier: "",
  category: "",
  partCode: "",
  partName: "",
  packSize: "",
  bin: "",
  qrCode: "",
  customer: "",
  partA: "",
  partB: "",
  partNo: "",
  model: "",
  imageFileName: null,
  imageUrl: null,
  coilNo: "",
  masterCoil: "",
  coilKg: "",
  partWeight: "",
  cf: {},
};

export const formOf = (p: Part): Form => ({
  supplier: p.supplier ?? "",
  category: p.category ?? "",
  partCode: p.partCode ?? "",
  partName: p.partName ?? "",
  packSize: p.packSize ?? "",
  bin: p.location ?? "",
  qrCode: p.qrCodeData ?? "",
  customer: p.customer ?? "",
  partA: p.partA ?? "",
  partB: p.partB ?? "",
  partNo: p.partNo ?? "",
  model: p.model ?? "",
  imageFileName: p.imageFileName,
  imageUrl: p.imageUrl,
  coilNo: "",
  masterCoil: "",
  coilKg: "",
  partWeight: "",
  cf: { ...(p.cf ?? {}) },
});
