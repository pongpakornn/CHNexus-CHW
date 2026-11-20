using Nexus.Helpers;
using Nexus.Models;
using Nexus.Services;

namespace CHR.Nexus.Api.Web.Scanner;

// 📊 ตารางวันนี้ + ตารางสรุป (ScanInViewModel.LoadTodayDataAsync + UpdateSummary)
//    1 แถวสรุป = 1 สินค้า (PartID) ต่อ 1 คลัง / RETURN นับรวมเป็นยอดรับเข้า / FinalStock = ยอดจริงจากฐานข้อมูล
public sealed class SummaryRowDto
{
    public int PartId { get; set; }
    public int StkId { get; set; }
    public string StockCode { get; set; }
    public string PartCode { get; set; }
    public string PartName { get; set; }
    public string Code { get; set; }
    public int InCount { get; set; }
    public decimal TotalInQty { get; set; }
    public int OutCount { get; set; }
    public decimal TotalOutQty { get; set; }
    public decimal FinalStock { get; set; }
    public string ImageUrl { get; set; }
}

public sealed class TodayDto
{
    public string Signature { get; set; }
    public List<ScanRowDto> Rows { get; set; } = new();          // ใหม่สุดก่อน
    public List<SummaryRowDto> Summary { get; set; } = new();
}

public static class ScannerToday
{
    public static TodayDto Load(ScannerScope scope)
    {
        var svc = new ScanService();
        var stocks = scope.ScopeStocks;
        var dto = new TodayDto();
        if (stocks.Count == 0) { dto.Signature = "empty"; return dto; }

        var displayMap = svc.GetScanDisplayMap(scope.User?.UserId);
        var displayFormats = displayMap.Values.Any(v => v.StartsWith("FIELD:")) ? new StockService().GetFormats() : new List<BarcodeFormatModel>();

        var rows = stocks
            .SelectMany(st => svc.GetTodayTransactions(st).Select(t => { t.StkId = st.StkId; t.StockCode = st.Code; t.ShowStockInCode = stocks.Count > 1; return t; }))
            .OrderBy(t => t.UpdateTime).ToList();

        var balances = new Dictionary<(int, int), decimal>();
        // ยอดคงเหลือ: 1 คำสั่งต่อคลัง (เดิม 1 การเชื่อมต่อต่อสินค้า) · ฐานข้อมูลผิดพลาด = Error ถึงหน้าจอ (ไม่แสดงยอด 0 หลอก)
        foreach (var g in rows.GroupBy(r => r.StkId))
        {
            var found = svc.GetInventoryBalances(g.Select(r => r.PartId), stocks.FirstOrDefault(s => s.StkId == g.Key));
            foreach (int pid in g.Select(r => r.PartId).Distinct())
                balances[(g.Key, pid)] = found.TryGetValue(pid, out decimal q) ? q : 0m;
        }

        dto.Signature = string.Join(",", stocks.Select(s => s.StkId)) + "|" + rows.Count + "|" + rows.Sum(d => d.Qty) + "|" +
                        (rows.Count > 0 ? rows.Max(d => d.UpdateTime).Ticks : 0);

        var summary = new List<SummaryRowDto>();
        foreach (var item in rows)
        {
            if (displayMap.TryGetValue(item.StkId, out string key))
            {
                string v = ScanDisplay.Resolve(key, item.PartCode, item.PartA, item.PartNumber, item.Model, item.PartName, item.RefNo, displayFormats, item.PartB);
                item.DisplayCode = string.IsNullOrWhiteSpace(v) ? null : v;
            }
            if (item.Status == "IN" || item.Status == "RETURN" || item.Status == "OUT") dto.Rows.Insert(0, ScanRowDto.From(item));

            if (item.PartId <= 0 && string.IsNullOrWhiteSpace(item.PartACode)) continue;
            decimal bal = balances.TryGetValue((item.StkId, item.PartId), out decimal b) ? b : 0;
            var existing = summary.FirstOrDefault(x => x.StkId == item.StkId &&
                (item.PartId > 0 ? x.PartId == item.PartId : x.PartId <= 0 && x.PartCode == item.PartACode));
            bool isIn = item.Status == "IN" || item.Status == "RETURN", isOut = item.Status == "OUT";
            if (existing == null)
            {
                summary.Add(existing = new SummaryRowDto
                {
                    PartId = item.PartId, StkId = item.StkId, StockCode = item.StockCode, PartCode = item.PartCode, PartName = item.PartName,
                    Code = item.CodeText, ImageUrl = item.PartId > 0 ? $"/api/images/part/{item.PartId}" : null
                });
            }
            else
            {
                if (string.IsNullOrEmpty(existing.PartCode) && !string.IsNullOrEmpty(item.PartCode)) existing.PartCode = item.PartCode;
                if (string.IsNullOrEmpty(existing.PartName) && !string.IsNullOrEmpty(item.PartName)) existing.PartName = item.PartName;
            }
            if (isIn) { existing.InCount++; existing.TotalInQty += item.Qty; }
            else if (isOut) { existing.OutCount++; existing.TotalOutQty += item.Qty; }
            existing.FinalStock = bal;
        }
        // STORE-FG (StorePC live): the StorePC .exe also scans this stock, and every CHR-Nexus scan is mirrored into StorePC TRN_SCAN,
        // so its summary comes from StorePC (all IN / OUT of today, both programs) instead of CHR-Nexus rows only
        foreach (var st in stocks.Where(x => x.WritesStorePc))
        {
            List<SummaryRowDto> pc;
            try { pc = StorePcToday(st); }
            catch (Exception ex) { BugLog.Write("SCANNER", "WARN", $"StorePC summary: {ex.Message}", null, null, null, 0, null, null); continue; }
            summary.RemoveAll(x => x.StkId == st.StkId);
            summary.AddRange(pc);
            dto.Signature += "|pc" + pc.Sum(x => x.InCount + x.OutCount) + ":" + pc.Sum(x => x.FinalStock);
        }
        dto.Summary = summary;
        return dto;
    }

    private static List<SummaryRowDto> StorePcToday(StockModel st)
    {
        var list = new List<SummaryRowDto>();
        using var conn = new Microsoft.Data.SqlClient.SqlConnection(global::Nexus.Core.GlobalConfig.ConnStr);
        using var cmd = new Microsoft.Data.SqlClient.SqlCommand(@"
            SELECT ISNULL(MAX(v.PartID), -m.PT_ID) AS PartID, m.PT_CODE, m.PT_ACODE, m.PT_DESC, ISNULL(m.QTY_STK, 0) AS Bal,
                   SUM(CASE WHEN t.TX_TYPE IN ('IN', 'RETURN') THEN 1 ELSE 0 END) AS InN, SUM(CASE WHEN t.TX_TYPE IN ('IN', 'RETURN') THEN ISNULL(t.TX_QTY, 0) ELSE 0 END) AS InQ,
                   SUM(CASE WHEN t.TX_TYPE = 'OUT' THEN 1 ELSE 0 END) AS OutN, SUM(CASE WHEN t.TX_TYPE = 'OUT' THEN ISNULL(t.TX_QTY, 0) ELSE 0 END) AS OutQ,
                   MAX(t.TX_DATE) AS LastAt
            FROM StorePC.dbo.TRN_SCAN t
            JOIN StorePC.dbo.MST_PART m ON m.PT_ID = t.PT_ID
            LEFT JOIN Nexus.vw_StorePcLive v ON v.PT_ID = m.PT_ID
            WHERE t.TX_DATE >= CAST(CAST(GETDATE() AS DATE) AS DATETIME) AND t.TX_DATE < DATEADD(DAY, 1, CAST(CAST(GETDATE() AS DATE) AS DATETIME))
            GROUP BY m.PT_ID, m.PT_CODE, m.PT_ACODE, m.PT_DESC, m.QTY_STK
            ORDER BY MAX(t.TX_DATE) DESC", conn);
        conn.Open();
        using var r = cmd.ExecuteReader();
        while (r.Read())
        {
            int pid = Convert.ToInt32(r["PartID"]);
            string a = r["PT_ACODE"]?.ToString()?.Trim(), code = r["PT_CODE"]?.ToString()?.Trim();
            list.Add(new SummaryRowDto
            {
                PartId = pid, StkId = st.StkId, StockCode = st.Code, PartCode = code, PartName = r["PT_DESC"]?.ToString(),
                Code = string.IsNullOrEmpty(a) ? code : a, ImageUrl = pid > 0 ? $"/api/images/part/{pid}" : null,
                InCount = Convert.ToInt32(r["InN"]), TotalInQty = Convert.ToDecimal(r["InQ"]),
                OutCount = Convert.ToInt32(r["OutN"]), TotalOutQty = Convert.ToDecimal(r["OutQ"]), FinalStock = Convert.ToDecimal(r["Bal"])
            });
        }
        return list;
    }
}
