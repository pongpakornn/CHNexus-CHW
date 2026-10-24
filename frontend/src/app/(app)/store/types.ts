// StockModel ของ API (ชื่อ property แบบ camelCase)
export type Stock = {
  stkId: number;
  code: string;
  name: string;
  unit: string;
  isMain: boolean;
  isLiveView: boolean;
  useMaxMin: boolean;
  allowDecimal: boolean;
  countCoil: boolean;
  showCoilRowsSetting: boolean | null;
  showCoilRows: boolean;
  maxMinDecimalSetting: boolean | null;
  maxMinDecimal: boolean;
  notSetButton: boolean;
  thirdButtonText: string;
  cardStyleSetting: string | null;
  stockType: string | null;
  cardStyle: string;
  coilRowColumns: string | null;
  columnOrder: string | null;
  colNo: boolean;
  colImage: boolean;
  colCustomer: boolean;
  colCode: boolean;
  colPartA: boolean;
  colPartB: boolean;
  colPartNo: boolean;
  colModel: boolean;
  colName: boolean;
  colQty: boolean;
  colStockBox: boolean;
  colStockPcs: boolean;
  colRemark: boolean;
  groupBy: string;
  maxMinBasis: string;
  maxMinUnit: string;
  inPickList: boolean;
  inSupplier: boolean;
  inSysQr: boolean;
  inExcel: boolean;
  outPickList: boolean;
  outSupplier: boolean;
  outSysQr: boolean;
  formatIds: number[];
  qtyHeader: string;
  maxHeader: string;
  minHeader: string;
  boxHeader: string;
  unitDisplay: string;
  displayName: string;
};

export type Product = {
  partId: number;
  partCode: string;
  partName: string;
  customer: string;
  partA: string;
  partB: string;
  partNo: string;
  model: string;
  category: string;
  supplier: string;
  bin: string;
  groupKey: string;
  packSize: string;
  max: string;
  min: string;
  qty: string;
  stockBox: string;
  stockPcs: string;
  remark: string;
  stockStatus: string;
  imageUrl: string | null;
};

export type Counts = { total: number; max: number; min: number; noOrder: number } | null;

// สีสถานะ (StatusToColorConverter): ยังไม่ตั้ง MAX-MIN = เทา · ต่ำกว่า MIN = แดง · หมด = แดงเข้ม · เกิน MAX = เขียวแก่ · ปกติ = เขียว
export const STATUS_COLOR = (s: string) =>
  ({ UNDER_MIN: "#dc143c", OUT_OF_STOCK: "#8b0000", OVER_MAX: "#2f8247", NORMAL_GOOD: "#4caf50", NORMAL: "#4caf50" })[s?.trim() ?? ""] ?? "#d3d3d3";

// สี / ป้ายของการ์ดสินค้าตามสถานะ (StoreMaxMinView.CardTone)
export function cardTone(s: string) {
  const red = s === "UNDER_MIN" || s === "OUT_OF_STOCK";
  const green = s === "NORMAL_GOOD" || s === "OVER_MAX" || s === "NORMAL";
  return {
    bg: red ? "#ffebee" : green ? "#e8f5e9" : "#faf9fc",
    line: red ? "#e53935" : s === "OVER_MAX" ? "#2e7d32" : green ? "#43a047" : "#c9c3d3",
    label: red ? "LOW STOCK" : s === "OVER_MAX" ? "OVER MAX" : green ? "NORMAL" : "NO MAX-MIN",
  };
}

// ชื่อคอลัมน์ตามรหัส (StockModel.ColumnOrder)
export const COLUMN_LABEL: Record<string, string> = {
  NO: "NO.",
  IMAGE: "IMAGE",
  CUSTOMER: "CUSTOMER",
  CODE: "PD CODE",
  PARTA: "PART A",
  PARTB: "PART B",
  PARTNO: "PART NO",
  MODEL: "MODEL",
  NAME: "PRODUCT NAME",
  MAXMIN: "MAX / MIN",
  QTY: "QTY",
  BOX: "STOCK (BOX)",
  COIL: "STOCK (COIL)",
  PCS: "STOCK (PCS)",
  REMARK: "REMARK",
};
