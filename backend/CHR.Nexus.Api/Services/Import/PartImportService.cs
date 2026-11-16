using ClosedXML.Excel;
using Microsoft.Data.SqlClient;
using Nexus.Core;
using Nexus.Models;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace Nexus.Services
{
    // 1 แถวที่อ่านได้จากไฟล์ Excel สำหรับลงทะเบียนสินค้าหน้า Inventory Registration
    public class PartImportRow
    {
        public int RowNumber { get; set; }
        public string Supplier { get; set; }
        public string Category { get; set; }
        public string Code { get; set; }
        public string Name { get; set; }
        public int PackSize { get; set; }
        public string Bin { get; set; }
        public string QrCode { get; set; }
        public string StockText { get; set; }            // รหัสคลังคั่นด้วย , (ว่าง = คลังหลัก)
        public List<string> StockCodes { get; } = new List<string>();   // STOCK1 - STOCK10 (1 ช่อง = 1 รหัสคลัง)
        public string ShowHide { get; set; }              // SHOW / HIDE (แสดงในตารางคลังหลัก) - ว่าง = ตามคลังที่ใส่
        public string Customer { get; set; }
        public Dictionary<string, string> Extra { get; } = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);   // หัวคอลัมน์อื่น (ช่องกรอกเพิ่มเอง)
        public Dictionary<int, string> Custom { get; } = new Dictionary<int, string>();   // FieldID -> ค่า (ช่องกรอกเพิ่มเองของคลังที่ลงทะเบียน)
        public string PartA { get; set; }
        public string PartB { get; set; }
        public string PartNo { get; set; }
        public string Model { get; set; }

        public bool ShowInMain { get; set; } = true;
        public bool ShowInStock { get; set; } = true;     // SHOW/HIDE ในตารางของคลังอื่นที่ระบุ

        public bool InMain { get; set; }                  // ระบุคลังหลักไว้ (หรือไม่ระบุคลังเลย)

        // คอลัมน์เพิ่มเติม (ไม่บังคับ) - null = ไม่ได้กรอก
        // MAX / MIN / ยอด เป็นทศนิยมได้ (บันทึกตามการตั้งค่า DECIMAL QTY ของแต่ละคลัง) / จำนวนกล่องเป็นจำนวนเต็ม
        public decimal? Max { get; set; }
        public decimal? Min { get; set; }
        public int? StockBox { get; set; }
        public int? Coil { get; set; }   // QTY (COIL) - คลังที่นับ Coil
        public decimal? StockPcs { get; set; }
        public string Remark { get; set; }
        public string Image { get; set; }   // IMAGE = ชื่อไฟล์รูป (เก็บตามไฟล์ / ว่าง = ไม่มีรูป)

        // 🧲 แถว Coil: 1 แถว = 1 Coil (NUMBER COIL + MASTER COIL + น้ำหนัก = STOCK (UNIT) ของแถวนั้น)
        //    สินค้าเดียวกันหลาย Coil = ใส่ PRODUCT CODE ซ้ำได้หลายแถว (แถวแรก = ข้อมูลสินค้า / แถวถัดไป = เพิ่ม Coil)
        public string CoilNo { get; set; }
        public string MotherCoil { get; set; }
        public decimal? PartWeight { get; set; }        // WEIGHT (KG) ของสินค้า (คลังที่ไม่นับ Coil)
        public decimal CoilWeight { get; set; }
        public bool IsCoilExtra { get; set; }          // แถว Coil เพิ่มของสินค้าที่อยู่แถวก่อนหน้า (ไม่สร้างสินค้าใหม่)
        public PartImportRow CoilOwner { get; set; }   // แถวแรกของสินค้านั้น
        public int CoilStockId { get; set; }           // คลังที่นับ Coil ที่ Coil นี้เข้า
        public bool CoilStockIsMain { get; set; }
        public PartImportRow ContOwner { get; set; }    // แถว Coil ที่เว้น PRODUCT CODE ไว้ = ของสินค้าแถวบน
        public List<int> OtherStockIds { get; } = new List<int>();
        // import review: raw file text of the editable columns · same key earlier in file · already registered
        public Dictionary<string, string> Raw { get; } = new Dictionary<string, string>();
        public PartImportRow DupOf { get; set; }
        public bool Exists { get; set; }
        public string Error { get; set; }
        public bool IsValid => string.IsNullOrEmpty(Error);
    }

    // Import Excel ลงทะเบียนสินค้าใหม่ - แบบฟอร์มจริงยังรอสรุปกับผู้ใช้งาน จึงหาหัวคอลัมน์เองจาก 10 แถวแรก
    // (ไม่สนตัวพิมพ์เล็ก/ใหญ่ ช่องว่าง จุด วงเล็บ) บังคับแค่ PRODUCT CODE กับ PRODUCT NAME
    public class PartImportService
    {
        private readonly string _connectionString = GlobalConfig.ConnStr;

        private static readonly Dictionary<string, string[]> Headers = new Dictionary<string, string[]>
        {
            ["CODE"] = new[] { "PRODUCTCODE", "PDCODE", "PARTCODE", "CODE", "PTCODE", "ITEMCODE", "รหัสสินค้า" },
            ["NAME"] = new[] { "PRODUCTNAME", "PARTNAME", "NAME", "DESCRIPTION", "PTDESC", "ชื่อสินค้า" },
            ["SUPPLIER"] = new[] { "SUPPLIER", "SUPPLIERCODE", "ผู้ขาย" },
            ["CATEGORY"] = new[] { "CATEGORY", "CAT", "ประเภท", "กลุ่ม" },
            ["PACKSIZE"] = new[] { "PACKSIZE", "PSZ", "PACK", "PCS" },
            ["BIN"] = new[] { "BIN", "LOCATION", "LOC" },
            ["QRCODE"] = new[] { "QRCODE", "QR" },
            ["IMAGE"] = new[] { "IMAGE", "IMAGEFILE", "IMAGEFILENAME", "PICTURE", "รูป", "รูปภาพ" },
            ["COILNO"] = new[] { "COILNO", "COILNUMBER", "NUMBERCOIL", "NOCOIL", "เลขCOIL" },
            ["MOTHERCOIL"] = new[] { "MASTERCOIL", "MASTER", "COILMASTER", "MOTHERCOIL", "MOTHER", "COILMOTHER", "COILแม่" },
            ["STOCK"] = new[] { "STOCK", "STOCKCODE", "คลัง" },
            ["CUSTOMER"] = new[] { "CUSTOMER", "CUST", "CUSTOMERCODE", "ลูกค้า" },
            ["PARTA"] = new[] { "PARTA", "PARTACODE" },
            ["PARTB"] = new[] { "PARTB", "PARTBCODE" },
            ["PARTNO"] = new[] { "PARTNO", "PARTNUMBER" },
            ["MODEL"] = new[] { "MODEL", "MODELCODE", "รหัสโมเดล", "โมเดล" },
            ["SHOWHIDE"] = new[] { "SHOW/HIDE", "SHOWHIDE", "SHOW", "HIDE", "SHOW/HIDDEN", "แสดง/ซ่อน" },
            // คอลัมน์เพิ่มเติม (ไม่บังคับ) ของคลังที่ระบุ
            ["MAX"] = new[] { "MAX", "QTYMAX", "MAXBOX", "MAXPCS", "MAXKG", "MAXSHEET", "MAXUNIT" },
            ["MIN"] = new[] { "MIN", "QTYMIN", "MINBOX", "MINPCS", "MINKG", "MINSHEET", "MINUNIT" },
            ["STOCKBOX"] = new[] { "STOCKBOX" },
            ["STOCKPCS"] = new[] { "STOCKPCS" },
            // ยอดคงเหลือของคลังตามหน่วยของคลัง เช่น QTY (KG.) - หน่วยอื่นดู MatchUnitHeader
            ["QTY"] = new[] { "QTY", "QUANTITY", "BALANCE", "ONHAND", "STOCKQTY", "จำนวน", "ยอดคงเหลือ", "คงเหลือ" },
            ["REMARK"] = new[] { "REMARK", "REMARKS", "หมายเหตุ" },
            // น้ำหนัก (KG): คลังที่นับ Coil = น้ำหนักของ Coil ในแถว / คลังอื่น = น้ำหนักสินค้า (Nexus.Parts.WeightKG)
            ["WEIGHT"] = new[] { "WEIGHT", "WEIGHTKG", "COILWEIGHT", "COILWEIGHTKG", "น้ำหนัก" },
            // Template: STOCK1 - STOCK10 ใส่รหัสคลัง (Stock Code ในหน้า Store (Max-Min)) ช่องละ 1 คลัง
            ["STOCK1"] = new[] { "STOCK1" }, ["STOCK2"] = new[] { "STOCK2" }, ["STOCK3"] = new[] { "STOCK3" }, ["STOCK4"] = new[] { "STOCK4" },
            ["STOCK5"] = new[] { "STOCK5" }, ["STOCK6"] = new[] { "STOCK6" }, ["STOCK7"] = new[] { "STOCK7" }, ["STOCK8"] = new[] { "STOCK8" },
            ["STOCK9"] = new[] { "STOCK9" }, ["STOCK10"] = new[] { "STOCK10" }
        };

        private static string Normalize(string h) =>
            new string((h ?? "").Where(c => !char.IsWhiteSpace(c) && c != '.' && c != '(' && c != ')' && c != '_' && c != '-').ToArray()).ToUpperInvariant();

        // หน่วยที่ต่อท้ายหัวคอลัมน์ได้ เช่น QTY (KG.) / MAX (SHEET) / MIN (PCS) / STOCK (KG.) - ใช้หน่วยไหนก็ได้ตามคลัง
        private static readonly string[] Units =
            { "", "KG", "KGS", "PCS", "PC", "SHEET", "SHEETS", "SHT", "UNIT", "UNITS", "EA", "SET", "SETS", "ROLL", "ROLLS",
              "M", "MM", "CM", "METER", "L", "LITER", "LITRE", "TON", "G", "PACK", "PAC", "BAG", "ชิ้น", "แผ่น", "กก" };

        // หัวคอลัมน์ที่ไม่ตรงรายการด้านบน: <MAX|MIN|QTY|STOCK|BALANCE>(หน่วย) -> MAX / MIN / ยอดคงเหลือ
        //   STOCK (BOX) / QTY (BOX) = จำนวนกล่อง, STOCK (PCS) = ชิ้น (แบบ StorePC), หน่วยอื่น = ยอดคงเหลือ (QTY) ของคลัง
        //   MAX (DAY) / MIN (DAY) เป็นค่าของ Max-Min Calculator ไม่ใช่ของคลัง -> ไม่นับ
        internal static string MatchUnitHeader(string h)
        {
            foreach (var (prefix, key) in new[] { ("MAX", "MAX"), ("MIN", "MIN"), ("QTY", "QTY"), ("STOCK", "QTY"), ("BALANCE", "QTY"), ("ONHAND", "QTY") })
            {
                if (!h.StartsWith(prefix, StringComparison.Ordinal)) continue;
                string unit = h.Substring(prefix.Length);
                if (unit == "BOX" || unit == "BOXES" || unit == "กล่อง") return key == "QTY" ? "STOCKBOX" : key;
                // QTY (COIL) = จำนวน Coil ของคลัง KG ที่นับ Coil
                if (unit == "COIL" || unit == "COILS") return key == "QTY" ? "COIL" : key;
                if (Units.Contains(unit)) return key;
            }
            return null;
        }

        // edits[row][header key] replaces the cell text (re-validated by the same parser) · skip = rows the user excluded in the review
        //   data = the upload bytes kept in memory (the temp file is deleted right after the first read)
        public List<PartImportRow> ReadExcel(byte[] data, List<StockModel> stocks,
                                             IReadOnlyDictionary<int, Dictionary<string, string>> edits = null, ISet<int> skip = null)
        {
            var rows = new List<PartImportRow>();
            using (var fs = new MemoryStream(data, false))
            using (var wb = new XLWorkbook(fs))
            {
                var ws = wb.Worksheet(1);
                var cols = new Dictionary<string, int>();
                int headerRow = 0;

                var extraCols = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                foreach (var row in ws.RowsUsed().Take(10))
                {
                    cols.Clear();
                    extraCols.Clear();
                    foreach (var cell in row.CellsUsed())
                    {
                        string h = Normalize(cell.GetString());
                        bool matched = false;
                        foreach (var kv in Headers)
                            if (!cols.ContainsKey(kv.Key) && kv.Value.Contains(h)) { cols[kv.Key] = cell.Address.ColumnNumber; matched = true; break; }
                        if (!matched)
                        {
                            string key = MatchUnitHeader(h);
                            if (key != null && !cols.ContainsKey(key)) cols[key] = cell.Address.ColumnNumber;
                            else if (key == null && h.Length > 0 && !extraCols.ContainsKey(h)) extraCols[h] = cell.Address.ColumnNumber;
                        }
                    }
                    if (cols.ContainsKey("CODE") && cols.ContainsKey("NAME")) { headerRow = row.RowNumber(); break; }
                }

                if (headerRow == 0)
                    throw new InvalidDataException("ไม่พบหัวคอลัมน์ในไฟล์ Excel\nต้องมีอย่างน้อยคอลัมน์ \"PRODUCT CODE\" และ \"PRODUCT NAME\" (อยู่ใน 10 แถวแรกของชีทแรก)");

                string Get(int r, string key) =>
                    edits != null && edits.TryGetValue(r, out var e) && e.TryGetValue(key, out var v) ? (v ?? "").Trim()
                    : cols.TryGetValue(key, out int c) ? ws.Cell(r, c).GetString().Trim() : "";

                int lastRow = ws.LastRowUsed()?.RowNumber() ?? headerRow;
                PartImportRow lastProduct = null;
                for (int r = headerRow + 1; r <= lastRow; r++)
                {
                    var item = new PartImportRow
                    {
                        RowNumber = r,
                        Code = Get(r, "CODE"),
                        Name = Get(r, "NAME"),
                        Supplier = Get(r, "SUPPLIER"),
                        Category = Get(r, "CATEGORY"),
                        Bin = Get(r, "BIN"),
                        QrCode = Get(r, "QRCODE"),
                        Image = Get(r, "IMAGE"),
                        CoilNo = Get(r, "COILNO") is string cn && cn.Length > 0 && cn != "-" ? cn.ToUpperInvariant() : null,
                        MotherCoil = Get(r, "MOTHERCOIL") is string mc && mc.Length > 0 && mc != "-" ? mc.ToUpperInvariant() : null,
                        StockText = Get(r, "STOCK"),
                        Customer = Get(r, "CUSTOMER"),
                        PartA = Get(r, "PARTA"),
                        PartB = Get(r, "PARTB"),
                        PartNo = Get(r, "PARTNO"),
                        Model = Get(r, "MODEL"),
                        ShowHide = Get(r, "SHOWHIDE")
                    };
                    foreach (var (k, _) in Editable) item.Raw[k] = Get(r, k);
                    for (int n = 1; n <= 10; n++)
                    {
                        string sc = Get(r, "STOCK" + n);
                        if (sc.Length > 0) item.StockCodes.Add(sc);
                    }
                    foreach (var ex in extraCols)
                    {
                        string v = ws.Cell(r, ex.Value).GetString().Trim();
                        if (v.Length > 0 && v != "-") item.Extra[ex.Key] = v;
                    }
                    string psz = Get(r, "PACKSIZE");
                    // แถว Coil ใต้แถวสินค้า (PRODUCT CODE / NAME ว่าง แต่มี NUMBER COIL) = Coil เพิ่มของสินค้าแถวบน
                    if (string.IsNullOrEmpty(item.Code) && string.IsNullOrEmpty(item.Name) && item.CoilNo != null)
                    {
                        if (lastProduct == null) { item.Error = $"NUMBER COIL {item.CoilNo}: ไม่มีแถวสินค้าด้านบน (ใส่ PRODUCT CODE ที่แถวแรกของสินค้า)"; rows.Add(item); continue; }
                        item.ContOwner = lastProduct;
                        item.Code = lastProduct.Code; item.Name = lastProduct.Name; item.PartA = lastProduct.PartA;
                        item.StockText = lastProduct.StockText; item.StockCodes.AddRange(lastProduct.StockCodes);
                    }
                    // PRODUCT CODE นำเข้าตามไฟล์ (ไม่เอาช่องอื่นมาใส่แทน) - ไม่มีรหัสให้ใส่ "-" ในไฟล์
                    if (string.IsNullOrEmpty(item.Code) && string.IsNullOrEmpty(item.Name)) continue;
                    if (item.ContOwner == null) lastProduct = item;

                    if (string.IsNullOrEmpty(item.Code)) item.Error = "ไม่มี PRODUCT CODE (ถ้าไม่มีรหัสให้ใส่ - )";
                    else if (string.IsNullOrEmpty(item.Name)) item.Error = "ไม่มีชื่อสินค้า";
                    else if (!string.IsNullOrEmpty(psz))
                    {
                        if (decimal.TryParse(psz, NumberStyles.Number, CultureInfo.InvariantCulture, out decimal p) && p >= 0)
                            item.PackSize = (int)Math.Round(p, MidpointRounding.AwayFromZero);
                        else item.Error = $"PACKSIZE ไม่ถูกต้อง ({psz})";
                    }

                    // คอลัมน์เพิ่มเติม (ไม่บังคับ): MAX / MIN / STOCK (BOX) / STOCK (PCS) / REMARK -> บันทึกตามที่พิมพ์ในไฟล์
                    int? Whole(string key, string label)
                    {
                        string s = Get(r, key);
                        if (s.Length == 0 || item.Error != null) return null;
                        if (decimal.TryParse(s.Replace(",", ""), NumberStyles.Number, CultureInfo.InvariantCulture, out decimal v) && v >= 0 && v == Math.Floor(v)) return (int)v;
                        item.Error = $"{label} ต้องเป็นจำนวนเต็มไม่ติดลบ ({s})";
                        return null;
                    }
                    // ทศนิยมได้ (คลังที่ไม่ได้เปิด DECIMAL QTY ปัดเป็นจำนวนเต็มตอนบันทึก)
                    decimal? Num(string key, string label)
                    {
                        string s = Get(r, key);
                        if (s.Length == 0 || item.Error != null) return null;
                        if (Nexus.Helpers.Qty.TryParse(s, out decimal v) && v >= 0) return Nexus.Helpers.Qty.Round(v, true);
                        item.Error = s.Any(char.IsDigit) ? $"{label} ต้องเป็นตัวเลขไม่ติดลบ ({s})" : $"{label} ต้องเป็นตัวเลข ไม่ใช่ชื่อหน่วย ({s}) - ใส่ยอด / น้ำหนักเป็นตัวเลข (หน่วยของคลังตั้งที่ EDIT STOCK)";
                        return null;
                    }
                    item.Max = Num("MAX", "MAX");
                    item.Min = Num("MIN", "MIN");
                    item.StockBox = Whole("STOCKBOX", "STOCK (BOX)");
                    item.Coil = Whole("COIL", "STOCK (COIL)");
                    item.StockPcs = Num("STOCKPCS", "STOCK (PCS)");
                    // QTY (KG.) / QTY (SHEET) ... = ยอดคงเหลือของคลัง (คอลัมน์เดียวกับ STOCK (PCS) ของคลังที่นับเป็นชิ้น)
                    decimal? qty = Num("QTY", "STOCK (UNIT)");
                    if (item.Error == null && qty.HasValue)
                    {
                        if (item.StockPcs.HasValue && item.StockPcs.Value != qty.Value)
                            item.Error = $"STOCK (UNIT) ({qty}) ไม่ตรงกับ STOCK (PCS) ({item.StockPcs}) - ใส่อย่างใดอย่างหนึ่ง";
                        else item.StockPcs = qty;
                    }
                    // WEIGHT (KG): แถว Coil = น้ำหนักของ Coil (ใช้แทน STOCK (UNIT) ได้) / แถวสินค้า = น้ำหนักสินค้า
                    decimal? weight = Num("WEIGHT", "WEIGHT (KG)");
                    // ใส่แค่ MASTER COIL (ไม่มี NUMBER COIL) = Master ทั้งม้วน (เลข Coil = เลข Master) แบบช่องกรอกในหน้าเว็บ
                    if (item.Error == null && item.CoilNo == null && item.MotherCoil != null) { item.CoilNo = item.MotherCoil; item.MotherCoil = null; }
                    if (item.Error == null && weight.HasValue)
                    {
                        if (item.CoilNo != null) { if (!item.StockPcs.HasValue) item.StockPcs = weight; }
                        else item.PartWeight = weight;
                    }
                    // แถว Coil: น้ำหนักของ Coil นี้ = STOCK (UNIT) / STOCK (PCS) ของแถว / 1 แถว = 1 Coil
                    if (item.Error == null && item.CoilNo != null)
                    {
                        if (!item.StockPcs.HasValue || item.StockPcs.Value <= 0) item.Error = $"NUMBER COIL {item.CoilNo}: ใส่น้ำหนักของ Coil นี้ที่ STOCK (UNIT)";
                        else if (item.Coil.HasValue && item.Coil.Value != 1) item.Error = $"NUMBER COIL {item.CoilNo}: 1 แถว = 1 Coil (STOCK (COIL) ว่าง หรือ 1)";
                        else item.CoilWeight = item.StockPcs.Value;
                    }
                    else if (item.Error == null && item.MotherCoil != null) item.Error = "ใส่ MASTER COIL แล้วต้องใส่ NUMBER COIL ด้วย";
                    string rmk = Get(r, "REMARK");
                    item.Remark = rmk.Length == 0 ? null : rmk;
                    if (item.Error == null && item.Max.HasValue && item.Min.HasValue && item.Max > 0 && item.Min > item.Max)
                        item.Error = $"MIN {item.Min} มากกว่า MAX {item.Max}";

                    if (item.IsValid) ResolveStocks(item, stocks);
                    rows.Add(item);
                }
            }

            // excluded before the duplicate check: excluding the first of two same-key rows lets the next one count
            if (skip != null)
                foreach (var x in rows.Where(x => x.IsValid && skip.Contains(x.RowNumber))) x.Error = "ไม่ใช้ (เลือกในหน้าตรวจก่อนนำเข้า)";
            ValidateAgainstDb(rows, stocks);
            ApplyCustomFields(rows, stocks);
            return rows;
        }

        // ➕ หัวคอลัมน์ที่ตรงกับชื่อช่องกรอกเพิ่มเองของคลังที่ลงทะเบียน = ค่าของช่องนั้น · ค่าผิดชนิด (ตัวเลข / วันที่) = แถวนั้นมีปัญหา
        private static void ApplyCustomFields(List<PartImportRow> rows, List<StockModel> stocks)
        {
            if (!rows.Any(r => r.Extra.Count > 0) || !CustomFieldService.Ready) return;
            var defs = new CustomFieldService().GetDefs();
            if (defs.Count == 0) return;
            int mainId = stocks.FirstOrDefault(s => s.IsMain)?.StkId ?? 0;
            foreach (var r in rows.Where(r => r.IsValid && r.Extra.Count > 0))
            {
                var ids = new HashSet<int>(r.OtherStockIds);
                if (r.InMain) ids.Add(mainId);
                foreach (var d in defs.Where(d => ids.Contains(d.StockId)))
                {
                    if (!r.Extra.TryGetValue(Normalize(d.Label), out var v)) continue;   // หัวคอลัมน์ในไฟล์ถูกตัดช่องว่าง / วงเล็บแล้ว
                    try { r.Custom[d.FieldId] = CustomFieldService.Normalize(d, v); }
                    catch (InvalidOperationException ex) { r.Error = ex.Message; break; }
                }
            }
        }

        // คลังของสินค้า: STOCK1 - STOCK10 (ช่องละ 1 รหัสคลัง) และ/หรือ STOCK (คั่นด้วย ,)
        //   ไม่ใส่คลังเลย = คลังหลัก / ใส่รหัสคลังหลัก = อยู่ในคลังหลัก / คลังอื่น = เพิ่มเข้าคลังนั้น (ยอดเริ่ม 0)
        //   คลังหลักได้สินค้าเฉพาะเมื่อระบุรหัสคลังหลัก (หรือไม่ระบุคลังเลย) เท่านั้น
        //   SHOW / HIDE (1 / 0) = แสดง / ซ่อน ในตารางของคลังที่ระบุ (ว่าง = แสดง)
        private static void ResolveStocks(PartImportRow item, List<StockModel> stocks)
        {
            var codes = item.StockCodes
                .Concat((item.StockText ?? "").Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries))
                .Select(x => x.Trim()).Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

            bool inMain = codes.Count == 0;
            foreach (string code in codes)
            {
                var s = stocks.FirstOrDefault(x => string.Equals(x.Code, code, StringComparison.OrdinalIgnoreCase));
                if (s == null) { item.Error = $"ไม่พบคลัง \"{code}\" ในระบบ"; return; }
                if (s.IsMain) inMain = true;
                else if (!item.OtherStockIds.Contains(s.StkId)) item.OtherStockIds.Add(s.StkId);
            }

            bool show = true;
            string sh = (item.ShowHide ?? "").Trim().ToUpperInvariant();
            if (sh.Length == 0 || sh == "SHOW" || sh == "Y" || sh == "YES" || sh == "1" || sh == "TRUE" || sh == "แสดง") show = true;
            else if (sh == "HIDE" || sh == "N" || sh == "NO" || sh == "0" || sh == "FALSE" || sh == "ซ่อน") show = false;
            else { item.Error = $"SHOW/HIDE ไม่ถูกต้อง ({item.ShowHide}) - ใส่ 1 (แสดง) หรือ 0 (ซ่อน)"; return; }

            item.InMain = inMain;
            item.ShowInMain = inMain && show;   // ไม่ได้ระบุคลังหลัก = ไม่อยู่ในคลังหลัก
            item.ShowInStock = show;
        }

        // สินค้า 1 ตัว = PRODUCT CODE + PART A (PRODUCT CODE ซ้ำได้ถ้า PART A ต่างกัน เช่น STORE-PC)
        // + PART B: same key as UX_MST_PART_CODE_PARTA (STORE-SUB items share PRODUCT CODE '-' and differ by PART B)
        private static string Key(string code, string partA, string partB = "") => (code ?? "").Trim().ToUpperInvariant() + "|" + (partA ?? "").Trim().ToUpperInvariant() + "|" + (partB ?? "").Trim().ToUpperInvariant();

        // ข้ามสินค้าที่มีในระบบแล้ว และแถวที่ซ้ำกันเองในไฟล์ (PRODUCT CODE + PART A เดียวกัน - เก็บแถวแรกไว้)
        private void ValidateAgainstDb(List<PartImportRow> rows, List<StockModel> stocks)
        {
            var existing = new HashSet<string>();
            Dictionary<string, (int Stock, string StockCode, string Status, int Part)> coils;
            using (var conn = new SqlConnection(_connectionString))
            {
                conn.Open();
                using (var cmd = new SqlCommand("SELECT PartCode, ISNULL(PartA, ''), " + (Nexus.Helpers.DbSchema.HasPartB ? "ISNULL(PartB, '')" : "''") + " FROM Nexus.Parts", conn))
                using (var rdr = cmd.ExecuteReader())
                    while (rdr.Read()) existing.Add(Key(rdr.GetString(0), rdr.GetString(1), rdr.GetString(2)));
                coils = CoilImportService.LoadCoils(conn);
            }

            // สินค้าซ้ำในไฟล์: ทั้งสองแถวเป็นแถว Coil = เพิ่ม Coil ให้สินค้าแถวแรก / ไม่ใช่ = ซ้ำ (ข้าม)
            var first = new Dictionary<string, PartImportRow>();
            foreach (var r in rows.Where(x => x.IsValid))
            {
                string k = Key(r.Code, r.PartA, r.PartB);
                if (r.ContOwner != null && (!r.ContOwner.IsValid || r.ContOwner.CoilNo == null))
                    r.Error = r.ContOwner.IsValid ? $"แถวสินค้า {r.ContOwner.RowNumber} ต้องใส่ NUMBER COIL ด้วย (สินค้าหลาย Coil)" : $"สินค้าแถว {r.ContOwner.RowNumber} ไม่ผ่าน ({r.ContOwner.Error})";
                else if (existing.Contains(k)) { r.Exists = true; r.Error = "สินค้านี้ลงทะเบียนไว้แล้ว (PRODUCT CODE + PART A) - เพิ่ม / อัพเดทผ่าน IMPORT EXCEL หน้า Store (Max-Min)"; }
                else if (first.TryGetValue(k, out var owner))
                {
                    if (r.CoilNo != null && owner.CoilNo != null) { r.IsCoilExtra = true; r.CoilOwner = owner; }
                    else { r.DupOf = owner; r.Error = "ซ้ำกับแถวก่อนหน้าในไฟล์ (PRODUCT CODE + PART A เดียวกัน) - หลาย Coil ให้ใส่ NUMBER COIL ทุกแถว"; }
                }
                else first[k] = r;
            }

            // คลังที่ Coil เข้า = คลังแรกของสินค้า (แถวแรก) ที่เปิด STOCK (COIL) / Coil ซ้ำในไฟล์หรือมีในทะเบียนแล้ว = ข้าม
            var seenCoil = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var r in rows.Where(x => x.IsValid && x.CoilNo != null))
            {
                var owner = r.CoilOwner ?? r;
                var target = (owner.InMain ? stocks.Where(s => s.IsMain) : Enumerable.Empty<StockModel>())
                             .Concat(owner.OtherStockIds.Select(id => stocks.FirstOrDefault(s => s.StkId == id)))
                             .FirstOrDefault(s => s != null && s.CountCoil);
                if (!Nexus.Helpers.DbSchema.HasCoilRegister) r.Error = "ฐานข้อมูลยังไม่มีทะเบียน Coil (Update_20261008.sql)";
                else if (target == null) r.Error = $"NUMBER COIL {r.CoilNo}: คลังของสินค้านี้ไม่ได้นับ Coil (เปิด STOCK (COIL) ที่ EDIT STOCK)";
                else if (seenCoil.TryGetValue(r.CoilNo, out int at)) r.Error = $"NUMBER COIL {r.CoilNo} ซ้ำกับแถว {at}";
                else if (coils.TryGetValue(r.CoilNo, out var c) && c.Status == "IN") r.Error = $"NUMBER COIL {r.CoilNo} อยู่ในคลัง {c.StockCode} แล้ว";
                else { seenCoil[r.CoilNo] = r.RowNumber; r.CoilStockId = target.StkId; r.CoilStockIsMain = target.IsMain; }
            }
            // แถวแรกของสินค้าไม่ผ่าน -> แถว Coil เพิ่มของสินค้านั้นก็ไม่นำเข้า
            foreach (var r in rows.Where(x => x.IsValid && x.IsCoilExtra && !x.CoilOwner.IsValid))
                r.Error = $"สินค้าแถว {r.CoilOwner.RowNumber} ไม่ผ่าน ({r.CoilOwner.Error})";
        }

        // ---------------------------------------------------------------- IMPORT REVIEW (PLAN.md shared import contract)
        //   This import only registers NEW parts (existing PRODUCT CODE + PART A = skipped, same as before) · row key = "R<excel row>"
        //   (header key, review field name): text / number columns of the register form · CODE / PART A (= key) not editable
        public static readonly (string Key, string Label)[] Editable =
        {
            ("NAME", "PRODUCT NAME"), ("SUPPLIER", "SUPPLIER"), ("CUSTOMER", "CUSTOMER"), ("CATEGORY", "CATEGORY"), ("PARTB", "PART B"),
            ("PARTNO", "PART NO"), ("MODEL", "MODEL"), ("PACKSIZE", "PACK SIZE"), ("BIN", "BIN"), ("QRCODE", "QR CODE"),
            ("MAX", "MAX"), ("MIN", "MIN"), ("REMARK", "REMARK")
        };

        public static string RowKey(int row) => "R" + row;

        public sealed record ExistingPart(string Code, string PartA, string Name);

        public List<ExistingPart> LoadExisting()
        {
            var list = new List<ExistingPart>();
            using (var conn = new SqlConnection(_connectionString))
            using (var cmd = new SqlCommand("SELECT PartCode, ISNULL(PartA, ''), ISNULL(Description, '') FROM Nexus.Parts", conn))
            {
                conn.Open();
                using (var rdr = cmd.ExecuteReader())
                    while (rdr.Read()) list.Add(new ExistingPart(rdr.GetString(0), rdr.GetString(1), rdr.GetString(2)));
            }
            return list;
        }

        // NEW (or SIMILAR when an existing PRODUCT CODE + PART A differs only by case / space / - _ .) · DUPLICATE = same key earlier in
        // the file (first row wins, as before) · INVALID = parser error or already registered. Extra coil rows fold into their product.
        public static (List<ImportRowDto> Rows, List<ImportErrorDto> Errors) Preview(List<PartImportRow> rows, List<ExistingPart> existing)
        {
            string Near(string code, string partA) => ImportReview.NormKey(code) + "|" + ImportReview.NormKey(partA);
            var near = existing.GroupBy(e => Near(e.Code, e.PartA)).ToDictionary(g => g.Key, g => g.ToList());
            var coils = rows.Where(r => r.IsValid && r.CoilNo != null).GroupBy(r => r.CoilOwner ?? r).ToDictionary(g => g.Key, g => g.ToList());
            var list = new List<ImportRowDto>();
            var errors = new List<ImportErrorDto>();
            foreach (var r in rows.Where(r => !r.IsValid || !r.IsCoilExtra))
            {
                string key = RowKey(r.RowNumber), code = string.IsNullOrEmpty(r.Code) ? "-" : r.Code;
                string label = string.IsNullOrEmpty(r.PartA) ? code : $"{code} · PART A {r.PartA}";
                string sub = $"แถว {r.RowNumber}" + (string.IsNullOrEmpty(r.Name) ? "" : $" · {r.Name}");
                bool canEdit = r.IsValid || (!r.Exists && r.DupOf == null && r.ContOwner == null);
                var f = Editable.Where(e => canEdit || (r.Raw.TryGetValue(e.Key, out var v) && v.Length > 0))
                                .Select(e => new ImportField(e.Label, null, r.Raw.TryGetValue(e.Key, out var v) ? v : "", canEdit)).ToList();
                if (!r.IsValid)
                {
                    errors.Add(new ImportErrorDto($"แถว {r.RowNumber}", $"{code} - {r.Error}"));
                    list.Add(new ImportRowDto(key, r.DupOf != null ? ImportReview.Duplicate : ImportReview.Invalid, label, sub, f,
                        r.DupOf != null ? $"PRODUCT CODE + PART A ซ้ำกับแถว {r.DupOf.RowNumber} · ใช้แถวบนสุด แถวนี้ถูกข้าม" : r.Error, null));
                    continue;
                }
                var stocks = new List<string>();
                if (r.InMain) stocks.Add("คลังหลัก");
                stocks.AddRange(r.StockCodes.Concat((r.StockText ?? "").Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries)).Select(s => s.Trim()));
                f.Add(new ImportField("STOCK", null, string.Join(", ", stocks.Distinct(StringComparer.OrdinalIgnoreCase))));
                if (coils.TryGetValue(r, out var cl))
                    f.Add(new ImportField("COIL", null, $"{cl.Count:N0} ลูก · {cl.Sum(c => c.CoilWeight):#,##0.###} KG · {string.Join(", ", cl.Select(c => c.CoilNo).Take(10))}{(cl.Count > 10 ? " ..." : "")}"));
                if (near.TryGetValue(Near(r.Code, r.PartA), out var sim))
                    list.Add(new ImportRowDto(key, ImportReview.Similar, label, sub, f,
                        "ไม่พบสินค้านี้ แต่คล้ายของเดิม (ต่างแค่ตัวพิมพ์ / ขีด / เว้นวรรค) · ใช้ตัวที่มีอยู่ = ไม่ลงทะเบียนแถวนี้ หรือเพิ่มเป็นสินค้าใหม่",
                        sim.Take(5).Select(e => new ImportSuggest(e.Code + "|" + e.PartA,
                            (string.IsNullOrEmpty(e.PartA) ? e.Code : $"{e.Code} · PART A {e.PartA}") + (e.Name.Length > 0 ? $" · {e.Name}" : ""))).ToList()));
                else list.Add(new ImportRowDto(key, ImportReview.New, label, sub, f, null, null));
            }
            return (list, errors);
        }

        // ImportApplyRequest -> parser input: edits by excel row + header key; skip = excluded rows and SIMILAR rows mapped to an existing part
        public static (Dictionary<int, Dictionary<string, string>> Edits, HashSet<int> Skip) ApplyArgs(ImportApplyRequest req)
        {
            static int RowOf(string key) =>
                key != null && key.StartsWith("R") && int.TryParse(key.Substring(1), out int n) && n > 1 ? n : throw new InvalidOperationException($"รายการ \"{key}\" ไม่ถูกต้อง");
            var skip = new HashSet<int>((req.Exclude ?? new List<string>()).Select(RowOf));
            foreach (var kv in req.Map ?? new Dictionary<string, string>())
                if (!string.IsNullOrWhiteSpace(kv.Value)) skip.Add(RowOf(kv.Key));   // "use the existing part" = do not register this row
            var edits = new Dictionary<int, Dictionary<string, string>>();
            foreach (var kv in req.Edits ?? new Dictionary<string, Dictionary<string, string>>())
            {
                var e = new Dictionary<string, string>();
                foreach (var fv in kv.Value ?? new Dictionary<string, string>())
                {
                    var col = Editable.FirstOrDefault(x => string.Equals(x.Label, fv.Key, StringComparison.OrdinalIgnoreCase));
                    if (col.Key == null) throw new InvalidOperationException($"แก้ช่อง \"{fv.Key}\" ผ่านหน้าตรวจไม่ได้");
                    if ((fv.Value ?? "").Length > 500) throw new InvalidOperationException($"{col.Label} ยาวเกิน 500 ตัวอักษร");
                    e[col.Key] = fv.Value ?? "";
                }
                if (e.Count > 0) edits[RowOf(kv.Key)] = e;
            }
            return (edits, skip);
        }

        // an edited row that still fails stops the apply (the fix must not be dropped silently) · excluded / mapped rows never count
        public static List<PartImportRow> StillBad(List<PartImportRow> rows, IReadOnlyDictionary<int, Dictionary<string, string>> edits, ISet<int> skip) =>
            rows.Where(r => !r.IsValid && edits.ContainsKey(r.RowNumber) && !skip.Contains(r.RowNumber)).ToList();

        // ลงทะเบียนทุกแถวที่ผ่านการตรวจใน Transaction เดียว - พังแถวเดียวยกเลิกทั้งไฟล์
        public int ApplyImport(List<PartImportRow> rows, string userId = null)
        {
            // แถว Coil ของสินค้าเดียวกัน: ยอด KG ของสินค้า = น้ำหนักรวมทุก Coil ในไฟล์ / STOCK (COIL) = นับจากทะเบียน
            var coilRows = rows.Where(r => r.IsValid && r.CoilNo != null).GroupBy(r => r.CoilOwner ?? r).ToDictionary(g => g.Key, g => g.ToList());
            foreach (var kv in coilRows) kv.Key.StockPcs = kv.Value.Sum(r => r.CoilWeight);
            var valid = rows.Where(r => r.IsValid && !r.IsCoilExtra).ToList();
            if (valid.Count == 0) return 0;

            using (var conn = new SqlConnection(_connectionString))
            {
                conn.Open();
                // คลังไหนเปิด DECIMAL QTY (เก็บทศนิยม) / คลังอื่นปัดเป็นจำนวนเต็ม
                var decStock = new Dictionary<int, bool>();
                bool mainDec = false, mainCoil = false;
                var coilStock = new Dictionary<int, bool>();
                using (var cmd = new SqlCommand("SELECT StockID, IsMain, " + (Nexus.Helpers.DbSchema.HasAllowDecimal ? "AllowDecimal" : "CAST(0 AS BIT) AS AllowDecimal")
                                                + ", " + (Nexus.Helpers.DbSchema.HasCountCoil ? "CountCoil" : "CAST(0 AS BIT) AS CountCoil") + " FROM Nexus.Stocks", conn))
                using (var reader = cmd.ExecuteReader())
                    while (reader.Read())
                    {
                        decStock[reader.GetInt32(0)] = reader.GetBoolean(2);
                        coilStock[reader.GetInt32(0)] = reader.GetBoolean(3);
                        if (reader.GetBoolean(1)) { mainDec = reader.GetBoolean(2); mainCoil = reader.GetBoolean(3); }
                    }
                decimal Rnd(decimal v, bool dec) => Nexus.Helpers.Qty.Round(v, dec);

                using (var trans = conn.BeginTransaction())
                {
                    foreach (var r in valid)
                    {
                        int ptId;
                        bool hasB = Nexus.Helpers.DbSchema.HasPartB;
                        using (var cmd = new SqlCommand($@"
                            INSERT INTO Nexus.Parts (PartCode, Description, PackSize, QRCode, MaxQuantity, MinQuantity, Category,
                                                  Bin, StockQuantity, IsActive, IsShowInMaster, ImageFileName, Supplier,
                                                  Customer, PartA, PartNumber, Model{(hasB ? ", PartB" : "")})
                            VALUES (@code, @name, @psz, @qr, @mmax, @mmin, @cat, @bin, @mqty, 1, @show, @img, @sup,
                                    @cust, @parta, @partno, @model{(hasB ? ", @partb" : "")});
                            IF @inMain = 1 AND @rmk IS NOT NULL UPDATE Nexus.Parts SET Remark = @rmk WHERE PartID = SCOPE_IDENTITY();
                            SELECT CAST(SCOPE_IDENTITY() AS INT);", conn, trans))
                        {
                            cmd.Parameters.AddWithValue("@code", r.Code);
                            cmd.Parameters.AddWithValue("@name", r.Name);
                            cmd.Parameters.AddWithValue("@psz", r.PackSize);
                            cmd.Parameters.AddWithValue("@qr", r.QrCode ?? "");
                            // ค่าเริ่มต้นเดียวกับการลงทะเบียนทีละรายการ (InsertNewPartAsync)
                            cmd.Parameters.AddWithValue("@cat", string.IsNullOrWhiteSpace(r.Category) ? "GENERAL" : r.Category);
                            cmd.Parameters.AddWithValue("@bin", string.IsNullOrWhiteSpace(r.Bin) ? "N/A" : r.Bin);
                            cmd.Parameters.AddWithValue("@show", r.ShowInMain ? 1 : 0);
                            cmd.Parameters.AddWithValue("@sup", string.IsNullOrWhiteSpace(r.Supplier) ? (object)DBNull.Value : r.Supplier);
                            cmd.Parameters.AddWithValue("@cust", string.IsNullOrWhiteSpace(r.Customer) ? (object)DBNull.Value : r.Customer);
                            cmd.Parameters.AddWithValue("@parta", string.IsNullOrWhiteSpace(r.PartA) ? (object)DBNull.Value : r.PartA);
                            cmd.Parameters.AddWithValue("@partb", string.IsNullOrWhiteSpace(r.PartB) ? (object)DBNull.Value : r.PartB);
                            cmd.Parameters.AddWithValue("@partno", string.IsNullOrWhiteSpace(r.PartNo) ? (object)DBNull.Value : r.PartNo);
                            cmd.Parameters.AddWithValue("@model", string.IsNullOrWhiteSpace(r.Model) ? (object)DBNull.Value : r.Model);
                            cmd.Parameters.AddWithValue("@img", string.IsNullOrWhiteSpace(r.Image) || r.Image.Trim() == "-" ? (object)DBNull.Value : r.Image.Trim());
                            // MAX / MIN / ยอด / REMARK ของคลังหลัก (เฉพาะเมื่อระบุคลังหลัก) - ยอด: STOCK (PCS) ก่อน ไม่มีใช้ BOX x PACKSIZE
                            bool inMain = r.InMain;
                            cmd.Parameters.AddWithValue("@inMain", inMain ? 1 : 0);
                            cmd.Parameters.Add(Nexus.Helpers.QtyParam.Of("@mmax", inMain ? Rnd(r.Max ?? 0, mainDec) : 0m));
                            cmd.Parameters.Add(Nexus.Helpers.QtyParam.Of("@mmin", inMain ? Rnd(r.Min ?? 0, mainDec) : 0m));
                            cmd.Parameters.Add(Nexus.Helpers.QtyParam.Of("@mqty", inMain ? Rnd(r.StockPcs ?? (r.StockBox.HasValue ? r.StockBox.Value * Math.Max(1, r.PackSize) : 0), mainDec) : 0m));
                            cmd.Parameters.AddWithValue("@rmk", (object)r.Remark ?? DBNull.Value);
                            ptId = (int)cmd.ExecuteScalar();
                        }
                        if (r.PartWeight.HasValue && Nexus.Helpers.DbSchema.HasPartWeight)
                            using (var cmd = new SqlCommand("UPDATE Nexus.Parts SET WeightKG = @w WHERE PartID = @p", conn, trans))
                            {
                                cmd.Parameters.Add(Nexus.Helpers.QtyParam.Of("@w", r.PartWeight.Value));
                                cmd.Parameters.AddWithValue("@p", ptId);
                                cmd.ExecuteNonQuery();
                            }
                        // คลังหลักที่นับ Coil: QTY (COIL) ตามไฟล์
                        if (r.InMain && mainCoil && r.Coil.HasValue)
                            using (var cmd = new SqlCommand("UPDATE Nexus.Parts SET CoilQuantity = @c WHERE PartID = @p", conn, trans))
                            {
                                cmd.Parameters.AddWithValue("@c", r.Coil.Value);
                                cmd.Parameters.AddWithValue("@p", ptId);
                                cmd.ExecuteNonQuery();
                            }

                        foreach (int stkId in r.OtherStockIds)
                        {
                            // STOCK (PCS) + STOCK (BOX): ใส่ทั้งคู่ = ตามไฟล์ / ใส่ PCS อย่างเดียว = BOX คำนวณจาก PACKSIZE / ใส่ BOX อย่างเดียว = PCS = BOX x PACKSIZE
                            bool dec = decStock.TryGetValue(stkId, out bool dv) && dv;
                            // คลังที่นับ Coil: ช่องกล่อง = QTY (COIL) ตามไฟล์ ยอด KG ไม่คำนวณจากกล่อง (Trigger ข้ามคลัง Coil)
                            bool coil = coilStock.TryGetValue(stkId, out bool cv) && cv;
                            decimal pcs = Rnd(r.StockPcs ?? (!coil && r.StockBox.HasValue ? r.StockBox.Value * Math.Max(1, r.PackSize) : 0), dec);
                            int box = coil ? (r.Coil ?? 0) : (r.StockBox ?? 0);
                            using (var cmd = new SqlCommand(@"INSERT INTO Nexus.PartStocks (StockID, PartID, Quantity, BoxQuantity, MaxQuantity, MinQuantity, Remark, IsShow)
                                                              VALUES (@s, @p, @qty, @box, @max, @min, @rmk, @show)", conn, trans))
                            {
                                cmd.Parameters.AddWithValue("@s", stkId);
                                cmd.Parameters.AddWithValue("@p", ptId);
                                cmd.Parameters.AddWithValue("@show", r.ShowInStock ? 1 : 0);
                                cmd.Parameters.Add(Nexus.Helpers.QtyParam.Of("@qty", pcs));
                                cmd.Parameters.AddWithValue("@box", box);
                                cmd.Parameters.Add(Nexus.Helpers.QtyParam.Of("@max", r.Max.HasValue ? Rnd(r.Max.Value, dec) : (decimal?)null));
                                cmd.Parameters.Add(Nexus.Helpers.QtyParam.Of("@min", r.Min.HasValue ? Rnd(r.Min.Value, dec) : (decimal?)null));
                                cmd.Parameters.AddWithValue("@rmk", (object)r.Remark ?? DBNull.Value);
                                cmd.ExecuteNonQuery();
                            }
                        }

                        // ➕ ช่องกรอกเพิ่มเองของคลัง
                        foreach (var cv in r.Custom.Where(c => c.Value.Length > 0))
                            using (var cmd = new SqlCommand("INSERT INTO Nexus.PartFieldValues (FieldID, PartID, Value, UpdatedBy) VALUES (@f, @p, @v, @u)", conn, trans))
                            {
                                cmd.Parameters.AddWithValue("@f", cv.Key);
                                cmd.Parameters.AddWithValue("@p", ptId);
                                cmd.Parameters.AddWithValue("@v", cv.Value);
                                cmd.Parameters.AddWithValue("@u", (object)userId ?? DBNull.Value);
                                cmd.ExecuteNonQuery();
                            }

                        // 🧲 Coil ของสินค้านี้ (ทุกแถวที่ใส่ NUMBER COIL) -> ทะเบียน Coil ของคลังที่นับ Coil + นับ STOCK (COIL) ใหม่
                        if (coilRows.TryGetValue(r, out var cl))
                            CoilImportService.RegisterCoils(conn, trans, cl.Select(c => (c.CoilNo, c.MotherCoil, c.CoilWeight)), ptId, r.CoilStockId, r.CoilStockIsMain, userId, true);
                    }
                    trans.Commit();
                }
            }
            return valid.Count;
        }
    }
}
