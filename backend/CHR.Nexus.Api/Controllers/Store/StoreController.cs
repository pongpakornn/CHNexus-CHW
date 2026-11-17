using CHR.Nexus.Api.Web;
using Nexus.Helpers;
using Nexus.Models;
using Nexus.Services;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Nexus.Api.Controllers;

// 🏬 Store (Max-Min) (SystemID StoreMaxMin + สิทธิ์ของแต่ละคลัง = รหัสคลัง)
//   StockCardsView + StoreMaxMinView + StoreMaxMinViewModel + StockEditorWindow + BarcodeFormatWindow
//   VIEW = เมนู + เข้าดูคลัง / EDIT = แก้รูปแบบบาร์โค้ด + ตั้งค่าคลัง / ADD = เพิ่มรูปแบบ + เพิ่มคลัง / DEL = ลบคลัง
//   ในคลัง: VIEW = เห็น (พิมพ์ REMARK ได้) / EDIT = แก้ MAX / MIN / QTY / STOCK(BOX) / STOCK(PCS) / ADD = IMPORT EXCEL
[Route("api/store")]
public sealed class StoreController : AppController
{
    private readonly UploadCache _uploads;
    public StoreController(UploadCache uploads) => _uploads = uploads;

    private readonly StockService _stocks = new();
    private readonly StoreProductService _products = new();

    private StockModel VisibleStock(int stkId)
    {
        var s = _stocks.GetStock(stkId);
        return s != null && Me.CanViewStock(s) ? s : null;
    }

    // คอลัมน์ที่แสดงจริง (StoreMaxMinView.ApplyColumnSettings): เปิด / ปิดตาม Col* ของคลัง เรียงตาม ColumnOrder
    //   BOX / COIL = ช่องเดียวกัน (STOCK (BOX) / STOCK (COIL)) · MAX / MIN / STATUS ตาม USE MAX-MIN · STATUS อยู่ท้ายสุดเสมอ
    internal static List<string> VisibleColumns(StockModel s, List<CustomFieldDef> cf = null)
    {
        cf ??= new CustomFieldService().GetDefs(s.StkId);
        bool On(string k) => k switch
        {
            "NO" => s.ColNo, "IMAGE" => s.ColImage, "CUSTOMER" => s.ColCustomer, "CODE" => s.ColCode, "PARTA" => s.ColPartA, "PARTB" => s.ColPartB,
            "PARTNO" => s.ColPartNo, "MODEL" => s.ColModel, "NAME" => s.ColName, "MAXMIN" => s.UseMaxMin, "QTY" => s.ColQty,
            "BOX" or "COIL" => s.ShowBoxColumn, "PCS" => s.ColStockPcs, "REMARK" => s.ColRemark,
            "SUPPLIER" or "CATEGORY" or "PACKSIZE" or "BIN" => s.HasColumn(k),
            // ➕ ช่องกรอกเพิ่มเองของคลังนี้ (ติ๊กไว้ใน ADD / EDIT STOCK) - ช่องที่ถูกลบแล้ว = ไม่แสดง
            _ => CustomFields.IsKey(k) && cf.Any(d => d.FieldId == CustomFields.IdOf(k))
        };
        var list = new List<string>();
        foreach (string k in s.ColumnOrderList())
        {
            string key = k == "COIL" ? "BOX" : k;
            if (On(k) && !list.Contains(key)) list.Add(key);
        }
        if (s.UseMaxMin) list.Add("STATUS");
        return list;
    }

    // 🧲 MASTER COIL / NUMBER COIL (จำนวน / KG / TON) ของคลังที่นับ Coil (RefreshCountsAsync) + แยกตามการ์ด MAX / MIN / ยังไม่ตั้ง
    private static object CoilSum(StockModel s, bool split) =>
        !s.CountCoil || !DbSchema.HasCoilRegister ? null : StoreCoils.Get(s.StkId, split);

    private static string AllLabel(StockModel s) => s.GroupByCustomer ? "ALL CUSTOMERS" : s.GroupBySupplier ? "ALL SUPPLIERS" : "ALL CATEGORIES";

    // ---------------------------------------------------------------- การ์ดคลัง
    [HttpGet("stocks")]
    public IActionResult Stocks()
    {
        if (Me?.CanViewStore != true) return Deny();
        var visible = _stocks.GetStocks().Where(s => Me.CanViewStock(s)).ToList();
        var coils = visible.Any(s => s.CountCoil) && DbSchema.HasCoilRegister ? new CoilService().GetSummary() : new();
        var counts = new ProductControlService().GetStockPartCounts(visible);
        return Ok(new
        {
            canCreate = Me.CanCreateStock, canFormats = Me.CanManageFormats, canEdit = Me.CanEditStore, canOrder = Me.IsMasterAdmin || Me.UserLevel == 1,
            stocks = visible.Select(s =>
            {
                var c = s.CountCoil && DbSchema.HasCoilRegister ? (coils.TryGetValue(s.StkId, out var x) ? x : new CoilService.CoilSummary()) : null;
                return new
                {
                    s.StkId, s.Code, s.Name, s.IsMain, s.StockType, unit = s.UnitDisplay, itemCount = counts.TryGetValue(s.StkId, out int n) ? n : s.ItemCount,
                    canDelete = Me.CanDeleteStock(s),
                    coil = c == null ? null : new { c.MasterCount, c.MasterKg, c.ChildCount, c.ChildKg, c.TotalCount, c.TotalKg }
                };
            })
        });
    }

    // ---------------------------------------------------------------- ตั้งค่าคลัง (StockEditorWindow)
    [HttpGet("stocks/{stkId:int}/settings")]
    public IActionResult Settings(int stkId)
    {
        if (Me?.CanEditStore != true) return Deny("คุณไม่มีสิทธิ์แก้ไขคลังนี้");
        var s = _stocks.GetStock(stkId);
        if (s == null) return NotFound();
        var cf = new CustomFieldService().GetDefs(s.StkId);
        // คอลัมน์ที่ติ๊ก (ตามลำดับ) - เฉพาะที่เปิดอยู่จริง (ColumnOrderList ต่อท้ายคอลัมน์ที่ไม่ได้ติ๊กไว้ด้วย) / ช่องกรอกเพิ่มเองที่ถูกลบแล้วไม่ต้องส่ง
        bool Ticked(string k) => k switch
        {
            "NO" => s.ColNo, "IMAGE" => s.ColImage, "CUSTOMER" => s.ColCustomer, "CODE" => s.ColCode, "PARTA" => s.ColPartA, "PARTB" => s.ColPartB,
            "PARTNO" => s.ColPartNo, "MODEL" => s.ColModel, "NAME" => s.ColName, "MAXMIN" => s.UseMaxMin, "QTY" => s.ColQty,
            "BOX" => s.ColStockBox, "COIL" => s.CountCoil, "PCS" => s.ColStockPcs, "REMARK" => s.ColRemark,
            _ => CustomFields.IsKey(k) ? cf.Any(d => d.FieldId == CustomFields.IdOf(k)) : s.HasColumn(k)
        };
        var cols = s.ColumnOrderList().Where(Ticked).ToList();
        return Ok(new { stock = s, columns = cols, coilRowOrder = s.CoilRowOrder(), formats = _stocks.GetFormats().Select(f => new { f.FmtId, f.Name, f.IsActive }),
                        customFields = cf.Select(d => new { key = d.Key, d.Label, type = d.DataType }) });
    }

    [HttpGet("formats/brief")]
    public IActionResult FormatsBrief()
    {
        if (Me?.CanViewStore != true) return Deny();
        return Ok(_stocks.GetFormats().Select(f => new { f.FmtId, f.Name, f.IsActive }));
    }

    private static readonly string[] StockTypes = { "MATERIAL", "PRODUCT", "SPAREPART", "COMPONENT", "CONSUMABLE" };

    private IActionResult ValidateStock(StockModel s, out StockModel clean)
    {
        clean = null;
        string code = (s?.Code ?? "").Trim(), name = (s?.Name ?? "").Trim();
        if (code.Length == 0) return Fail("กรุณากรอกรหัสคลัง (STOCK CODE)");
        if (name.Length == 0) return Fail("กรุณากรอกชื่อคลัง (STOCK NAME)");
        if (code.Length > 30) return Fail("รหัสคลังยาวได้ไม่เกิน 30 ตัวอักษร");
        if (StockModel.ReservedCodes.Contains(code.ToUpperInvariant())) return Fail($"รหัสคลัง \"{code}\" ซ้ำกับชื่อสิทธิ์ของระบบ กรุณาใช้รหัสอื่น");
        var cols = (s.ColumnOrder ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries);
        if (cols.Length == 0) return Fail("กรุณาเลือกคอลัมน์ที่ต้องการแสดงอย่างน้อย 1 คอลัมน์");
        bool usesSupplier = s.InSupplier || s.OutSupplier;
        if (usesSupplier && (s.FormatIds == null || s.FormatIds.Count == 0)) return Fail("เปิดช่องทาง SUPPLIER LABEL แล้ว กรุณาเลือกรูปแบบบาร์โค้ด Supplier อย่างน้อย 1 รูปแบบ");
        if (_stocks.IsStockCodeTaken(code, s.StkId)) return Fail($"รหัสคลัง \"{code}\" มีอยู่ในระบบแล้ว กรุณาใช้รหัสอื่น");
        s.Code = code; s.Name = name;
        s.Unit = s.Unit is "PCS" or "SHEET" ? s.Unit : "KG";
        s.GroupBy = s.GroupBy is "CUSTOMER" or "SUPPLIER" ? s.GroupBy : "CATEGORY";
        if (!new[] { "KG", "PCS", "SHEET", "BOX", "COIL", "UNIT" }.Contains(s.MaxMinBasis)) s.MaxMinBasis = "UNIT";
        if (!usesSupplier) s.FormatIds = new List<int>();
        // ประเภทคลัง (ไอคอนบนเว็บ): คลังใหม่ต้องเลือก · คลังเดิมที่ยังไม่มีค่า = ดูจากรหัสคลังเหมือนเดิม
        s.StockType = StockTypes.Contains(s.StockType ?? "") ? s.StockType : null;
        if (s.StkId == 0 && s.StockType == null && DbSchema.HasStockType) return Fail("กรุณาเลือกประเภทคลัง (STOCK TYPE)");
        // คอลัมน์ที่ติ๊ก = ลำดับที่ติ๊ก (Col* ตาม ColumnOrder)
        var set = new HashSet<string>(cols);
        s.ColNo = set.Contains("NO"); s.ColImage = set.Contains("IMAGE"); s.ColCustomer = set.Contains("CUSTOMER"); s.ColCode = set.Contains("CODE");
        s.ColPartA = set.Contains("PARTA"); s.ColPartB = set.Contains("PARTB"); s.ColPartNo = set.Contains("PARTNO"); s.ColModel = set.Contains("MODEL");
        s.ColName = set.Contains("NAME"); s.UseMaxMin = set.Contains("MAXMIN"); s.ColQty = set.Contains("QTY"); s.ColStockBox = set.Contains("BOX");
        s.CountCoil = set.Contains("COIL"); s.ColStockPcs = set.Contains("PCS"); s.ColRemark = set.Contains("REMARK");
        s.ColumnOrder = string.Join(",", cols);
        clean = s;
        return null;
    }

    [HttpPost("stocks")]
    public IActionResult Create([FromBody] StockModel s)
    {
        if (Me?.CanCreateStock != true) return Deny("คุณไม่มีสิทธิ์สร้างคลังใหม่");
        s.StkId = 0;
        if (ValidateStock(s, out var clean) is { } bad) return bad;
        try
        {
            _stocks.CreateStock(clean, Uid);
            LogService.WriteLog(Uid, "STOCK_CREATE", $"Created stock {clean.Code} ({clean.Name}) | Unit: {clean.Unit}", clean.Code);
            return Ok(new { message = $"สร้างคลัง {clean.Code} สำเร็จ" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกข้อมูลคลังไม่สำเร็จ"); }
    }

    [HttpPut("stocks/{stkId:int}")]
    public IActionResult Update(int stkId, [FromBody] StockModel s)
    {
        if (Me?.CanEditStore != true) return Deny("คุณไม่มีสิทธิ์แก้ไขคลังนี้");
        var original = _stocks.GetStock(stkId);
        if (original == null) return NotFound();
        s.StkId = stkId;
        s.IsMain = original.IsMain;
        s.LiveSource = original.LiveSource;
        if (ValidateStock(s, out var clean) is { } bad) return bad;
        try
        {
            _stocks.UpdateStock(clean, Uid);
            LogService.WriteLog(Uid, "STOCK_UPDATE", $"Updated stock {original.Code} -> {clean.Code} ({clean.Name}) | Unit: {clean.Unit}", clean.Code);
            return Ok(new { message = $"บันทึกการตั้งค่าคลัง {clean.Code} สำเร็จ" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกข้อมูลคลังไม่สำเร็จ"); }
    }

    public sealed record StockOrderRequest(int[] Ids);

    // Stock display order (every stock list / sidebar) - Admin Level 1 only
    [HttpPost("stocks/order")]
    public IActionResult Order([FromBody] StockOrderRequest req)
    {
        if (Me == null || !(Me.IsMasterAdmin || Me.UserLevel == 1)) return Deny("เฉพาะ Admin (Level 1) จัดลำดับคลังได้");
        var all = _stocks.GetStocks();
        var ids = (req?.Ids ?? Array.Empty<int>()).Distinct().ToList();
        if (ids.Count != all.Count || ids.Any(id => all.All(s => s.StkId != id))) return BadRequest(new { message = "รายการคลังไม่ครบ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง" });
        try
        {
            _stocks.SetOrder(ids);
            LogService.WriteLog(Uid, "STOCK_ORDER", "Stock order: " + string.Join(" > ", ids.Select(id => all.First(s => s.StkId == id).Code)), "");
            return Ok(new { message = "บันทึกลำดับคลังแล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกลำดับคลังไม่สำเร็จ"); }
    }

    public sealed record DeleteStockRequest(string Reason);

    [HttpPost("stocks/{stkId:int}/delete")]
    public IActionResult DeleteStock(int stkId, [FromBody] DeleteStockRequest req)
    {
        var s = _stocks.GetStock(stkId);
        if (s == null) return NotFound();
        if (!Me.CanDeleteStock(s)) return Deny("คุณไม่มีสิทธิ์ลบคลังนี้");
        if (string.IsNullOrWhiteSpace(req?.Reason)) return Fail("กรุณาระบุเหตุผลในการลบคลัง");
        try
        {
            _stocks.DeleteStock(stkId, req.Reason.Trim(), Uid);
            LogService.WriteLog(Uid, "STOCK_DELETE", $"Deleted stock {s.Code} ({s.Name}) | Reason: {req.Reason.Trim()}", s.Code);
            return Ok(new { message = $"ลบคลัง {s.Code} เรียบร้อยแล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "ลบคลังไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- ตารางสินค้า
    [HttpGet("{stkId:int}")]
    public IActionResult Stock(int stkId)
    {
        if (Me?.CanViewStore != true) return Deny();
        var s = VisibleStock(stkId);
        if (s == null) return Deny("คุณไม่มีสิทธิ์ดูคลังนี้");
        var cats = _products.GetCategories(s).Skip(1).ToList();
        var counts = _products.GetStatusCounts(s);
        var cf = new CustomFieldService().GetDefs(s.StkId);
        return Ok(new
        {
            stock = s,
            columns = VisibleColumns(s, cf),
            customFields = cf.Select(d => new { key = d.Key, d.Label, type = d.DataType }),
            coilRowOrder = s.CoilRowOrder(),
            coilSum = CoilSum(s, counts != null),
            allLabel = AllLabel(s), groupLabel = s.GroupCode, categories = cats,
            counts = counts == null ? null : new { counts.Value.Total, counts.Value.Max, counts.Value.Min, counts.Value.NoOrder },
            canEdit = !s.IsLiveView && Me.CanEditStock(s),
            canImport = !s.IsLiveView && Me.CanImportStock(s),
            hasCoilRegister = DbSchema.HasCoilRegister,
            coilRemark = DbSchema.HasCoilRegister && DbSchema.HasCoilRemark,
            // 🧲 ปุ่ม MANAGE STOCK (คลังนับ Coil: EDIT + APPROVE ของคลังนี้)
            canManage = DbSchema.HasCoilRegister && Me.CanManageCoils(s)
        });
    }

    private static object Row(StoreProductModel p, Dictionary<string, string> cf = null) => new
    {
        cf,
        p.PartId, p.PartCode, p.PartName, p.Customer, p.PartA, p.PartB, p.PartNo, p.Model, p.Category, p.Supplier, p.Bin, p.GroupKey,
        p.PackSize, p.Max, p.Min, p.Qty, p.StockBox, p.StockPcs, p.Remark, p.StockStatus, p.Priority, p.IsHidden,
        imageUrl = string.IsNullOrWhiteSpace(p.ImageFileName) ? null : $"/api/images/file?name={Uri.EscapeDataString(p.ImageFileName)}"
    };

    [HttpGet("{stkId:int}/products")]
    public IActionResult Products(int stkId, [FromQuery] string key, [FromQuery] string cat, [FromQuery] string filter, [FromQuery] int skip = 0, [FromQuery] int take = 100, [FromQuery] int withHidden = 0)
    {
        if (Me?.CanViewStore != true) return Deny();
        var s = VisibleStock(stkId);
        if (s == null) return Deny("คุณไม่มีสิทธิ์ดูคลังนี้");
        string catFilter = string.IsNullOrEmpty(cat) || cat == AllLabel(s) ? "" : cat;
        var rows = _products.GetProducts(s, key ?? "", catFilter, filter ?? "", Math.Max(0, skip), Math.Clamp(take, 1, 100000), withHidden == 1 && Me.CanManageCoils(s));
        // ➕ ค่าช่องกรอกเพิ่มเองที่เปิดแสดงในตารางคลังนี้
        var cfIds = VisibleColumns(s).Where(CustomFields.IsKey).Select(CustomFields.IdOf).ToList();
        if (cfIds.Count == 0) return Ok(new { token = _products.GetChangeToken(s), rows = rows.Select(p => Row(p)) });
        // คลัง Live View (เช่น STORE-PC ดึงจากระบบ StorePC): รหัสแถวไม่ใช่ PartID ของ CHR-Nexus -> จับคู่สินค้าในทะเบียนของคลังนี้ด้วย PART A / PD CODE
        Func<StoreProductModel, int> nexusId = p => p.PartId;
        if (s.IsLiveView)
        {
            var (byA, byCode) = new CustomFieldService().PartKeysInStock(s.StkId, s.IsMain);
            nexusId = p => !string.IsNullOrWhiteSpace(p.PartA) && byA.TryGetValue(p.PartA.Trim(), out int a) ? a
                         : !string.IsNullOrWhiteSpace(p.PartCode) && p.PartCode.Trim() != "-" && byCode.TryGetValue(p.PartCode.Trim(), out int c) ? c : 0;
        }
        var ids = rows.ToDictionary(p => p, nexusId);
        var vals = new CustomFieldService().GetValues(ids.Values.Where(i => i > 0), cfIds);
        var cfDefs = new CustomFieldService().GetDefs(s.StkId).ToDictionary(d => d.FieldId);   // ตัวเลข + หน่วย
        return Ok(new
        {
            token = _products.GetChangeToken(s),
            rows = rows.Select(p => Row(p, vals.TryGetValue(ids[p], out var v) ? v.ToDictionary(x => CustomFields.KeyOf(x.Key), x => cfDefs.TryGetValue(x.Key, out var d) ? d.Display(x.Value) : x.Value) : null))
        });
    }

    // ⚡ เรียลไทม์: ถาม "เปลี่ยนไหม" ทุก 3 วินาที - เปลี่ยน = ตัวเลขล่าสุดของทั้งคลัง (ยอด / MAX / MIN / REMARK / สถานะ)
    [HttpGet("{stkId:int}/numbers")]
    public IActionResult Numbers(int stkId, [FromQuery] string token)
    {
        if (Me?.CanViewStore != true) return Deny();
        var s = VisibleStock(stkId);
        if (s == null) return Deny();
        string now = _products.GetChangeToken(s);
        if (now != null && now == token) return Ok(new { token = now, changed = false });
        var counts = _products.GetStatusCounts(s);
        return Ok(new
        {
            token = now, changed = true,
            counts = counts == null ? null : new { counts.Value.Total, counts.Value.Max, counts.Value.Min, counts.Value.NoOrder },
            coilSum = CoilSum(s, counts != null),
            rows = _products.GetStockNumbers(s).Select(p => new { p.PartId, p.PartCode, p.Qty, p.Max, p.Min, p.Remark, p.StockStatus, p.StockBox, p.StockPcs })
        });
    }

    // แก้ในตาราง (StoreMaxMinViewModel.ProcessUpdate): REMARK ทุกคนที่เห็นคลัง / ตัวเลข = EDIT ของคลัง
    public sealed class EditRequest
    {
        public string PartCode { get; set; }
        public string Remark { get; set; }
        public string Max { get; set; }
        public string Min { get; set; }
        public string Qty { get; set; }
        public string StockBox { get; set; }
        public string StockPcs { get; set; }
        public EditRequest Original { get; set; }
    }

    [HttpPut("{stkId:int}/products/{partId:int}")]
    public IActionResult Edit(int stkId, int partId, [FromBody] EditRequest p)
    {
        if (partId <= 0) return BadRequest(new { message = "ไม่พบสินค้า" }); // never fall back to PartCode ('-' is shared)
        if (Me?.CanViewStore != true) return Deny();
        var stock = VisibleStock(stkId);
        if (stock == null) return Deny("คุณไม่มีสิทธิ์ดูคลังนี้");
        if (stock.IsLiveView) return Fail(StockModel.LiveViewMessage);
        var o = p.Original ?? new EditRequest();
        if (p.Remark != o.Remark)
            LogService.WriteLog(Uid, "UPDATE_REMARK", $"| Remark: {o.Remark ?? ""} -> {p.Remark ?? ""}", p.PartCode);

        bool canEdit = Me.CanEditStock(stock);
        bool numbersChanged = p.Max != o.Max || p.Min != o.Min || p.Qty != o.Qty || p.StockBox != o.StockBox || p.StockPcs != o.StockPcs;
        if (!canEdit)
        {
            if (numbersChanged) return Deny("คุณไม่มีสิทธิ์แก้ไขข้อมูลในคลังนี้ (แก้ไขได้เฉพาะ REMARK)");
            return _products.UpdateRemark(stock, p.PartCode, p.Remark, partId) ? Ok() : Fail("ไม่สามารถบันทึกข้อมูลได้");
        }
        try
        {
            var changes = new List<string>();
            if (p.Max != o.Max) changes.Add($"MAX: {o.Max}->{p.Max}");
            if (p.Min != o.Min) changes.Add($"MIN: {o.Min}->{p.Min}");
            if (p.Qty != o.Qty) changes.Add($"QTY: {o.Qty}->{p.Qty}");
            bool dec = stock.AllowDecimal, mmDec = stock.MaxMinDecimal;
            decimal Field(string text, string name)
            {
                string t = (text ?? "").Trim();
                if (t.Length == 0 || t == "-") return 0;
                if (!Qty.TryParse(t, out decimal v)) throw new FormatException($"{name} \"{t}\" ไม่ใช่ตัวเลข");
                return Qty.Round(Math.Max(0, v), mmDec);
            }
            void CheckNumber(string text, string original, string name)
            {
                string t = (text ?? "").Trim();
                if (t != (original ?? "").Trim() && t.Length > 0 && t != "-" && !Qty.TryParse(t, out _)) throw new FormatException($"{name} \"{t}\" ไม่ใช่ตัวเลข");
            }
            decimal maxVal = Field(p.Max, "MAX"), minVal = Field(p.Min, "MIN");
            CheckNumber(p.Qty, o.Qty, "QTY");
            CheckNumber(p.StockPcs, o.StockPcs, "STOCK (PCS)");
            CheckNumber(p.StockBox, o.StockBox, stock.BoxHeader);
            decimal? qtyVal = Qty.TryParse(p.Qty, out decimal q) ? q : null;
            int? boxVal = null;
            if (p.StockPcs != o.StockPcs && Qty.TryParse(p.StockPcs, out decimal pcs)) { qtyVal = pcs; changes.Add($"STOCK(PCS): {o.StockPcs}->{p.StockPcs}"); }
            else if (p.StockBox != o.StockBox && Qty.TryParse(p.StockBox, out decimal box))
            { boxVal = (int)Math.Max(0, Math.Round(box)); changes.Add($"{(stock.CountCoil ? "QTY(COIL)" : "STOCK(BOX)")}: {o.StockBox}->{p.StockBox}"); }
            if (qtyVal.HasValue) qtyVal = Qty.Round(Math.Max(0, qtyVal.Value), dec);
            string tag = stock.IsMain ? "" : $"Stock: {stock.Code} | ";
            if (changes.Count > 0) LogService.WriteLog(Uid, "UPDATE_PRODUCT_MASTER", $"| {tag}Changes: {string.Join(", ", changes)}", p.PartCode);
            return _products.UpdateProductMaster(stock, p.PartCode, p.Remark, maxVal, minVal, qtyVal, boxVal, partId) ? Ok() : Fail("ไม่สามารถบันทึกข้อมูลได้");
        }
        catch (Exception ex) { return Fail(ex, "ไม่สามารถบันทึกข้อมูลได้"); }
    }

    public sealed record ShowRequest(bool Show, string PartCode);

    // MANAGE STOCK > HIDE: hide / show one product in this stock (main stock = Parts.IsShowInMaster, others = PartStocks.IsShow)
    [HttpPut("{stkId:int}/products/{partId:int}/show")]
    public IActionResult SetShow(int stkId, int partId, [FromBody] ShowRequest req)
    {
        if (partId <= 0) return BadRequest(new { message = "ไม่พบสินค้า" });
        if (Me?.CanViewStore != true) return Deny();
        var s = VisibleStock(stkId);
        if (s == null) return Deny("คุณไม่มีสิทธิ์ดูคลังนี้");
        if (s.IsLiveView) return Fail(StockModel.LiveViewMessage);
        if (!Me.CanManageCoils(s)) return Deny($"คุณไม่มีสิทธิ์ MANAGE STOCK ของคลัง {s.Code}");
        // PartID decides the row (PartCode is only for the log: '-' is shared by many items)
        if (!new ProductControlService().UpdateShowStatus(req.PartCode ?? "", req.Show, Uid, s.StkId, partId)) return Fail("บันทึกไม่สำเร็จ");
        LogService.WriteLog(Uid, "STORE_SHOW_HIDE", $"| Stock: {s.Code} | {(req.Show ? "SHOW" : "HIDE")} | PartID: {partId}", req.PartCode);
        return Ok(new { message = req.Show ? "แสดงรายการแล้ว" : "ซ่อนรายการแล้ว" });
    }

    // 🧲 แถว Coil ย่อยของสินค้า (คลิก PD CODE) - แถบ Master Coil + Coil ลูก ข้อความตาม CoilRowsView (น้ำหนักทศนิยมตามคลัง)
    private static object CoilRow(CoilRowModel c, StockModel s) => new
    {
        c.CoilId, c.PartId, c.IsMother, no = c.NoText, c.CoilNo,
        motherCoil = string.IsNullOrWhiteSpace(c.MotherCoil) || c.MotherCoil == "-" ? "-" : c.MotherCoil,
        weight = Qty.Text(c.WeightKG, s.AllowDecimal), ton = c.WeightTonText,
        received = c.ReceivedDate?.ToString("dd/MM/yyyy HH:mm", System.Globalization.CultureInfo.InvariantCulture) ?? "-",
        remark = c.IsMother ? null : c.Remark ?? ""
    };

    // Coil ดิบของทั้งคลัง -> จัดกลุ่มต่อ Master Coil แบบ CoilService.GetCoilRows (CoilRowsView.Grouped)
    private static List<CoilRowModel> Grouped(IEnumerable<CoilRowModel> coils)
    {
        var rows = new List<CoilRowModel>();
        foreach (var g in coils.GroupBy(c => string.IsNullOrWhiteSpace(c.MotherCoil) ? c.CoilNo : c.MotherCoil)) // Master ทั้งม้วน = กลุ่มของเลขตัวเอง
        {
            var items = g.ToList();
            rows.Add(new CoilRowModel { IsMother = true, MotherCoil = g.Key, CoilNo = $"{items.Count} COIL", WeightKG = items.Sum(c => c.WeightKG) });
            int no = 1;
            foreach (var c in items) { c.No = no++; rows.Add(c); }
        }
        return rows;
    }

    [HttpGet("{stkId:int}/coils/{partId:int}")]
    public IActionResult Coils(int stkId, int partId)
    {
        if (Me?.CanViewStore != true) return Deny();
        var s = VisibleStock(stkId);
        if (s == null) return Deny();
        return Ok(new CoilService().GetCoilRows(stkId, partId).Select(c => CoilRow(c, s)));
    }

    // 💬 REMARK ของ Coil ลูก (แถว Coil ใต้สินค้า) - แก้ได้ทุกคนที่ดูคลังได้ แบบ REMARK ของสินค้า · คลังดูสด = ดูอย่างเดียว
    public sealed class CoilRemarkRequest { public string Remark { get; set; } }

    [HttpPut("{stkId:int}/coils/{coilId:int}/remark")]
    public IActionResult CoilRemark(int stkId, int coilId, [FromBody] CoilRemarkRequest p)
    {
        if (Me?.CanViewStore != true) return Deny();
        var s = VisibleStock(stkId);
        if (s == null) return Deny("คุณไม่มีสิทธิ์ดูคลังนี้");
        if (s.IsLiveView) return Fail(StockModel.LiveViewMessage);
        if (!DbSchema.HasCoilRemark) return Fail("ยังไม่ได้รัน Script database/nexus/07_Coil_Remark.sql");
        var remark = (p?.Remark ?? "").Trim();
        if (remark.Length > 500) return Fail("REMARK ยาวเกิน 500 ตัวอักษร");
        try
        {
            var r = new CoilService().UpdateRemark(stkId, coilId, remark);
            if (r == null) return Fail("ไม่พบ Coil นี้ในคลัง");
            if (r.Value.Old != remark)
                LogService.WriteLog(Uid, "UPDATE_COIL_REMARK", $"| Stock: {s.Code} | Coil: {r.Value.CoilNo} | Remark: {r.Value.Old} -> {remark}", r.Value.CoilNo);
            return Ok();
        }
        catch (Exception ex) { return Fail(ex, "ไม่สามารถบันทึก REMARK ได้"); }
    }

    // SHOW COILS / รอบเรียลไทม์: Coil ทั้งคลังครั้งเดียว แยกตามสินค้า (PartID -> แถว)
    [HttpGet("{stkId:int}/coils")]
    public IActionResult AllCoils(int stkId)
    {
        if (Me?.CanViewStore != true) return Deny();
        var s = VisibleStock(stkId);
        if (s == null) return Deny();
        return Ok(new CoilService().GetCoils(stkId, 0).GroupBy(c => c.PartId)
            .ToDictionary(g => g.Key.ToString(), g => Grouped(g).Select(c => CoilRow(c, s)).ToList()));
    }

    // ⚡ เรียลไทม์ของโครงตาราง / ตั้งค่าคลัง / ทะเบียน Coil (ทุก 3 วินาที) - ไม่มีคลัง (ถูกลบ) = stock: false
    [HttpGet("{stkId:int}/live")]
    public IActionResult Live(int stkId)
    {
        if (Me?.CanViewStore != true) return Deny();
        var s = VisibleStock(stkId);
        if (s == null) return Ok(new { stock = false });
        return Ok(new { stock = true, settings = StoreLive.Settings(stkId), structure = StoreLive.Structure(s), coils = StoreLive.Coils(s) });
    }

    // ---------------------------------------------------------------- 📤 Export / Template
    [HttpGet("{stkId:int}/export")]
    public IActionResult Export(int stkId, [FromQuery] string key, [FromQuery] string cat, [FromQuery] string filter)
    {
        if (Me?.CanViewStore != true) return Deny();
        var s = VisibleStock(stkId);
        if (s == null) return Deny();
        string catFilter = string.IsNullOrEmpty(cat) || cat == AllLabel(s) ? "" : cat;
        var rows = _products.GetProducts(s, key ?? "", catFilter, filter ?? "", 0, 1000000).OrderBy(p => p.GroupKey).ThenBy(p => p.PartCode).ToList();
        if (rows.Count == 0) return Fail("ไม่มีข้อมูลในตารางให้ Export");
        try
        {
            string path = ImportTemplateService.NewPath(ImportTemplateService.Systems.Store, s.Code);
            StoreExcel.Write(path, s, rows, s.GroupCode);
            LogService.WriteLog(Uid, "EXPORT_STORE_EXCEL", $"Exported {rows.Count} rows | Stock: {s.Code} | File: {Path.GetFileName(path)}", s.Code);
            return Download(path);
        }
        catch (Exception ex) { return Fail(ex, "Export ไม่สำเร็จ"); }
    }

    [HttpGet("{stkId:int}/template")]
    public IActionResult Template(int stkId, [FromQuery] bool coil)
    {
        if (Me?.CanViewStore != true) return Deny();
        var s = VisibleStock(stkId);
        if (s == null) return Deny();
        try
        {
            string path;
            var products = _products.GetProducts(s, "", "", "", 0, 1000000).OrderBy(p => p.GroupKey).ThenBy(p => p.PartCode).ToList();
            if (coil)
            {
                path = new CoilImportService().WriteTemplate(s, products);
                LogService.WriteLog(Uid, "STORE_TEMPLATE_COIL", $"Stock: {s.Code} | Products: {products.Count} | File: {Path.GetFileName(path)}", s.Code);
            }
            else
            {
                path = new StoreMasterImportService().WriteTemplate(s, products, _stocks.GetStocks());
                LogService.WriteLog(Uid, "STORE_TEMPLATE_MAXMIN", $"Stock: {s.Code} | Rows: {products.Count} | File: {Path.GetFileName(path)}", s.Code);
            }
            return Download(path);
        }
        catch (Exception ex) { return Fail(ex, "สร้างไฟล์ Template ไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- 📥 IMPORT EXCEL (3 แบบตามไฟล์: อัพเดทข้อมูล / COIL LIST / บวกยอด)
    private static string Errs<T>(IEnumerable<T> bad, Func<T, string> line)
    {
        var list = bad.ToList();
        return string.Join("\n", list.Take(8).Select(line)) + (list.Count > 8 ? $"\n• ... และอีก {list.Count - 8:N0} แถว" : "");
    }

    [HttpPost("{stkId:int}/import")]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> ImportPreview(int stkId, IFormFile file)
    {
        var s = VisibleStock(stkId);
        if (s == null) return Deny();
        if (s.IsLiveView) return Fail(StockModel.LiveViewMessage);
        if (!Me.CanImportStock(s)) return Deny("คุณไม่มีสิทธิ์ Import ข้อมูลเข้าคลังนี้");
        string path;
        try { path = await SaveUpload(file); } catch (Exception ex) { return Fail(ex); }
        string fileName = file.FileName;
        try
        {
            if (StoreMasterImportService.IsMasterFile(path))
            {
                var stocks = _stocks.GetStocks();
                var rows = new StoreMasterImportService().Read(path, s, stocks);
                var noRight = rows.Where(r => r.IsValid).SelectMany(r => r.Stocks).GroupBy(x => x.StkId).Select(g => g.First()).Where(x => !Me.CanImportStock(x)).Select(x => x.Code).ToList();
                if (noRight.Count > 0) { TryDelete(path); return Deny("คุณไม่มีสิทธิ์ Import ข้อมูลเข้าคลัง: " + string.Join(", ", noRight)); }
                var valid = rows.Where(r => r.IsValid).ToList();
                var bad = rows.Where(r => !r.IsValid).ToList();
                string errs = Errs(bad, r => $"• แถว {r.RowNumber}: {r.Error}");
                if (valid.Count == 0) { TryDelete(path); return Fail("ไม่พบรายการที่นำเข้าได้ในไฟล์นี้\n\n" + errs); }
                var stockCodes = string.Join(", ", valid.SelectMany(r => r.Stocks).Select(x => x.Code).Distinct());
                string summary = $"ไฟล์: {fileName}\nคลัง: {stockCodes}\n\n" +
                                 $"อัพเดทสินค้าเดิม {valid.Count(r => !r.IsNew && !r.IsCoilExtra):N0} รายการ  •  เพิ่มสินค้าใหม่ {valid.Count(r => r.IsNew && !r.IsCoilExtra):N0} รายการ\n" +
                                 (valid.Any(r => r.CoilNo != null) ? $"COIL {valid.Count(r => r.CoilNo != null):N0} ลูก  •  น้ำหนักรวม {valid.Where(r => r.CoilNo != null).Sum(r => r.CoilWeight):#,##0.###} KG (STOCK (UNIT) ของสินค้า = น้ำหนักรวม Coil ในทะเบียน)\n" : "") +
                                 "ยอดคงคลัง / MAX / MIN จะถูกตั้งตามตัวเลขในไฟล์ (ช่องว่าง = ไม่เปลี่ยน)" +
                                 (bad.Count > 0 ? $"\n\n⚠ ข้ามแถวที่มีปัญหา {bad.Count:N0} แถว:\n{errs}" : "") + "\n\nยืนยันการนำเข้าหรือไม่?";
                return Ok(new { id = _uploads.Put(path, fileName, Uid, "store-master:" + stkId, rows), kind = "MASTER", summary });
            }
            if (s.CountCoil && DbSchema.HasCoilRegister && CoilImportService.IsCoilFile(path))
            {
                var rows = new CoilImportService().Read(path, s);
                var valid = rows.Where(r => r.IsValid).ToList();
                var bad = rows.Where(r => !r.IsValid).ToList();
                string errs = Errs(bad, r => $"• แถว {r.RowNumber}: {r.Error}");
                if (valid.Count == 0) { TryDelete(path); return Fail("ไม่พบรายการที่นำเข้าได้ในไฟล์นี้\n\n" + errs); }
                string summary = $"ไฟล์: {fileName}\nคลัง: {s.Code}\n\n" +
                                 $"COIL ใหม่ {valid.Count(r => !r.IsUpdate):N0} ลูก  •  อัพเดท COIL เดิม {valid.Count(r => r.IsUpdate):N0} ลูก\n" +
                                 $"สินค้า {valid.Select(r => r.PartId).Distinct().Count():N0} รายการ  •  น้ำหนักรวม {valid.Sum(r => r.WeightKG):#,##0.###} KG\n" +
                                 "STOCK (COIL) ของสินค้าในไฟล์ = นับใหม่จากทะเบียน Coil (ยอด KG ไม่เปลี่ยน)" +
                                 (bad.Count > 0 ? $"\n\n⚠ ข้ามแถวที่มีปัญหา {bad.Count:N0} แถว:\n{errs}" : "") + "\n\nยืนยันการนำเข้าหรือไม่?";
                return Ok(new { id = _uploads.Put(path, fileName, Uid, "store-coil:" + stkId, rows), kind = "COIL", summary });
            }
            {
                var rows = _stocks.ReadImportExcel(path);
                var valid = rows.Where(r => r.IsValid).ToList();
                var invalid = rows.Where(r => !r.IsValid).ToList();
                string errs = Errs(invalid, r => $"• แถว {r.RowNumber}: {(string.IsNullOrEmpty(r.Code) ? "-" : r.Code)} - {r.Error}");
                if (valid.Count == 0) { TryDelete(path); return Fail("ไม่พบรายการที่นำเข้าได้ในไฟล์นี้\n\n" + errs); }
                string summary = $"ไฟล์: {fileName}\nคลัง: {s.Code}\n\n" +
                                 $"นำเข้าได้ {valid.Count:N0} แถว  (รวม {valid.Sum(r => r.Qty):N0} {s.Unit})\n" +
                                 "จำนวนจะถูกบวกเพิ่มจากยอดเดิม" +
                                 (invalid.Count > 0 ? $"\n\n⚠ ข้ามแถวที่มีปัญหา {invalid.Count:N0} แถว:\n{errs}" : "") + "\n\nยืนยันการนำเข้าหรือไม่?";
                return Ok(new { id = _uploads.Put(path, fileName, Uid, "store-qty:" + stkId, rows), kind = "QTY", summary });
            }
        }
        catch (Exception ex) { TryDelete(path); return Fail(ex, "อ่านไฟล์ Excel ไม่สำเร็จ"); }
    }

    public sealed record ApplyRequest(string Id, string Kind);

    // 📥 IMPORT PENTA STOCK: supplier file review (stocks with InSupplierImport) · preview only, writes nothing
    [HttpPost("{stkId:int}/penta")]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> PentaPreview(int stkId, IFormFile file)
    {
        var s = VisibleStock(stkId);
        if (s == null) return Deny();
        if (s.IsLiveView) return Fail(StockModel.LiveViewMessage);
        if (!s.InSupplierImport) return Fail($"คลัง {s.Code} ไม่ได้เปิดใช้ IMPORT PENTA STOCK (ตั้งค่าคลัง)");
        if (!Me.CanImportStock(s)) return Deny("คุณไม่มีสิทธิ์ Import ข้อมูลเข้าคลังนี้");
        string path;
        try { path = await SaveUpload(file); } catch (Exception ex) { return Fail(ex); }
        try
        {
            List<PentaStockImportService.Src> rows;
            using (var wb = new ClosedXML.Excel.XLWorkbook(path)) rows = PentaStockImportService.ParseBook(wb);
            TryDelete(path);
            var dto = PentaStockImportService.Preview(rows, s.StkId, PentaStockImportService.LoadCoils());
            string id = _uploads.Put("", file.FileName, Uid, "penta:" + s.StkId, new PentaStockImportService.State(s.StkId, file.FileName, rows));
            return Ok(new ImportPreviewDto(id, file.FileName, $"PENTA STOCK · {s.Code}", dto, new List<ImportErrorDto>()));
        }
        catch (InvalidOperationException ex) { TryDelete(path); return Fail(ex.Message); }
        catch (Exception ex) { TryDelete(path); return Fail(ex, "อ่านไฟล์ไม่สำเร็จ"); }
    }

    public sealed record PentaPickingRequest(string Id, List<string> Keys, Dictionary<string, Dictionary<string, string>> Edits);

    // 🏷 IMPORT PENTA STOCK review > QR PICK LIST: Pick List cards (same shape as /products/picking) for the ticked coils · writes nothing, keeps the review cached
    //   part = matched coil's part / FG mother's part / typed PD CODE (unique in this stock) · QR scans like the stock's normal label (MOTHER = COIL_NO, COILNO = MAT_NO / COIL_NO)
    [HttpPost("{stkId:int}/penta/picking")]
    public IActionResult PentaPicking(int stkId, [FromBody] PentaPickingRequest req)
    {
        var s = VisibleStock(stkId);
        if (s == null) return Deny();
        if (s.IsLiveView || !s.InSupplierImport || !s.PentaPicking) return Fail($"คลัง {s.Code} ไม่ได้เปิดใช้ QR PICK LIST (ตั้งค่าคลัง)");
        if (!Me.CanImportStock(s)) return Deny("คุณไม่มีสิทธิ์ Import ข้อมูลเข้าคลังนี้");
        var it = string.IsNullOrEmpty(req?.Id) ? null : _uploads.Get(req.Id, Uid, "penta:" + stkId);
        if (it == null) return Fail("ไฟล์หมดเวลาแล้ว กรุณาเลือกไฟล์ใหม่");
        var keys = new HashSet<string>(req.Keys ?? new(), StringComparer.Ordinal);
        if (keys.Count == 0) return Fail("กรุณาเลือกรายการที่ต้องการพิมพ์อย่างน้อย 1 รายการครับ");
        try
        {
            var st = (PentaStockImportService.State)it.State;
            var coils = PentaStockImportService.LoadCoils();
            var byNo = coils.GroupBy(c => c.CoilNo.Trim().ToUpperInvariant()).ToDictionary(g => g.Key, g => g.First());
            var byMother = coils.Where(c => c.MotherCoil != "").ToLookup(c => c.MotherCoil.Trim().ToUpperInvariant());
            var inStock = new ProductControlService().GetInventoryForQR("", stkId);
            List<ProductControlModel> all = null;   // parts of other stocks, only loaded when a matched coil sits elsewhere
            var lay = new ProductControlLayoutService().GetAll() is var g0 && g0.TryGetValue(stkId, out var l0) ? l0 : ProductControlColumns.Default(stkId);
            var qrFields = lay.QrFields.ToList();
            string T(string v) => string.IsNullOrWhiteSpace(v) || v.Trim() == "-" ? "" : v.Trim();
            string Ed(string key, string f) => req.Edits != null && req.Edits.TryGetValue(key, out var e) && e.TryGetValue(f, out var v) ? v?.Trim() : null;
            var cards = new List<object>(); var skipped = new List<string>();
            foreach (var r in st.Rows.Where(r => keys.Contains(r.Key)))
            {
                string name = r.MatNo ?? r.CoilNo ?? $"แถว {r.Row}";
                if (r.Error != null || r.Superseded) { skipped.Add($"{name}: แถวไม่ถูกต้อง / ซ้ำ"); continue; }
                var (c, _) = PentaStockImportService.Match(r, stkId, byNo, byMother);
                ProductControlModel p;
                if (c != null) p = inStock.FirstOrDefault(x => x.PtId == c.PartId) ?? (all ??= new ProductControlService().GetInventoryForQR("", null)).FirstOrDefault(x => x.PtId == c.PartId);
                else
                {
                    string pd = Ed(r.Key, PentaStockImportService.FPd);
                    var hit = string.IsNullOrEmpty(pd) ? new() : inStock.Where(x => string.Equals(x.PartCode?.Trim(), pd, StringComparison.OrdinalIgnoreCase)).ToList();
                    p = hit.Count == 1 ? hit[0] : null;
                }
                if (p == null) { skipped.Add($"{name}: ไม่พบสินค้า (ใส่ PD CODE ของคลังนี้)"); continue; }
                bool fg = r.MatType == "FG" && r.MatNo != null;
                string coilNo = (fg ? r.MatNo : r.CoilNo ?? r.MatNo).Trim(), mother = (r.CoilNo ?? coilNo).Trim();
                var wText = Ed(r.Key, PentaStockImportService.FWeight);
                decimal? wt = wText != null && decimal.TryParse(wText, System.Globalization.NumberStyles.AllowDecimalPoint, System.Globalization.CultureInfo.InvariantCulture, out var w) ? w : r.Wt;
                var own = new Dictionary<int, (List<string> Mothers, List<string> Coils)> { [p.PtId] = (new() { mother }, new() { coilNo }) };
                string grp = lay.GroupBy == "CUSTOMER" ? p.Customer : lay.GroupBy == "SUPPLIER" ? p.CustomerCode : p.Category;
                cards.Add(new
                {
                    ptId = p.PtId, code = T(p.PartCode), partNo = T(p.PartNo), name = T(p.PartName), partA = T(p.PartA), customer = T(p.Customer),
                    packSize = wt?.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture) ?? "", group = T(grp), qr = QrFormat.Content(p, qrFields, own, lay.QrSep)
                });
            }
            return Ok(new { unit = "KG", units = new FieldPresetService().GetUnits().Select(u => u.Unit).ToList(), items = cards, skipped });
        }
        catch (Exception ex) { return Fail(ex, "โหลดข้อมูล QR PICK LIST ไม่สำเร็จ"); }
    }

    // 📥 IMPORT PENTA STOCK apply: CHANGED = coil weight · NEW (with PD CODE) = add coil · excluded / SAME untouched
    [HttpPost("{stkId:int}/penta/apply")]
    public IActionResult PentaApply(int stkId, [FromBody] ImportApplyRequest req)
    {
        var s = VisibleStock(stkId);
        if (s == null) return Deny();
        if (Me?.CanViewStore != true) return Deny();
        if (s.IsLiveView || !s.InSupplierImport) return Fail($"คลัง {s.Code} ไม่ได้เปิดใช้ IMPORT PENTA STOCK");
        if (!Me.CanImportStock(s)) return Deny("คุณไม่มีสิทธิ์ Import ข้อมูลเข้าคลังนี้");
        var it = string.IsNullOrEmpty(req?.Id) ? null : _uploads.Get(req.Id, Uid, "penta:" + stkId);
        if (it == null) return Fail("ไฟล์หมดเวลาแล้ว กรุณาเลือกไฟล์ใหม่");
        try
        {
            _uploads.Remove(req.Id);   // one apply per preview (double click / second tab = "ไฟล์หมดเวลา")
            var r = PentaStockImportService.Apply((PentaStockImportService.State)it.State, s, req, Uid);
            LogService.WriteLog(Uid, "PENTA_STOCK_IMPORT", $"{s.Code} · File: {it.FileName} | Updated: {r.Updated} | Added: {r.Added} | Same: {r.Same} | Skipped: {r.Skipped} | Errors: {r.Errors.Count}", "PENTA-IMPORT");
            string msg = $"IMPORT PENTA STOCK {s.Code}: อัพเดทน้ำหนัก {r.Updated:N0} · เพิ่ม Coil {r.Added:N0} · เหมือนเดิม {r.Same:N0} · ข้าม {r.Skipped:N0}"
                       + (r.Errors.Count > 0 ? $"\n⚠ ไม่สำเร็จ {r.Errors.Count} รายการ:\n" + string.Join("\n", r.Errors.Take(10)) : "");
            return Ok(new { message = msg });
        }
        catch (Exception ex) { return Fail(ex, "นำเข้าไม่สำเร็จ"); }
    }

    [HttpPost("{stkId:int}/import/apply")]
    public IActionResult ImportApply(int stkId, [FromBody] ApplyRequest req)
    {
        var s = VisibleStock(stkId);
        if (s == null) return Deny();
        if (!Me.CanImportStock(s)) return Deny("คุณไม่มีสิทธิ์ Import ข้อมูลเข้าคลังนี้");
        string kind = req.Kind switch { "MASTER" => "store-master:", "COIL" => "store-coil:", _ => "store-qty:" } + stkId;
        var it = _uploads.Get(req.Id, Uid, kind);
        if (it == null) return Fail("ไฟล์หมดเวลาแล้ว กรุณาเลือกไฟล์ใหม่");
        try
        {
            string msg;
            switch (req.Kind)
            {
                case "MASTER":
                {
                    var rows = (List<StoreMasterRow>)it.State;
                    var bad = rows.Count(r => !r.IsValid);
                    var stockCodes = string.Join(", ", rows.Where(r => r.IsValid).SelectMany(r => r.Stocks).Select(x => x.Code).Distinct());
                    var r = new StoreMasterImportService().Apply(rows, Uid);
                    LogService.WriteLog(Uid, "STOCK_MASTER_IMPORT",
                        $"Import Excel (update) -> {stockCodes} | File: {it.FileName} | Updated: {r.Updated} | Added: {r.Added} | Stock rows: {r.StockRows} | Coils: {r.Coils} | Skipped rows: {bad}", s.Code);
                    msg = $"นำเข้าข้อมูลสำเร็จ\nอัพเดท {r.Updated:N0} รายการ  •  เพิ่มใหม่ {r.Added:N0} รายการ" + (r.Coils > 0 ? $"\nCOIL {r.Coils:N0} ลูก" : "");
                    break;
                }
                case "COIL":
                {
                    var rows = (List<CoilImportRow>)it.State;
                    var r = new CoilImportService().Apply(s, rows, Uid);
                    LogService.WriteLog(Uid, "COIL_IMPORT",
                        $"Import COIL LIST -> {s.Code} | File: {it.FileName} | Added: {r.Added} | Updated: {r.Updated} | Products: {r.Parts} | Skipped rows: {rows.Count(x => !x.IsValid)}", s.Code);
                    msg = $"นำเข้า COIL สำเร็จ\nCOIL ใหม่ {r.Added:N0} ลูก  •  อัพเดท {r.Updated:N0} ลูก  •  สินค้า {r.Parts:N0} รายการ";
                    break;
                }
                default:
                {
                    var rows = (List<StockImportRow>)it.State;
                    var result = _stocks.ApplyImport(s.StkId, rows, it.FileName, Uid);
                    LogService.WriteLog(Uid, "STOCK_IMPORT",
                        $"Import Excel -> {s.Code} | File: {it.FileName} | Items: {result.Items} | Total qty: {result.TotalQty} | Skipped rows: {rows.Count(x => !x.IsValid)}", s.Code);
                    msg = $"นำเข้าข้อมูลสำเร็จ {result.Items:N0} รายการ\nรวม {result.TotalQty:N0} {s.Unit}";
                    break;
                }
            }
            _uploads.Remove(req.Id);
            return Ok(new { message = msg });
        }
        catch (Exception ex) { return Fail(ex, "นำเข้าข้อมูลไม่สำเร็จ (ยกเลิกทั้งไฟล์ ไม่มีรายการใดถูกบันทึก)"); }
    }

    // ---------------------------------------------------------------- 🏷️ BARCODE FORMATS (BarcodeFormatWindow)
    [HttpGet("formats")]
    public IActionResult Formats()
    {
        if (Me?.CanManageFormats != true) return Deny();
        var stocks = _stocks.GetStocks();
        return Ok(new
        {
            canAdd = Me.CanAddStore, canEdit = Me.CanEditStore, canDelete = Me.CanDeleteStore,
            formats = _stocks.GetFormats(),
            stocks = stocks.Select(s => new { s.StkId, s.Code, s.Name, display = s.DisplayName }),
            // MATCH BY: ช่องที่ใช้ค้นสินค้า (กำหนดเอง) + ช่องเพิ่มเองของแต่ละคลัง
            matchFields = BarcodeFormatModel.MatchFields.Select(f => new { key = f.Key, label = f.Label })
                .Concat(new CustomFieldService().GetDefs().Select(d => new { key = d.Key, label = $"{d.Label} ({stocks.FirstOrDefault(s => s.StkId == d.StockId)?.Code ?? "-"})" }))
        });
    }

    private static int RequiredMinFields(BarcodeFormatModel f)
    {
        int m = Math.Max(f.CodePos, Math.Max(f.AltCodePos ?? 0, Math.Max(f.QtyPos ?? 0, Math.Max(f.CoilNoPos ?? 0, f.MotherCoilPos ?? 0))));
        if (f.MatchByName) foreach (int n in f.NamePositions()) m = Math.Max(m, n);
        return Math.Max(1, m);
    }

    // 🧪 ทดสอบรูปแบบกับป้ายตัวอย่าง: แยกช่อง + รหัส / จำนวน / Coil ที่อ่านได้ + หาสินค้าในระบบ
    [HttpPost("formats/test")]
    public IActionResult TestFormat([FromBody] BarcodeFormatModel f)
    {
        if (Me?.CanManageFormats != true) return Deny();
        f.IsActive = true;
        if (f.DelimMode == "SPACES" && string.IsNullOrEmpty(f.Delimiter)) f.Delimiter = " ";
        f.MinFields = Math.Max(f.MinFields, RequiredMinFields(f));
        string sample = f.SampleText ?? "";
        var fields = string.IsNullOrEmpty(sample) ? Array.Empty<string>() : f.SplitFields(sample);
        bool ok = f.TryParse(sample, out var codes, out var qty);
        string coilNo = null, mother = null;
        if (ok) f.ReadCoil(sample, out coilNo, out mother);
        string lookup = null;
        if (ok && codes.Count > 0)
        {
            var part = new ScanService().FindPart(f, codes, out string note);
            lookup = part != null ? $"FOUND IN SYSTEM:  {part.PartCode}  •  {part.PartName}"
                                  : "NOT FOUND IN SYSTEM" + (string.IsNullOrEmpty(note) ? "  (no product has this " + (f.MatchByName ? "name" : f.MatchField ?? "code") + ")" : "  -  " + note);
        }
        return Ok(new { ok, fields, codes, qty, coilNo, mother, lookup, minFields = RequiredMinFields(f), namePositions = f.NamePositions() });
    }

    public sealed class SaveFormatRequest
    {
        public BarcodeFormatModel Format { get; set; }
        public int? TypedMinFields { get; set; }
    }

    [HttpPost("formats")]
    public IActionResult SaveFormat([FromBody] SaveFormatRequest req)
    {
        var f = req?.Format;
        if (f == null) return Fail("ข้อมูลไม่ครบ");
        if (!(f.FmtId == 0 ? Me?.CanAddStore == true : Me?.CanEditStore == true))
            return Deny(f.FmtId == 0 ? "คุณไม่มีสิทธิ์เพิ่มรูปแบบบาร์โค้ด" : "คุณไม่มีสิทธิ์แก้ไขรูปแบบบาร์โค้ด");
        f.Name = (f.Name ?? "").Trim();
        f.DelimMode = f.DelimMode == "SPACES" ? "SPACES" : "CHAR";
        if (f.SplitBySpaces && string.IsNullOrEmpty(f.Delimiter)) f.Delimiter = " ";
        f.CodePrefix = f.CodePrefix is "DIGIT" or "CUT" ? f.CodePrefix : "NONE";
        f.MatchBy = BarcodeFormatModel.CleanMatchBy(f.MatchBy);
        if (string.IsNullOrEmpty(f.Name)) return Fail("กรุณากรอกชื่อรูปแบบ (FORMAT NAME)");
        if (!f.SplitBySpaces && string.IsNullOrEmpty(f.Delimiter)) return Fail("กรุณากรอกตัวคั่น (DELIMITER) เช่น ; หรือเลือก SPLIT FIELDS BY = ANY SPACES");
        if (f.CodePrefix == "CUT" && !(f.CodeCut > 0)) return Fail("กรุณากรอกจำนวนตัวอักษรที่ต้องการตัด (N)");
        if (f.CodePos <= 0) return Fail("กรุณากรอกตำแหน่งช่องรหัสสินค้า (CODE FIELD #)");
        if (f.MatchByName && !string.IsNullOrWhiteSpace(f.NameFields) && f.NamePositions().Count == 0) return Fail("กรุณากรอกช่องชื่อสินค้า (NAME FIELDS #) เป็นตัวเลข เช่น 6,7");
        int needMin = RequiredMinFields(f);
        if (req.TypedMinFields.HasValue && req.TypedMinFields.Value < needMin)
            return Fail($"MIN FIELDS ต้องไม่น้อยกว่า {needMin}\n(ช่องที่ใช้อยู่ไกลสุดคือช่อง #{needMin}) - เว้นว่างไว้ได้ ระบบใส่ให้เอง");
        f.MinFields = Math.Max(req.TypedMinFields ?? needMin, needMin);
        if (_stocks.GetFormats().Any(x => x.FmtId != f.FmtId && string.Equals(x.Name, f.Name, StringComparison.OrdinalIgnoreCase)))
            return Fail($"ชื่อรูปแบบ \"{f.Name}\" มีอยู่แล้ว กรุณาใช้ชื่ออื่น");
        try
        {
            bool isNew = f.FmtId == 0;
            int id = _stocks.SaveFormat(f, Uid);
            LogService.WriteLog(Uid, isNew ? "BARCODE_FMT_CREATE" : "BARCODE_FMT_UPDATE",
                $"{f.Name} | Delim: {f.Delimiter} | Code#{f.CodePos} Alt#{f.AltCodePos} Qty#{f.QtyPos} Min{f.MinFields} Coil#{f.CoilNoPos} Master#{f.MotherCoilPos} | Match: {(f.MatchByName ? "NAME#" + string.Join(",", f.NamePositions()) : f.MatchBy)} | Active: {f.IsActive} | DeductStk: {f.SourceStkId}", f.Name);
            return Ok(new { id, message = $"บันทึกรูปแบบ {f.Name} สำเร็จ" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกรูปแบบบาร์โค้ดไม่สำเร็จ"); }
    }

    [HttpDelete("formats/{fmtId:int}")]
    public IActionResult DeleteFormat(int fmtId)
    {
        if (Me?.CanDeleteStore != true) return Deny();
        var f = _stocks.GetFormats().FirstOrDefault(x => x.FmtId == fmtId);
        if (f == null) return NotFound();
        try
        {
            _stocks.DeleteFormat(fmtId);
            LogService.WriteLog(Uid, "BARCODE_FMT_DELETE", $"Deleted format {f.Name}", f.Name);
            return Ok();
        }
        catch (Exception ex) { return Fail(ex, "ลบรูปแบบบาร์โค้ดไม่สำเร็จ"); }
    }
}
