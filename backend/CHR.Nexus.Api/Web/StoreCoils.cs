using Microsoft.Data.SqlClient;
using Nexus.Helpers;
using Nexus.Services;

namespace CHR.Nexus.Api.Web;

// 🧲 ยอด Coil ของการ์ดหน้าคลัง: MASTER COIL / COIL NO (จำนวน / KG / TON)
//   all = ทั้งคลัง (CoilService.GetSummary เดิม) · max / min / noSet = แยกตามสถานะสินค้า (เงื่อนไขเดียวกับ GetStatusCounts)
public static class StoreCoils
{
    public sealed record Part(int MasterCount, string MasterKg, string MasterTon, int ChildCount, string ChildKg, string ChildTon);

    private static Part Make(int mc, decimal mk, int cc, decimal ck) =>
        new(mc, Qty.Plain(mk), Ton(mk), cc, Qty.Plain(ck), Ton(ck));

    private static string Ton(decimal kg) => (kg / 1000m).ToString("#,##0.000");

    // split = คลังที่มี vw_StockMonitoring (GetStatusCounts ไม่ใช่ null) -> แยกยอดตามการ์ด MAX / MIN / ยังไม่ตั้ง
    public static object Get(int stkId, bool split)
    {
        var c = new CoilService().GetSummary(stkId).TryGetValue(stkId, out var x) ? x : new CoilService.CoilSummary();
        var all = Make(c.MasterCount, c.MasterKg, c.ChildCount, c.ChildKg);
        if (!split) return new { all.MasterCount, all.MasterKg, all.MasterTon, all.ChildCount, all.ChildKg, all.ChildTon, max = (Part)null, min = (Part)null, noSet = (Part)null };

        var b = new Dictionary<string, (int mc, decimal mk, int cc, decimal ck)>();
        using (var conn = new SqlConnection(global::Nexus.Core.GlobalConfig.ConnStr))
        using (var cmd = new SqlCommand(@"
            WITH c AS (
                SELECT PartID,
                       SUM(CASE WHEN m = 1 THEN 1 ELSE 0 END) AS mc, SUM(CASE WHEN m = 1 THEN WeightKG ELSE 0 END) AS mk,
                       SUM(CASE WHEN m = 0 THEN 1 ELSE 0 END) AS cc, SUM(CASE WHEN m = 0 THEN WeightKG ELSE 0 END) AS ck
                FROM (SELECT PartID, WeightKG,
                             CASE WHEN ISNULL(LTRIM(RTRIM(MotherCoil)), '') IN ('', '-') OR MotherCoil = CoilNo THEN 1 ELSE 0 END AS m
                      FROM Nexus.Coils WHERE Status = 'IN' AND StockID = @stk) x
                GROUP BY PartID)
            SELECT b, SUM(mc), ISNULL(SUM(mk), 0), SUM(cc), ISNULL(SUM(ck), 0)
            FROM (SELECT CASE WHEN v.StockStatus IN ('OVER_MAX', 'NORMAL_GOOD') AND ISNULL(v.[Max], 0) > 0 THEN 'MAX'
                              WHEN v.StockStatus IN ('UNDER_MIN', 'OUT_OF_STOCK') AND ISNULL(v.[Min], 0) > 0 THEN 'MIN'
                              ELSE 'NOSET' END AS b, c.mc, c.mk, c.cc, c.ck
                  FROM c JOIN Nexus.vw_StockMonitoring v ON v.PartID = c.PartID AND v.StkId = @stk) y
            GROUP BY b OPTION (MAX_GRANT_PERCENT = 5)", conn))
        {
            cmd.Parameters.AddWithValue("@stk", stkId);
            conn.Open();
            using var r = cmd.ExecuteReader();
            while (r.Read()) b[r.GetString(0)] = (r.GetInt32(1), r.GetDecimal(2), r.GetInt32(3), r.GetDecimal(4));
        }
        Part Of(string k) => b.TryGetValue(k, out var v) ? Make(v.mc, v.mk, v.cc, v.ck) : Make(0, 0, 0, 0);
        return new { all.MasterCount, all.MasterKg, all.MasterTon, all.ChildCount, all.ChildKg, all.ChildTon, max = Of("MAX"), min = Of("MIN"), noSet = Of("NOSET") };
    }
}
