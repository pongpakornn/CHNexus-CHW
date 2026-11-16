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
    // 1 แถวของไฟล์ Import แบบอัพเดทข้อมูล (หน้า Store (Max-Min)) - null / ว่าง = ไม่เปลี่ยนค่านั้น
    public class StoreMasterRow
    {
        public int RowNumber { get; set; }
        public string Code { get; set; }
        public string Name { get; set; }
        public string Supplier { get; set; }
        public string Category { get; set; }
        public int? PackSize { get; set; }
        public string Bin { get; set; }
        public string QrCode { get; set; }
        public string Customer { get; set; }
        public string PartA { get; set; }
        public string PartB { get; set; }
        public string PartNo { get; set; }
        public string Model { get; set; }
        public string Remark { get; set; }
        public string Image { get; set; }   // IMAGE = ชื่อไฟล์รูป (ว่าง = ไม่เปลี่ยน)
        // 🧲 แถว Coil: 1 แถว = 1 Coil (น้ำหนัก = STOCK (UNIT) ของแถว) / สินค้าเดียวกันหลาย Coil = PRODUCT CODE ซ้ำหลายแถว
        public string CoilNo { get; set; }
        public string MotherCoil { get; set; }
        public decimal CoilWeight { get; set; }
        public bool IsCoilExtra { get; set; }
        public StoreMasterRow CoilOwner { get; set; }
        public StockModel CoilStock { get; set; }
        public StoreMasterRow ContOwner { get; set; }   // แถว Coil ที่เว้น PRODUCT CODE ไว้ = ของสินค้าแถวบน
        public decimal? Qty { get; set; }
        public int? Box { get; set; }
        public int? Coil { get; set; }   // QTY (COIL) - คลังที่นับ Coil
        public decimal? Max { get; set; }   // ทศนิยมได้ - บันทึกตาม DECIMAL QTY ของแต่ละคลัง
        public decimal? Min { get; set; }
        public bool? ShowInMain { get; set; }
        public List<StockModel> Stocks { get; } = new List<StockModel>();   // คลังที่ระบุในไฟล์ (ว่าง = คลังของหน้านี้)
        public bool IsNew { get; set; }
        public int PtId { get; set; }
        public string Error { get; set; }
        public bool IsValid => string.IsNullOrEmpty(Error);
        public bool HasStockValues => Qty.HasValue || Box.HasValue || Coil.HasValue || Max.HasValue || Min.HasValue || Remark != null;
    }

    public class StoreMasterResult
    {
        public int Added { get; set; }
        public int Updated { get; set; }
        public int StockRows { get; set; }
        public int Coils { get; set; }
    }

    // 📥 IMPORT EXCEL (หน้า Store (Max-Min)) แบบอัพเดทข้อมูลทั้งแถวตามหัวคอลัมน์ - หัวตารางเหมือน Template ของ Inventory Registration
    //   + QTY / STOCK (BOX) / MAX / MIN / REMARK ของคลัง - ยอดคงคลัง = ตัวเลขในไฟล์ (ตั้งค่าใหม่ ไม่ใช่บวกเพิ่ม)
    //   คลัง: STOCK / STOCK1-10 (รหัสคลัง) - ไม่ระบุ = คลังของหน้าที่กด Import
    //   รหัสสินค้าที่มีอยู่แล้ว = อัพเดท (ช่องว่างไม่เปลี่ยน) / ยังไม่มี = ลงทะเบียนใหม่ (ต้องมี PRODUCT NAME)
    public class StoreMasterImportService
    {
        private readonly string _cs = GlobalConfig.ConnStr;

        private static readonly Dictionary<string, string[]> Headers = new Dictionary<string, string[]>
        {
            ["CODE"] = new[] { "PRODUCTCODE", "PDCODE", "PARTCODE", "CODE", "PTCODE", "ITEMCODE", "รหัสสินค้า" },
            ["NAME"] = new[] { "PRODUCTNAME", "PARTNAME", "NAME", "DESCRIPTION", "PTDESC", "ชื่อสินค้า" },
            ["SUPPLIER"] = new[] { "SUPPLIER", "SUPPLIERCODE", "ผู้ขาย" },
            ["CATEGORY"] = new[] { "CATEGORY", "CAT", "ประเภท", "กลุ่ม" },
            ["PACKSIZE"] = new[] { "PACKSIZE", "PSZ", "PACK" },
            ["BIN"] = new[] { "BIN", "LOCATION", "LOC" },
            ["QRCODE"] = new[] { "QRCODE", "QR" },
            ["CUSTOMER"] = new[] { "CUSTOMER", "CUST", "CUSTOMERCODE", "ลูกค้า" },
            ["PARTA"] = new[] { "PARTA", "PARTACODE" },
            ["PARTB"] = new[] { "PARTB", "PARTBCODE" },
            ["PARTNO"] = new[] { "PARTNO", "PARTNUMBER" },
            ["MODEL"] = new[] { "MODEL", "MODELCODE", "โมเดล" },
            ["SHOWHIDE"] = new[] { "SHOW/HIDE", "SHOWHIDE", "SHOW", "HIDE", "แสดง/ซ่อน" },
            ["REMARK"] = new[] { "REMARK", "REMARKS", "หมายเหตุ" },
            ["QTY"] = new[] { "QTY", "QUANTITY", "QTYKG", "QTYPCS", "QTYSHEET", "QTYBOX", "STOCKQTY", "STOCKKG", "STOCKKGS", "STOCKSHEET", "STOCKUNIT", "BALANCE", "จำนวน", "ยอด" },
            ["PCS"] = new[] { "STOCKPCS" },   // STOCK (PCS) = ตัวเลขเดียวกับ QTY ของคลังที่นับเป็นชิ้น
            ["IMAGE"] = new[] { "IMAGE", "IMAGEFILE", "IMAGEFILENAME", "PICTURE", "รูป", "รูปภาพ" },
            ["COILNO"] = new[] { "COILNO", "COILNUMBER", "NUMBERCOIL", "NOCOIL", "เลขCOIL" },
            ["MOTHERCOIL"] = new[] { "MASTERCOIL", "MASTER", "COILMASTER", "MOTHERCOIL", "MOTHER", "COILMOTHER", "COILแม่" },
            ["BOX"] = new[] { "STOCKBOX" },
            ["COIL"] = new[] { "QTYCOIL", "COIL", "COILS", "STOCKCOIL", "COILQTY" },   // QTY (COIL) ของคลังที่นับ Coil
            ["MAX"] = new[] { "MAX", "QTYMAX", "MAXKG", "MAXPCS", "MAXBOX", "MAXSHEET", "MAXUNIT" },
            ["MIN"] = new[] { "MIN", "QTYMIN", "MINKG", "MINPCS", "MINBOX", "MINSHEET", "MINUNIT" },
            ["STOCK"] = new[] { "STOCK", "STOCKCODE", "คลัง" },
            ["STOCK1"] = new[] { "STOCK1" }, ["STOCK2"] = new[] { "STOCK2" }, ["STOCK3"] = new[] { "STOCK3" }, ["STOCK4"] = new[] { "STOCK4" },
            ["STOCK5"] = new[] { "STOCK5" }, ["STOCK6"] = new[] { "STOCK6" }, ["STOCK7"] = new[] { "STOCK7" }, ["STOCK8"] = new[] { "STOCK8" },
            ["STOCK9"] = new[] { "STOCK9" }, ["STOCK10"] = new[] { "STOCK10" }
        };

        // 📄 TEMPLATE MAX-MIN ของหน้า Store (Max-Min): ข้อมูลปัจจุบันของคลัง (ตามที่กรองได้ทั้งคลัง) ใส่ไว้ให้แล้ว
        //    แก้ MAX / MIN / ยอด / SHOW-HIDE แล้ว IMPORT กลับได้ทันที (ตัวอ่านไฟล์เดิมของ IMPORT EXCEL แบบอัพเดทข้อมูล)
        //    ชีท: MAX-MIN (ชีทแรก = ตัวที่ Import อ่าน) · HOW TO · PRODUCT CODE (รายการสินค้าของคลังสำหรับอ้างอิง)
        //    คลังที่นับ Coil: 1 แถว = 1 Coil (STOCK (COIL) = 1 · STOCK (KG.) = น้ำหนักของ Coil นั้น) · สินค้าที่ยังไม่มี Coil ในทะเบียน = 1 แถว ยอดรวม
        public string WriteTemplate(StockModel stock, IList<StoreProductModel> products, List<StockModel> stocks)
        {
            string path = ImportTemplateService.NewPath(ImportTemplateService.Systems.Store, $"{stock.Code}_Template_Max-Min");
            var coils = stock.CountCoil && Nexus.Helpers.DbSchema.HasCoilRegister
                ? new CoilService().GetCoils(stock.StkId, 0).ToLookup(c => c.PartId) : null;
            var heads = ImportTemplateService.MaxMinHeadsFor(stock);
            string grp = stock.GroupByCustomer ? "CUSTOMER" : stock.GroupBySupplier ? "SUPPLIER" : "CATEGORY";
            using (var wb = new XLWorkbook())
            {
                var ws = wb.AddWorksheet("MAX-MIN");
                ImportTemplateService.Header(ws, heads, heads.Select(h => h == "NO" ? 6.4 : h == "PRODUCT NAME" ? 40 : h == "PRODUCT CODE" || h.Contains("COIL") && !h.StartsWith("STOCK") && !h.StartsWith("M") ? 20 : h == "SHOW/HIDE" ? 11 : 14).ToArray());
                int Col(string h) => Array.IndexOf(heads, h) + 1;
                string D(string v) => v == "-" ? "" : v ?? "";
                int r = 2;
                foreach (var p in products)
                {
                    var list = coils != null ? coils[p.PartId].ToList() : new List<CoilRowModel>();
                    void Set(string h, object v) { int c = Col(h); if (c > 0 && v != null && !(v is string t && t.Length == 0)) ws.Cell(r, c).Value = XLCellValue.FromObject(v); }
                    object Num(string v) => Nexus.Helpers.Qty.TryParse(D(v), out decimal d) ? (object)d : D(v);
                    string bin = D(p.Bin) == "N/A" ? "" : p.Bin;
                    Set("NO", r - 1);
                    Set("PRODUCT CODE", p.PartCode); Set("PRODUCT NAME", p.PartName); Set("CUSTOMER", p.Customer);
                    Set("PART A", p.PartA); Set("PART B", p.PartB); Set("PART NO", p.PartNo); Set("MODEL", p.Model);
                    Set("PACK SIZE", Num(p.PackSize)); Set("SUPPLIER", p.Supplier); Set("CATEGORY", p.Category);
                    if (stock.UseMaxMin) { Set(stock.MaxHeader, Num(p.Max)); Set(stock.MinHeader, Num(p.Min)); }
                    if (list.Count > 0) { Set("STOCK (COIL)", 1); Set(stock.QtyHeader, list[0].WeightKG); Set("MASTER COIL", list[0].MotherCoil); Set("NUMBER COIL", list[0].CoilNo); }
                    else
                    {
                        Set(stock.QtyHeader, Num(p.Qty));
                        if (stock.CountCoil) Set("STOCK (COIL)", Num(p.StockBox));
                        else { Set("STOCK (BOX)", Num(p.StockBox)); Set("STOCK (PCS)", Num(p.StockPcs)); }
                    }
                    Set("BIN", bin);
                    Set("SHOW/HIDE", p.IsShow ? 1 : 0);
                    r++;
                    foreach (var c in list.Skip(1))   // Coil ถัดไปของสินค้าเดียวกัน = แถวละ 1 Coil (PRODUCT CODE ซ้ำ)
                    {
                        Set("NO", r - 1); Set("PRODUCT CODE", p.PartCode); Set("PRODUCT NAME", p.PartName);
                        Set("STOCK (COIL)", 1); Set(stock.QtyHeader, c.WeightKG); Set("BIN", bin);
                        Set("MASTER COIL", c.MotherCoil); Set("NUMBER COIL", c.CoilNo);
                        r++;
                    }
                }
                int last = Math.Max(r - 1, 2) + 20;   // แถวว่างไว้เพิ่มสินค้า / Coil ใหม่
                ImportTemplateService.Body(ws, last, heads.Length);
                foreach (var h in new[] { "PRODUCT CODE", "BIN", "NUMBER COIL", "MASTER COIL", "PART A", "PART B", "PART NO" })
                {
                    int c = Col(h);
                    if (c > 0) ws.Range(2, c, last, c).Style.NumberFormat.Format = "@";
                }
                ImportTemplateService.LeftAlign(ws, last, new[] { Col("PRODUCT NAME") }.Where(c => c > 0).ToArray());
                int q = Col(stock.QtyHeader);
                if (q > 0) ws.Range(2, q, last, q).Style.NumberFormat.Format = stock.CountCoil ? "#,##0.###" : ImportTemplateService.QtyFormat(stock.AllowDecimal);
                // ช่องที่มักแก้ (MAX / MIN / ยอด / SHOW/HIDE) = พื้นเหลืองอ่อน
                foreach (var h in new[] { stock.MaxHeader, stock.MinHeader, "STOCK (COIL)", stock.QtyHeader, "STOCK (BOX)", "STOCK (PCS)", "SHOW/HIDE" })
                {
                    int c = Col(h);
                    if (c > 0) ws.Range(2, c, last, c).Style.Fill.BackgroundColor = XLColor.FromHtml("#FFF2CC");
                }
                ws.SheetView.Freeze(1, Math.Max(1, Col("PRODUCT NAME")));

                var how = new List<(string, string)>
                {
                    ("ไฟล์นี้คืออะไร", $"ข้อมูลปัจจุบันของคลัง {stock.Code} ในหน้า Store (Max-Min) ใส่ไว้ให้แล้ว · แก้ตัวเลขแล้วกด IMPORT (MAX-MIN / COIL) ในหน้าเดียวกัน"),
                    ("PRODUCT CODE *", "รหัสสินค้า (บังคับ) · มีในระบบแล้ว = อัพเดท · ยังไม่มี = ลงทะเบียนใหม่ (ต้องมี PRODUCT NAME) · ดูรายการที่ชีท PRODUCT CODE"),
                    ("PRODUCT NAME", "ชื่อสินค้า · ว่าง = ไม่เปลี่ยน"),
                };
                if (stock.UseMaxMin) how.Add(($"{stock.MaxHeader} / {stock.MinHeader}", "ค่า MAX / MIN ของคลังนี้ · ว่าง = ไม่เปลี่ยน" + (stock.AllowDecimal ? " · ทศนิยมได้" : "")));
                if (stock.CountCoil)
                {
                    how.Add(("STOCK (COIL)", "จำนวน Coil · แถวที่มี NUMBER COIL = 1 Coil ต่อแถว (ใส่ 1 หรือว่าง) · สินค้าที่ยังไม่มี Coil ในทะเบียน = จำนวน Coil รวม"));
                    how.Add((stock.QtyHeader, "แถวที่มี NUMBER COIL = น้ำหนักของ Coil นั้น · ยอดรวมของสินค้า = น้ำหนักรวมของ Coil ที่อยู่ในคลัง (ระบบคำนวณให้)"));
                    how.Add(("MASTER COIL", "Master Coil ที่ Coil นี้ตัดมา (ไม่บังคับ)"));
                    how.Add(("NUMBER COIL", "เลข Coil ตามป้าย · 1 แถว = 1 Coil · ห้ามซ้ำ · สินค้าหลาย Coil = ใส่ PRODUCT CODE ซ้ำหลายแถว"));
                }
                else how.Add((stock.QtyHeader, "ยอดคงคลัง = ตั้งตามไฟล์ (ไม่ใช่บวกเพิ่ม) · ว่าง = ไม่เปลี่ยน"));
                how.Add((grp, $"กลุ่มที่ใช้แบ่งตารางของ {stock.Code} · ว่าง = ไม่เปลี่ยน"));
                how.Add(("BIN", "ตำแหน่งเก็บ · ว่าง = ไม่เปลี่ยน"));
                how.Add(("SHOW/HIDE", "1 หรือ SHOW = แสดงในหน้านี้ · 0 หรือ HIDE = ไม่แสดง · ไฟล์นี้มีเฉพาะสินค้าที่แสดงอยู่ตอนนี้ (= 1) · สินค้าที่ซ่อนอยู่ให้กลับมาแสดง: เพิ่มแถว PRODUCT CODE + PRODUCT NAME แล้วใส่ 1"));
                how.Add(("ช่องสีเหลือง", "ช่องที่มักแก้ (MAX / MIN / ยอด / SHOW/HIDE) · ช่องอื่นแก้ได้เหมือนกัน"));
                how.Add(("", "หน้าจอแสดงสรุปให้ยืนยันก่อนบันทึกทุกครั้ง · ทุกการ Import เก็บลง Activity Log"));
                ImportTemplateService.Guide(wb, $"CHR-Nexus - CIMS › Store (Max-Min) › {stock.Code} • TEMPLATE MAX-MIN", how);

                var pc = wb.AddWorksheet("PRODUCT CODE");
                string[] ph = { "NO", "PRODUCT CODE", "PRODUCT NAME", grp, "BIN" };
                ImportTemplateService.Header(pc, ph, new double[] { 6.4, 22, 50, 22, 14 });
                int pr = 2;
                foreach (var p in products)
                {
                    pc.Cell(pr, 1).Value = pr - 1; pc.Cell(pr, 2).Value = p.PartCode; pc.Cell(pr, 3).Value = p.PartName ?? "";
                    pc.Cell(pr, 4).Value = (grp == "CUSTOMER" ? p.Customer : grp == "SUPPLIER" ? p.Supplier : p.Category) ?? "";
                    pc.Cell(pr, 5).Value = D(p.Bin) == "N/A" ? "" : p.Bin ?? "";
                    pr++;
                }
                ImportTemplateService.Body(pc, Math.Max(2, pr - 1), ph.Length);
                ImportTemplateService.LeftAlign(pc, Math.Max(2, pr - 1), 2, 3, 4);
                ws.SetTabActive();
                wb.SaveAs(path);
            }
            return path;
        }

        private static string Norm(string h) =>
            new string((h ?? "").Where(c => !char.IsWhiteSpace(c) && c != '.' && c != '(' && c != ')' && c != '_' && c != '-').ToArray()).ToUpperInvariant();

        // ไฟล์แบบนี้ไหม: มีหัว PRODUCT CODE + PRODUCT NAME (ไฟล์รับเข้าแบบเดิมมีแค่ PD CODE + QTY)
        public static bool IsMasterFile(string path)
        {
            using (var wb = Open(path)) return FindHeader(wb.Worksheet(1), out _) > 0;
        }

        private static XLWorkbook Open(string path)
        {
            if (!File.Exists(path)) throw new FileNotFoundException("ไม่พบไฟล์ที่เลือก", path);
            var ms = new MemoryStream();
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)) fs.CopyTo(ms);
            ms.Position = 0;
            return new XLWorkbook(ms);
        }

        private static int FindHeader(IXLWorksheet ws, out Dictionary<string, int> cols)
        {
            cols = new Dictionary<string, int>();
            foreach (var row in ws.RowsUsed().Take(10))
            {
                cols.Clear();
                foreach (var cell in row.CellsUsed())
                {
                    string h = Norm(cell.GetString());
                    bool hit = false;
                    foreach (var kv in Headers)
                        if (!cols.ContainsKey(kv.Key) && kv.Value.Contains(h)) { cols[kv.Key] = cell.Address.ColumnNumber; hit = true; break; }
                    // หัวคอลัมน์ที่มีหน่วยต่อท้าย เช่น MAX (COIL) / STOCK (SHEET.) (แบบเดียวกับ Import หน้า Inventory Registration)
                    if (!hit && !Headers.Values.Any(v => v.Contains(h)))
                    {
                        string key = PartImportService.MatchUnitHeader(h);
                        if (key == "STOCKBOX") key = "BOX";
                        if (key != null && !cols.ContainsKey(key)) cols[key] = cell.Address.ColumnNumber;
                    }
                }
                if (cols.ContainsKey("CODE") && cols.ContainsKey("NAME")) return row.RowNumber();
            }
            return 0;
        }

        private static bool TryDec(string s, out decimal v) =>
            decimal.TryParse((s ?? "").Replace(",", ""), NumberStyles.Number, CultureInfo.InvariantCulture, out v);

        public List<StoreMasterRow> Read(string path, StockModel pageStock, List<StockModel> stocks)
        {
            var rows = new List<StoreMasterRow>();
            using (var wb = Open(path))
            {
                var ws = wb.Worksheet(1);
                int header = FindHeader(ws, out var cols);
                if (header == 0) throw new InvalidDataException("ไม่พบหัวคอลัมน์ PRODUCT CODE / PRODUCT NAME ในไฟล์");

                string Get(int r, string k) => cols.TryGetValue(k, out int c) ? ws.Cell(r, c).GetString().Trim() : "";
                string Opt(int r, string k) { string v = Get(r, k); return v.Length == 0 ? null : v; }
                int last = ws.LastRowUsed()?.RowNumber() ?? header;
                StoreMasterRow lastProduct = null;

                for (int r = header + 1; r <= last; r++)
                {
                    var x = new StoreMasterRow
                    {
                        RowNumber = r, Code = Get(r, "CODE"), Name = Opt(r, "NAME"),
                        Supplier = Opt(r, "SUPPLIER"), Category = Opt(r, "CATEGORY"), Bin = Opt(r, "BIN"), QrCode = Opt(r, "QRCODE"),
                        Customer = Opt(r, "CUSTOMER"), PartA = Opt(r, "PARTA"), PartB = Opt(r, "PARTB"), PartNo = Opt(r, "PARTNO"), Model = Opt(r, "MODEL"),
                        Image = Opt(r, "IMAGE") == "-" ? null : Opt(r, "IMAGE"),
                        CoilNo = Opt(r, "COILNO") is string cn && cn != "-" ? cn.ToUpperInvariant() : null,
                        MotherCoil = Opt(r, "MOTHERCOIL") is string mc && mc != "-" ? mc.ToUpperInvariant() : null,
                        Remark = cols.ContainsKey("REMARK") ? Get(r, "REMARK") : null
                    };
                    // แถว Coil ใต้แถวสินค้า (PRODUCT CODE / NAME ว่าง แต่มี NUMBER COIL) = Coil เพิ่มของสินค้าแถวบน
                    if (x.Code.Length == 0 && x.Name == null && x.CoilNo != null)
                    {
                        if (lastProduct == null) { x.Error = $"NUMBER COIL {x.CoilNo}: ไม่มีแถวสินค้าด้านบน (ใส่ PRODUCT CODE ที่แถวแรกของสินค้า)"; rows.Add(x); continue; }
                        x.ContOwner = lastProduct; x.Code = lastProduct.Code; x.Name = lastProduct.Name; x.PartA = lastProduct.PartA;
                    }
                    // PRODUCT CODE นำเข้าตามไฟล์ (ไม่เอาช่องอื่นมาใส่แทน) - ไม่มีรหัสให้ใส่ "-" ในไฟล์
                    if (x.Code.Length == 0 && x.Name == null) continue;
                    if (x.ContOwner == null) lastProduct = x;
                    if (x.Code.Length == 0) { x.Error = "ไม่มี PRODUCT CODE (ถ้าไม่มีรหัสให้ใส่ - )"; rows.Add(x); continue; }

                    void Num(string key, string label, Action<decimal> set, bool whole)
                    {
                        string s = Get(r, key);
                        if (s.Length == 0 || x.Error != null) return;
                        if (!TryDec(s, out decimal v) || v < 0 || (whole && v != Math.Floor(v))) x.Error = s.Any(char.IsDigit) ? $"{label} ไม่ถูกต้อง ({s})" : $"{label} ต้องเป็นตัวเลข ไม่ใช่ชื่อหน่วย ({s}) - ใส่ยอด / น้ำหนักเป็นตัวเลข";
                        else set(v);
                    }
                    Num("PACKSIZE", "PACKSIZE", v => x.PackSize = (int)v, true);
                    Num("QTY", "STOCK (UNIT)", v => x.Qty = v, false);
                    decimal? pcs = null;
                    Num("PCS", "STOCK (PCS)", v => pcs = v, false);
                    if (x.Error == null && pcs.HasValue)
                    {
                        if (x.Qty.HasValue && x.Qty.Value != pcs.Value) x.Error = $"STOCK (UNIT) ({x.Qty}) ไม่ตรงกับ STOCK (PCS) ({pcs}) - ใส่อย่างใดอย่างหนึ่ง";
                        else x.Qty = pcs;
                    }
                    Num("BOX", "STOCK (BOX)", v => x.Box = (int)v, true);
                    Num("COIL", "STOCK (COIL)", v => x.Coil = (int)v, true);
                    Num("MAX", "MAX", v => x.Max = v, false);
                    Num("MIN", "MIN", v => x.Min = v, false);
                    if (x.Error == null && x.Max.HasValue && x.Min.HasValue && x.Min > x.Max && x.Max > 0) x.Error = $"MIN {x.Min} มากกว่า MAX {x.Max}";
                    // แถว Coil: น้ำหนักของ Coil = STOCK (UNIT) ของแถว / 1 แถว = 1 Coil
                    if (x.Error == null && x.CoilNo != null)
                    {
                        if (!x.Qty.HasValue || x.Qty.Value <= 0) x.Error = $"NUMBER COIL {x.CoilNo}: ใส่น้ำหนักของ Coil นี้ที่ STOCK (UNIT)";
                        else if (x.Coil.HasValue && x.Coil.Value != 1) x.Error = $"NUMBER COIL {x.CoilNo}: 1 แถว = 1 Coil (STOCK (COIL) ว่าง หรือ 1)";
                        else x.CoilWeight = x.Qty.Value;
                    }
                    else if (x.Error == null && x.MotherCoil != null) x.Error = "ใส่ MASTER COIL แล้วต้องใส่ NUMBER COIL ด้วย";

                    string sh = (Get(r, "SHOWHIDE") ?? "").ToUpperInvariant();
                    if (sh == "SHOW" || sh == "Y" || sh == "YES" || sh == "1" || sh == "แสดง") x.ShowInMain = true;
                    else if (sh == "HIDE" || sh == "N" || sh == "NO" || sh == "0" || sh == "ซ่อน") x.ShowInMain = false;
                    else if (sh.Length > 0 && x.Error == null) x.Error = $"SHOW/HIDE ไม่ถูกต้อง ({sh})";

                    // คลังที่ระบุ: STOCK1-10 + STOCK (คั่น , ;) - ไม่ระบุ = คลังของหน้านี้
                    var codes = Enumerable.Range(1, 10).Select(n => Get(r, "STOCK" + n))
                        .Concat(Get(r, "STOCK").Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries))
                        .Select(s => s.Trim()).Where(s => s.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                    foreach (var c in codes)
                    {
                        var s = stocks.FirstOrDefault(k => string.Equals(k.Code, c, StringComparison.OrdinalIgnoreCase));
                        if (s == null) { x.Error ??= $"ไม่พบคลัง \"{c}\" ในระบบ"; break; }
                        x.Stocks.Add(s);
                    }
                    if (x.Stocks.Count == 0 && pageStock != null) x.Stocks.Add(pageStock);
                    rows.Add(x);
                }
            }

            // รหัสที่มีอยู่แล้ว = อัพเดท / ยังไม่มี = เพิ่มใหม่ (ต้องมีชื่อ) / รหัสซ้ำในไฟล์ = ใช้แถวแรก
            // สินค้า 1 ตัว = PRODUCT CODE + PART A (PRODUCT CODE ซ้ำได้ถ้า PART A ต่างกัน)
            //   ไฟล์ไม่ได้ใส่ PART A -> หาจาก PRODUCT CODE อย่างเดียว (ถ้าระบบมีรหัสนี้หลายตัว ต้องใส่ PART A)
            //   + PART B (STORE-SUB: PRODUCT CODE '-' ซ้ำกันหลายพันตัว แยกกันด้วย PART B · ไฟล์ไม่มี PART B = หาจาก CODE + PART A ถ้ามีตัวเดียว)
            string K(string code, string partA, string partB = "") => (code ?? "").Trim().ToUpperInvariant() + "|" + (partA ?? "").Trim().ToUpperInvariant() + "|" + (partB ?? "").Trim().ToUpperInvariant();
            var byKey = new Dictionary<string, int>();
            var byKey2 = new Dictionary<string, List<int>>();
            var byCode = new Dictionary<string, List<int>>(StringComparer.OrdinalIgnoreCase);
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand("SELECT PartID, LTRIM(RTRIM(PartCode)), ISNULL(PartA, ''), " + (Nexus.Helpers.DbSchema.HasPartB ? "ISNULL(PartB, '')" : "''") + " FROM Nexus.Parts", conn))
            {
                conn.Open();
                using (var rd = cmd.ExecuteReader())
                    while (rd.Read())
                    {
                        int id = rd.GetInt32(0); string code = rd.GetString(1);
                        byKey[K(code, rd.GetString(2), rd.GetString(3))] = id;
                        string k2 = K(code, rd.GetString(2));
                        if (!byKey2.TryGetValue(k2, out var l2)) byKey2[k2] = l2 = new List<int>();
                        l2.Add(id);
                        if (!byCode.TryGetValue(code, out var l)) byCode[code] = l = new List<int>();
                        l.Add(id);
                    }
            }
            // สินค้าซ้ำในไฟล์: ทั้งสองแถวเป็นแถว Coil = เพิ่ม Coil ให้สินค้าแถวแรก / ไม่ใช่ = ซ้ำ (ข้าม)
            var seen = new Dictionary<string, StoreMasterRow>();
            foreach (var x in rows.Where(v => v.IsValid))
            {
                if (x.ContOwner != null && (!x.ContOwner.IsValid || x.ContOwner.CoilNo == null))
                {
                    x.Error = x.ContOwner.IsValid ? $"แถวสินค้า {x.ContOwner.RowNumber} ต้องใส่ NUMBER COIL ด้วย (สินค้าหลาย Coil)" : $"สินค้าแถว {x.ContOwner.RowNumber} ไม่ผ่าน ({x.ContOwner.Error})";
                    continue;
                }
                if (seen.TryGetValue(K(x.Code, x.PartA, x.PartB), out var owner))
                {
                    if (x.CoilNo != null && owner.CoilNo != null) { x.IsCoilExtra = true; x.CoilOwner = owner; }
                    else x.Error = "ซ้ำกับแถวก่อนหน้าในไฟล์ (PRODUCT CODE + PART A เดียวกัน) - หลาย Coil ให้ใส่ NUMBER COIL ทุกแถว";
                    continue;
                }
                seen[K(x.Code, x.PartA, x.PartB)] = x;
                if (byKey.TryGetValue(K(x.Code, x.PartA, x.PartB), out int id)) x.PtId = id;
                else if (x.PartB == null && byKey2.TryGetValue(K(x.Code, x.PartA), out var ids2))
                {
                    if (ids2.Count == 1) x.PtId = ids2[0];
                    else x.Error = $"PRODUCT CODE {x.Code} + PART A {x.PartA ?? "-"} มีในระบบ {ids2.Count} รายการ กรุณาใส่ PART B ให้ระบุตัวสินค้า";
                }
                else if (x.PartA == null && x.PartB == null && byCode.TryGetValue(x.Code, out var ids))
                {
                    if (ids.Count == 1) x.PtId = ids[0];
                    else x.Error = $"PRODUCT CODE {x.Code} มีในระบบ {ids.Count} รายการ กรุณาใส่ PART A ให้ระบุตัวสินค้า";
                }
                else if (x.Name == null) x.Error = "สินค้าใหม่ต้องมี PRODUCT NAME";
                else x.IsNew = true;
            }

            // คลังที่ Coil เข้า = คลังแรกของสินค้า (แถวแรก) ที่เปิด STOCK (COIL) / Coil ที่อยู่คลังอื่นห้ามทับ / Coil ซ้ำในไฟล์ = ข้าม
            if (rows.Any(v => v.IsValid && v.CoilNo != null))
            {
                Dictionary<string, (int Stock, string StockCode, string Status, int Part)> coils;
                using (var conn = new SqlConnection(_cs)) { conn.Open(); coils = CoilImportService.LoadCoils(conn); }
                var seenCoil = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                foreach (var x in rows.Where(v => v.IsValid && v.CoilNo != null))
                {
                    var target = (x.CoilOwner ?? x).Stocks.FirstOrDefault(s => s.CountCoil);
                    if (!Nexus.Helpers.DbSchema.HasCoilRegister) x.Error = "ฐานข้อมูลยังไม่มีทะเบียน Coil (Update_20261008.sql)";
                    else if (target == null) x.Error = $"NUMBER COIL {x.CoilNo}: คลังของสินค้านี้ไม่ได้นับ Coil (เปิด STOCK (COIL) ที่ EDIT STOCK)";
                    else if (seenCoil.TryGetValue(x.CoilNo, out int at)) x.Error = $"NUMBER COIL {x.CoilNo} ซ้ำกับแถว {at}";
                    else if (coils.TryGetValue(x.CoilNo, out var c) && c.Status == "IN" && c.Stock != target.StkId) x.Error = $"NUMBER COIL {x.CoilNo} อยู่ในคลัง {c.StockCode} แล้ว";
                    else { seenCoil[x.CoilNo] = x.RowNumber; x.CoilStock = target; }
                }
                foreach (var x in rows.Where(v => v.IsValid && v.IsCoilExtra && !v.CoilOwner.IsValid))
                    x.Error = $"สินค้าแถว {x.CoilOwner.RowNumber} ไม่ผ่าน ({x.CoilOwner.Error})";
            }
            return rows;
        }

        // ทั้งไฟล์ใน Transaction เดียว - พังแถวเดียวยกเลิกทั้งหมด
        public StoreMasterResult Apply(List<StoreMasterRow> rows, string userId = null)
        {
            var res = new StoreMasterResult();
            // แถว Coil ของสินค้าเดียวกัน: ยอด KG ของสินค้า = น้ำหนักรวมทุก Coil ในไฟล์ / STOCK (COIL) = นับจากทะเบียน
            var coilRows = rows.Where(r => r.IsValid && r.CoilNo != null).GroupBy(r => r.CoilOwner ?? r).ToDictionary(g => g.Key, g => g.ToList());
            foreach (var kv in coilRows) kv.Key.Qty = kv.Value.Sum(r => r.CoilWeight);
            var valid = rows.Where(r => r.IsValid && !r.IsCoilExtra).ToList();
            if (valid.Count == 0) return res;
            using (var conn = new SqlConnection(_cs))
            {
                conn.Open();
                using (var tr = conn.BeginTransaction())
                {
                    foreach (var x in valid)
                    {
                        bool inMain = x.Stocks.Any(s => s.IsMain);
                        bool hasB = Nexus.Helpers.DbSchema.HasPartB;
                        if (x.IsNew)
                        {
                            using (var cmd = new SqlCommand($@"
                                INSERT INTO Nexus.Parts (PartCode, Description, PackSize, QRCode, MaxQuantity, MinQuantity, Category, Bin, StockQuantity, IsActive, IsShowInMaster,
                                                      ImageFileName, Supplier, Customer, PartA, PartNumber, Model{(hasB ? ", PartB" : "")})
                                VALUES (@code, @name, ISNULL(@psz, 0), ISNULL(@qr, @code), 0, 0, ISNULL(@cat, 'GENERAL'), ISNULL(@bin, 'N/A'), 0, 1, @show,
                                        @img, @sup, @cust, @parta, @partno, @model{(hasB ? ", @partb" : "")});
                                SELECT CAST(SCOPE_IDENTITY() AS INT);", conn, tr))
                            {
                                AddPart(cmd, x);
                                // คลังหลักได้สินค้าเฉพาะเมื่อระบุรหัสคลังหลักในไฟล์ (SHOW/HIDE = แสดง/ซ่อน ในคลังที่ระบุ)
                                cmd.Parameters.AddWithValue("@show", inMain && (x.ShowInMain ?? true) ? 1 : 0);
                                x.PtId = (int)cmd.ExecuteScalar();
                            }
                            res.Added++;
                        }
                        else
                        {
                            using (var cmd = new SqlCommand($@"
                                UPDATE Nexus.Parts SET Description = ISNULL(@name, Description), PackSize = ISNULL(@psz, PackSize), QRCode = ISNULL(@qr, QRCode),
                                       Category = ISNULL(@cat, Category), Bin = ISNULL(@bin, Bin), Supplier = ISNULL(@sup, Supplier),
                                       Customer = ISNULL(@cust, Customer), PartA = ISNULL(@parta, PartA), PartNumber = ISNULL(@partno, PartNumber),
                                       Model = ISNULL(@model, Model), ImageFileName = ISNULL(@img, ImageFileName), IsActive = 1,{(hasB ? " PartB = ISNULL(@partb, PartB)," : "")}
                                       IsShowInMaster = CASE WHEN @inMain = 1 THEN ISNULL(@show, 1) ELSE IsShowInMaster END
                                WHERE PartID = @id", conn, tr))
                            {
                                AddPart(cmd, x);
                                cmd.Parameters.AddWithValue("@show", x.ShowInMain.HasValue ? (object)(x.ShowInMain.Value ? 1 : 0) : DBNull.Value);
                                cmd.Parameters.AddWithValue("@inMain", inMain ? 1 : 0);
                                cmd.Parameters.AddWithValue("@id", x.PtId);
                                cmd.ExecuteNonQuery();
                            }
                            res.Updated++;
                        }

                        // ยอด / MAX / MIN / REMARK ของทุกคลังที่ระบุ (ไม่มีแถวในคลังนั้น = เพิ่มเข้าคลัง)
                        foreach (var s in x.Stocks)
                        {
                            // คลังที่นับ Coil: QTY (COIL) = คลังหลักเก็บที่ Parts.CoilQuantity / คลังอื่นเก็บในช่องกล่อง (ไม่คำนวณจาก Pack Size)
                            bool coil = s.CountCoil && Nexus.Helpers.DbSchema.HasCountCoil;
                            string sql = s.IsMain
                                ? @"UPDATE Nexus.Parts SET StockQuantity = ISNULL(@qty, StockQuantity), MaxQuantity = ISNULL(@max, MaxQuantity), MinQuantity = ISNULL(@min, MinQuantity),
                                           Remark = ISNULL(@rmk, Remark)" + (coil ? ", CoilQuantity = ISNULL(@coil, CoilQuantity)" : "") + " WHERE PartID = @p"
                                : @"IF NOT EXISTS (SELECT 1 FROM Nexus.PartStocks WHERE StockID = @s AND PartID = @p)
                                        INSERT INTO Nexus.PartStocks (StockID, PartID, Quantity) VALUES (@s, @p, 0);
                                    UPDATE Nexus.PartStocks SET MaxQuantity = ISNULL(@max, MaxQuantity), MinQuantity = ISNULL(@min, MinQuantity),
                                           Remark = ISNULL(@rmk, Remark), IsShow = ISNULL(@show, IsShow), UpdatedDate = GETDATE() WHERE StockID = @s AND PartID = @p;
                                    -- ยอด: ใส่ QTY อย่างเดียว = กล่องคำนวณตาม Pack Size / ใส่ STOCK (BOX) อย่างเดียว = ชิ้นคำนวณให้ / ใส่ทั้งคู่ = ตามไฟล์
                                    IF @qty IS NOT NULL AND @box IS NOT NULL UPDATE Nexus.PartStocks SET Quantity = @qty, BoxQuantity = @box WHERE StockID = @s AND PartID = @p;
                                    ELSE IF @qty IS NOT NULL UPDATE Nexus.PartStocks SET Quantity = @qty WHERE StockID = @s AND PartID = @p;
                                    ELSE IF @box IS NOT NULL UPDATE Nexus.PartStocks SET BoxQuantity = @box WHERE StockID = @s AND PartID = @p;";
                            using (var cmd = new SqlCommand(sql, conn, tr))
                            {
                                cmd.Parameters.AddWithValue("@s", s.StkId);
                                cmd.Parameters.AddWithValue("@p", x.PtId);
                                // คลังที่เปิด DECIMAL QTY เก็บทศนิยม (3 ตำแหน่ง) / คลังอื่นปัดเป็นจำนวนเต็มเหมือนเดิม
                                decimal? Rnd(decimal? v) => v.HasValue ? Nexus.Helpers.Qty.Round(v.Value, s.AllowDecimal) : (decimal?)null;
                                cmd.Parameters.Add(Nexus.Helpers.QtyParam.Of("@qty", Rnd(x.Qty)));
                                cmd.Parameters.AddWithValue("@box", (object)(coil ? x.Coil : x.Box) ?? DBNull.Value);
                                cmd.Parameters.AddWithValue("@coil", (object)x.Coil ?? DBNull.Value);
                                cmd.Parameters.Add(Nexus.Helpers.QtyParam.Of("@max", Rnd(x.Max)));
                                cmd.Parameters.Add(Nexus.Helpers.QtyParam.Of("@min", Rnd(x.Min)));
                                cmd.Parameters.AddWithValue("@rmk", string.IsNullOrEmpty(x.Remark) ? DBNull.Value : (object)x.Remark);
                                cmd.Parameters.AddWithValue("@show", x.ShowInMain.HasValue ? (object)(x.ShowInMain.Value ? 1 : 0) : DBNull.Value);
                                cmd.ExecuteNonQuery();
                            }
                            res.StockRows++;
                        }

                        // 🧲 Coil ของสินค้านี้ -> ทะเบียน Coil ของคลังที่นับ Coil + นับ STOCK (COIL) ใหม่
                        if (coilRows.TryGetValue(x, out var cl))
                        {
                            CoilImportService.RegisterCoils(tr.Connection, tr, cl.Select(c => (c.CoilNo, c.MotherCoil, c.CoilWeight)), x.PtId, x.CoilStock.StkId, x.CoilStock.IsMain, userId, true);
                            res.Coils += cl.Count;
                        }
                    }
                    tr.Commit();
                }
            }
            return res;
        }

        private static void AddPart(SqlCommand cmd, StoreMasterRow x)
        {
            object V(string s) => string.IsNullOrWhiteSpace(s) ? DBNull.Value : (object)s.Trim();
            cmd.Parameters.AddWithValue("@code", x.Code);
            cmd.Parameters.AddWithValue("@name", V(x.Name));
            cmd.Parameters.AddWithValue("@psz", (object)x.PackSize ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@qr", V(x.QrCode));
            cmd.Parameters.AddWithValue("@cat", V(x.Category));
            cmd.Parameters.AddWithValue("@bin", V(x.Bin));
            cmd.Parameters.AddWithValue("@sup", V(x.Supplier));
            cmd.Parameters.AddWithValue("@cust", V(x.Customer));
            cmd.Parameters.AddWithValue("@parta", V(x.PartA));
            cmd.Parameters.AddWithValue("@partb", V(x.PartB));
            cmd.Parameters.AddWithValue("@partno", V(x.PartNo));
            cmd.Parameters.AddWithValue("@model", V(x.Model));
            cmd.Parameters.AddWithValue("@img", V(x.Image));
        }
    }
}
