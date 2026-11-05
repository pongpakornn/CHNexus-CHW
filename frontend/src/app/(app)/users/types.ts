export type User = {
  userId: string;
  name: string;
  position: string;
  department: string;
  section: string;
  division: string;
  level: number;
  isOnline: boolean;
  isLocked: boolean;
  isMasterAdmin: boolean;
  lastLogin: string | null;
  permCount: number;
  initials: string;
  levelText: string;
  lastLoginText: string;
  statusText: string;
  subText: string;
  subText2: string;
  showScanChip: boolean;
  scanNotSet: boolean;
  scanChipText: string;
};

export type Can = { add: boolean; edit: boolean; delete: boolean; perms: boolean; import: boolean; contact: boolean; setup: boolean };

export type PermRow = { sysId: string; title: string; group: string; hint: string; view: boolean; add: boolean; edit: boolean; delete: boolean; approve: boolean };

export type ScanStock = {
  stkId: number;
  code: string;
  name: string;
  canOut: boolean;
  deductEligible: boolean;
  on: boolean;
  priority: boolean;
  deduct: boolean;
  askEmployee: boolean;
  askDepartment: boolean;
  /** 📍 LAYOUT: สแกน QR ตำแหน่งจัดเก็บก่อนสแกนรับเข้า (Sidebar > Layout Setup) */
  askLayout?: boolean;
  display: string;
  options: { key: string; label: string }[];
  /** 📷 ต่อท้าย QR ตอนรับเข้า (DATE / REF / RUNNING) - null = ไม่ใส่ */
  qrDateFmt?: string | null;
  qrRefField?: string | null;
  qrRunStart?: string | null;
  /** ตัวคั่นของ QR คลังนี้ (ADMIN > QR CODE) / ช่องเพิ่มเองของคลัง (เลือกเป็น REF ได้) */
  qrSep?: string;
  qrRefCustom?: { key: string; label: string }[];
};

export type PermData = {
  user: User;
  rows: PermRow[];
  scanner: {
    hasWho: boolean;
    stocks: ScanStock[];
    hasQrSuffix?: boolean;
    hasLayout?: boolean;
    qrDateFormats?: { key: string; sample: string }[];
    qrRefFields?: { key: string; label: string }[];
  } | null;
  contacts: string | null;
};

export type Contact = { fullName: string; phone: string; nickname: string };
