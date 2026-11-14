using System.Text.Json;
using Microsoft.Data.SqlClient;
using Nexus.Core;
using Nexus.Models;
using Nexus.Services;

namespace CHR.Nexus.Api.Web;

// 🚦 REMARK ลบเองเมื่อไฟหายแดง (ทุกคลัง ยกเว้นคลังที่แสดงสดจาก StorePC = อ่านอย่างเดียว)
//   ไฟแดง = StockStatus UNDER_MIN / OUT_OF_STOCK (เหมือนดวงไฟในตาราง) · ผู้ใช้พิมพ์ REMARK อธิบายว่าทำไมแดง
//   ทุก 10 วินาที (หรือทันทีที่มีการบันทึก): แถวที่มี REMARK ตอนไฟแดง = จำไว้ -> รอบไหนไฟเปลี่ยนเป็นสีอื่น = ลบ REMARK ให้
//   REMARK ที่พิมพ์ตอนไฟไม่แดง = ไม่ยุ่ง · จำไว้ในไฟล์ storage\remark-red.json -> รีสตาร์ทเซิร์ฟเวอร์แล้วไม่ลืม
public sealed class RemarkAutoClear : BackgroundService
{
    private readonly ILogger<RemarkAutoClear> _log;
    private HashSet<string> _red = new();   // "{StkId}:{PartID}" ที่มี REMARK ตอนไฟแดง
    private static string FilePath => Path.Combine(Storage.Root, "remark-red.json");

    public RemarkAutoClear(ILogger<RemarkAutoClear> log) => _log = log;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        try { if (File.Exists(FilePath)) _red = JsonSerializer.Deserialize<HashSet<string>>(File.ReadAllText(FilePath)) ?? new(); }
        catch (Exception ex) { _log.LogDebug(ex, "RemarkAutoClear load"); }

        // ทำงานเฉพาะเมื่อ "ข้อมูลกลาง" เปลี่ยน (LiveBus.DataVersion ขยับ · เปิดหน้า / แชท / แจ้ง Admin ไม่นับ) + 1 รอบตอนเริ่มระบบ
        //   ไฟแดง / ไม่แดง เปลี่ยนได้จากข้อมูลเปลี่ยนเท่านั้น (สแกน / แก้ยอด / MAX-MIN / ตัวเฝ้าคลังจับการเปลี่ยนจากภายนอก) -> ทุกอย่างผ่าน DataVersion
        long seen = -1;
        while (!ct.IsCancellationRequested)
        {
            var next = LiveBus.Next();   // รับก่อนเช็ค -> ไม่พลาดการเปลี่ยนที่เกิดระหว่างเช็ค
            if (LiveBus.DataVersion == seen)
            {
                try { await next.WaitAsync(ct); } catch (OperationCanceledException) { break; }
                continue;
            }
            try { await Task.Delay(3000, ct); } // รวมการเปลี่ยนที่ติด ๆ กัน · ไม่ถี่กว่ารอบละ 3 วินาที
            catch (OperationCanceledException) { break; }
            long ver = LiveBus.DataVersion;   // อ่านก่อน Sweep -> เปลี่ยนระหว่าง Sweep = รอบหน้าทำอีกครั้ง
            try { Sweep(); seen = ver; }
            catch (Exception ex)
            {
                _log.LogDebug(ex, "RemarkAutoClear sweep");   // รอบหน้าลองใหม่ (ไม่จำเวอร์ชัน) · พักกัน Loop ถี่
                try { await Task.Delay(10000, ct); } catch (OperationCanceledException) { break; }
            }
        }
    }

    private void Sweep()
    {
        var stocks = new StockService().GetStocks().Where(s => s.StkId > 0 && !s.IsLiveView).ToDictionary(s => s.StkId);
        if (stocks.Count == 0) return;

        // แถวที่มี REMARK ของทุกคลัง + ไฟแดงหรือไม่
        var rows = new List<(int Stk, int Part, string Code, string Remark, bool Red)>();
        using (var conn = new SqlConnection(GlobalConfig.ConnStr))
        using (var cmd = new SqlCommand($@"SELECT StkId, PartID, PartCode, Remark,
                       CASE WHEN StockStatus IN ('UNDER_MIN', 'OUT_OF_STOCK') THEN 1 ELSE 0 END AS IsRed
                FROM Nexus.vw_StockMonitoring
                WHERE StkId IN ({string.Join(",", stocks.Keys)}) AND LTRIM(RTRIM(ISNULL(Remark, ''))) <> ''
                OPTION (MAX_GRANT_PERCENT = 5)", conn))
        {
            conn.Open();
            using var r = cmd.ExecuteReader();
            while (r.Read())
                rows.Add((Convert.ToInt32(r["StkId"]), Convert.ToInt32(r["PartID"]), r["PartCode"]?.ToString() ?? "", r["Remark"]?.ToString() ?? "", Convert.ToInt32(r["IsRed"]) == 1));
        }

        var next = new HashSet<string>();
        var changedStocks = new HashSet<int>();
        foreach (var x in rows)
        {
            string key = $"{x.Stk}:{x.Part}";
            if (x.Red) { next.Add(key); continue; }
            if (!_red.Contains(key)) continue;   // REMARK ที่พิมพ์ตอนไฟไม่แดง = ไม่ลบ
            try
            {
                if (Clear(stocks[x.Stk], x.Part, x.Remark))
                {
                    changedStocks.Add(x.Stk);
                    try { LogService.WriteLog("SYSTEM", "AUTO_CLEAR_REMARK", $"| Stock: {stocks[x.Stk].Code} | Remark: {x.Remark} -> (ไฟไม่แดงแล้ว)", x.Code); } catch { }
                }
            }
            catch (Exception ex) { _log.LogDebug(ex, "RemarkAutoClear clear {Key}", key); next.Add(key); } // ลบไม่ได้ = ลองใหม่รอบหน้า
        }

        bool dirty = !next.SetEquals(_red);
        _red = next;
        if (dirty)
            try { File.WriteAllText(FilePath, JsonSerializer.Serialize(_red)); } catch (Exception ex) { _log.LogDebug(ex, "RemarkAutoClear save"); }
        foreach (var id in changedStocks) LiveBus.Publish("store:" + id, "store");
    }

    // ลบเฉพาะถ้า REMARK ยังเป็นข้อความเดิม (มีคนเพิ่งแก้ระหว่างนี้ = ไม่ทับ)
    private static bool Clear(StockModel stock, int partId, string remark)
    {
        string sql = stock.IsMain
            ? "UPDATE Nexus.Parts SET Remark = '' WHERE PartID = @pt AND Remark = @old"
            : "UPDATE Nexus.PartStocks SET Remark = '', UpdatedDate = GETDATE() WHERE StockID = @stk AND PartID = @pt AND Remark = @old";
        using var conn = new SqlConnection(GlobalConfig.ConnStr);
        using var cmd = new SqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@pt", partId);
        cmd.Parameters.AddWithValue("@stk", stock.StkId);
        cmd.Parameters.AddWithValue("@old", remark);
        conn.Open();
        return cmd.ExecuteNonQuery() > 0;
    }
}
