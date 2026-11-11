using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;

namespace Nexus.Services;

// 🧊 LAYOUT 3D (CIMS › Layout 3D): สถานะตำแหน่งจัดเก็บสำหรับโมเดล 3D ของคลัง Stock Material - อ่านอย่างเดียว ไม่แก้ข้อมูลใด ๆ
//   "มีเหล็ก" = Coil ที่ยังอยู่ในคลัง (Nexus.Coils.Status = 'IN') + รายการสแกนรับเข้าล่าสุดของม้วนนั้นมีตำแหน่ง LAYOUT (Nexus.ScanTransactions.Layout)
//     ตำแหน่ง = ของรายการสแกนล่าสุดที่ทำให้ม้วนอยู่ในคลัง (Nexus.CoilMoves ผูก ScanTransactionID · ไม่นับที่ ADJUST ยกเลิกแล้ว / CONSUME)
//     รับเข้าครั้งล่าสุดไม่ได้สแกนตำแหน่ง หรือม้วนถูกย้ายคลังภายหลัง = ไม่รู้ว่าอยู่ช่องไหน -> ไม่แสดงในโมเดล
//   ข้อความตำแหน่งที่สแกน -> ตำแหน่งใน LAYOUT SETUP: เทียบกับรูปแบบ QR ปัจจุบัน / ป้ายใต้ QR ("RACK1 : 3A") / "ประเภท ชื่อ" / ชื่อที่ไม่ซ้ำข้ามประเภท
//     เทียบไม่ได้ (เปลี่ยนชื่อตำแหน่ง / เปลี่ยนตัวคั่นหลังสแกน) = ส่งข้อความเดิมไปให้หน้าเว็บเทียบกับรหัสช่องในผังอีกชั้น
public sealed class Layout3DCoil
{
    public int CoilId { get; set; }
    public string CoilNo { get; set; }
    public string MotherCoil { get; set; }
    public int PartId { get; set; }
    public string PartCode { get; set; }
    public string PartName { get; set; }
    public string Customer { get; set; }
    public string StockCode { get; set; }
    public decimal WeightKg { get; set; }
    public DateTime? ReceivedDate { get; set; }
    public string Layout { get; set; }
    public DateTime? PlacedAt { get; set; }
    public string PlacedBy { get; set; }
    public string TypeName { get; set; }
    public string LocName { get; set; }
}

public sealed class Layout3DService
{
    private readonly LayoutService _layout = new();

    // หลายจอเปิดพร้อมกัน + สัญญาณเรียลไทม์มาถี่ = ถามฐานข้อมูลไม่เกิน 1 ครั้งต่อ 2 วินาที
    private static readonly object Gate = new();
    private static object _cache;
    private static DateTime _cacheAt = DateTime.MinValue;

    public object Snapshot()
    {
        lock (Gate)
        {
            if (_cache != null && (DateTime.UtcNow - _cacheAt).TotalSeconds < 2) return _cache;
            _cache = Build();
            _cacheAt = DateTime.UtcNow;
            return _cache;
        }
    }

    private object Build()
    {
        var set = _layout.GetSettings();
        var locs = _layout.AllLocations();

        var byText = new Dictionary<string, LayoutLocation>(StringComparer.OrdinalIgnoreCase);
        foreach (var l in locs)
        {
            byText.TryAdd(LayoutService.QrText(set, l.TypeName, l.LocName), l);
            byText.TryAdd(LayoutService.LabelText(l.TypeName, l.LocName), l);
            byText.TryAdd(l.TypeName + " " + l.LocName, l);
        }
        // รูปแบบ QR ที่มีแต่ชื่อตำแหน่ง: ใช้ได้เมื่อชื่อนั้นไม่ซ้ำข้ามประเภท
        foreach (var g in locs.GroupBy(l => l.LocName, StringComparer.OrdinalIgnoreCase))
            if (g.Count() == 1) byText.TryAdd(g.Key, g.First());

        List<Layout3DCoil> coils;
        using (var c = new SqlConnection(GlobalConfig.ConnStr))
        {
            coils = c.Query<Layout3DCoil>(@"
                SELECT c.CoilID AS CoilId, c.CoilNo, c.MotherCoil, c.PartID AS PartId, p.PartCode, p.Description AS PartName,
                       NULLIF(LTRIM(RTRIM(p.Customer)), '') AS Customer, s.StockCode, c.WeightKG AS WeightKg, c.ReceivedDate,
                       LTRIM(RTRIM(x.Layout)) AS Layout, x.TransactionDate AS PlacedAt, x.UserID AS PlacedBy
                FROM Nexus.Coils c
                JOIN Nexus.Parts p ON p.PartID = c.PartID
                JOIN Nexus.Stocks s ON s.StockID = c.StockID
                CROSS APPLY (SELECT TOP 1 t.Layout, t.TransactionDate, t.UserID, m.ToStockID
                             FROM Nexus.CoilMoves m
                             JOIN Nexus.ScanTransactions t ON t.TransactionID = m.ScanTransactionID
                             WHERE m.CoilID = c.CoilID AND m.Undone = 0 AND m.ToStatus = 'IN' AND m.Action <> 'CONSUME'
                             ORDER BY m.MoveID DESC) x
                WHERE c.Status = 'IN' AND x.ToStockID = c.StockID AND NULLIF(LTRIM(RTRIM(x.Layout)), '') IS NOT NULL
                ORDER BY x.TransactionDate, c.CoilID").ToList();
        }

        foreach (var k in coils)
        {
            if (!byText.TryGetValue(k.Layout, out var l)) continue;
            k.TypeName = l.TypeName;
            k.LocName = l.LocName;
        }

        return new
        {
            ready = true,
            locations = locs.Select(l => new { l.LocId, l.TypeName, l.LocName }).ToList(),
            coils
        };
    }
}
