using CHR.Nexus.Api.Web;
using CHR.Nexus.Api.Web.Scanner;
using Nexus.Services;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Nexus.Api.Controllers;

// 🔔 กระดิ่งแจ้งเตือนมุมขวาบน: รวมเรื่องที่ต้องจัดการจากข้อมูลจริง ตามสิทธิ์ของผู้ใช้
//   MIN    = สินค้าต่ำกว่า MIN แยกคลัง (นับแบบเดียวกับการ์ด MIN ของ Dashboard)  - เห็นเฉพาะคลังที่มีสิทธิ์ดู
//   PR     = PR สถานะ Waiting (รออนุมัติ)                                      - สิทธิ์ PR: VIEW
//   DEDUCT = NOT DEDUCTED รอดำเนินการ (ปุ่ม NOT DEDUCTED ของ Multi-Scanner)       - สิทธิ์ Multi-Scanner: VIEW
[Route("api/notifications")]
public sealed class NotificationsController : AppController
{
    private static string TopicText(string topic) => topic switch
    {
        "PROBLEM" => "รายงานปัญหาการใช้งานระบบ",
        "UPDATE" => "แจ้งอัพเดทระบบ",
        "PERMISSION" => "ขอสิทธิ์การใช้งานระบบ",
        _ => topic
    };

    [HttpGet]
    public IActionResult Get()
    {
        if (Me == null) return Deny();
        var items = new List<object>();

        if (Me.CanViewStore || Me.CanViewDashboard)
        {
            var low = LiveCache.Get("stock-summaries", TimeSpan.FromSeconds(15), new DashboardService().GetStockSummaries)
                .Where(s => Me.CanViewStock(s.Stock) && s.MinCount > 0)
                .OrderByDescending(s => s.MinCount).ToList();
            if (low.Count > 0)
                items.Add(new
                {
                    key = "MIN", tone = "danger", title = "สินค้าต่ำกว่า MIN", count = low.Sum(s => s.MinCount),
                    detail = $"{low.Count} คลัง",
                    rows = low.Select(s => new { label = s.Stock.Code, sub = s.Stock.Name, count = s.MinCount, href = Me.CanViewStore ? $"/store?stk={s.Stock.StkId}&f=UNDER_MIN" : "/dashboard" })
                });
        }

        // 📋 MIN REPORT: สินค้าค้างที่ค่า MIN ครบตามวันที่ตั้ง และยังไม่มีใครรายงาน (คลังที่เปิด MIN REPORT ∩ คลังที่ดูได้)
        if (Me.CanViewStore && global::Nexus.Helpers.DbSchema.HasMinReport)
        {
            var mr = new MinReportService();
            var set = mr.GetSettings();
            if (set.Enabled && set.Stocks.Count > 0)
            {
                var stocks = new StockService().GetStocks().Where(s => set.Stocks.Contains(s.StkId) && Me.CanViewStock(s)).ToList();
                var pend = stocks.Count == 0 ? new List<MinWatchRow>() : mr.Pending(stocks.Select(s => s.StkId), set.StuckDays);
                if (pend.Count > 0)
                    items.Add(new
                    {
                        key = "MINREPORT", tone = "danger", title = "MIN REPORT รอรายงาน", count = pend.Count,
                        detail = $"ค้างที่ค่า MIN ≥ {set.StuckDays} วัน · ยังไม่ระบุสาเหตุ",
                        rows = pend.GroupBy(p => p.StockId).OrderByDescending(g => g.Count())
                                   .Select(g => new { label = g.First().StockCode, sub = $"นานสุด {g.Max(x => x.Days):0.#} วัน · กดเพื่อ REPORT", count = g.Count(), href = $"/store?stk={g.Key}&mr=pending" })
                    });
            }
        }

        // ✍ MIN REPORT รอฉันลงลายเซ็น (ชั่วคราว: เซ็นแล้ว = หายไปเอง) · กดรายการ = เปิดเอกสารใบนั้นให้เซ็นทันที
        if (global::Nexus.Helpers.DbSchema.HasMinSign)
        {
            var mine = new MinReportService().Queue(Uid);
            if (mine.Count > 0)
                items.Add(new
                {
                    key = "MINSIGN", tone = "warning", title = "MIN REPORT รอลงลายเซ็น", count = mine.Count,
                    detail = "กดรายการ = เปิดเอกสาร แล้วกดช่องของคุณ",
                    rows = mine.Take(10).Select(r => new
                    {
                        label = $"{r.StockCode} · {(string.IsNullOrWhiteSpace(r.Title) ? r.PartName : r.Title)}",
                        sub = $"ช่อง {MinReportService.SlotName(r.NextSlot ?? 0)} · จาก {r.ReporterName ?? r.ReportedBy}",
                        count = 1, href = $"#minsign:{r.ReportId}"
                    })
                });
        }

        if (Me.CanViewPR)
        {
            var waiting = LiveCache.Get("pr-list", TimeSpan.FromSeconds(15), () => new PRService().GetPRList("", null)).Where(p => string.Equals(p.Status, "Waiting", StringComparison.OrdinalIgnoreCase)).ToList();
            if (waiting.Count > 0)
                items.Add(new
                {
                    key = "PR", tone = "warning", title = "PR รออนุมัติ", count = waiting.Count,
                    detail = $"ล่าสุด {waiting.Max(p => p.PRDate):dd/MM/yyyy HH:mm}",
                    rows = waiting.OrderByDescending(p => p.PRDate).Take(5)
                                  .Select(p => new { label = p.PRNumber, sub = p.PartName, count = p.QTY, href = "/pr" })
                });
        }

        if (Me.CanViewScannerMenu)
        {
            int n = new DeductMissService().Count(new ScannerScope(Me, null).DeductStockIds);
            if (n > 0)
                items.Add(new
                {
                    key = "DEDUCT", tone = "info", title = "NOT DEDUCTED รอดำเนินการ", count = n,
                    detail = "ป้ายที่ยังตัดสต็อกไม่ได้",
                    rows = new[] { new { label = "เปิด Multi-Scanner", sub = "ปุ่ม NOT DEDUCTED", count = n, href = "/scanner" } }
                });
        }

        // 💬 แชทแจ้ง Admin: Admin = เรื่องที่ผู้ใช้ส่งมายังไม่ได้อ่าน · ผู้ใช้ = Admin ตอบแล้วยังไม่ได้อ่าน
        if (global::Nexus.Helpers.DbSchema.HasSupport)
        {
            bool admin = Me.IsMasterAdmin || Me.CanSetPermissions;
            var unread = new SupportService().Threads(Me.UserId, admin)
                .Where(t => SupportService.Unread(t, admin && t.UserId != Me.UserId)).ToList();
            if (unread.Count > 0)
                items.Add(new
                {
                    key = "SUPPORT", tone = "accent", title = admin ? "ข้อความแจ้ง Admin ใหม่" : "Admin ตอบกลับแล้ว", count = unread.Count,
                    detail = "แชทแจ้ง Admin",
                    rows = unread.Take(5).Select(t => new { label = admin ? t.UserName : TopicText(t.Topic), sub = t.LastBody.Length > 40 ? t.LastBody[..40] + "…" : t.LastBody, count = 1, href = $"#support:{t.ThreadId}" })
                });
        }

        // 💬 แชทระหว่างผู้ใช้: ข้อความที่ส่งถึงฉันแล้วยังไม่ได้อ่าน
        if (global::Nexus.Helpers.DbSchema.HasChat)
        {
            var convs = new ChatService().Conversations(Me.UserId).Where(c => c.Unread > 0).ToList();
            if (convs.Count > 0)
                items.Add(new
                {
                    key = "CHAT", tone = "info", title = "ข้อความแชทใหม่", count = convs.Sum(c => c.Unread),
                    detail = $"{convs.Count} คน",
                    rows = convs.Take(5).Select(c => new { label = c.Name, sub = c.Last.Length > 40 ? c.Last[..40] + "…" : c.Last, count = c.Unread, href = $"#chat:{c.UserId}" })
                });
        }

        return Ok(new { total = items.Count, items, time = DateTime.Now.ToString("HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture) });
    }
}
