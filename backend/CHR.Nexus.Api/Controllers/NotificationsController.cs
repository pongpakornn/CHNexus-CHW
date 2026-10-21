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
    [HttpGet]
    public IActionResult Get()
    {
        if (Me == null) return Deny();
        var items = new List<object>();

        if (Me.CanViewStore || Me.CanViewDashboard)
        {
            var low = new DashboardService().GetStockSummaries()
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

        if (Me.CanViewPR)
        {
            var waiting = new PRService().GetPRList("", null).Where(p => string.Equals(p.Status, "Waiting", StringComparison.OrdinalIgnoreCase)).ToList();
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

        return Ok(new { total = items.Count, items, time = DateTime.Now.ToString("HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture) });
    }
}
