using Nexus.Helpers;
using Nexus.Services;

namespace CHR.Nexus.Api.Web;

// 📋 เฝ้าสินค้าที่อยู่ใต้ MIN ของคลังที่เปิด MIN REPORT (User Management > SETUP > MIN REPORT)
//   ทุก 5 นาที: บันทึกช่วงที่ใต้ MIN ลง Nexus.MinWatch (เริ่ม / ยังอยู่ / พ้นแล้ว) -> แจ้งจอที่ฟังหัวข้อ minreport
//   ไม่มีตาราง (ยังไม่รันสคริปต์ 19) = ไม่ทำอะไร · อ่านสถานะอย่างเดียว ไม่แก้ยอดสินค้า
public sealed class MinWatchService : BackgroundService
{
    private readonly ILogger<MinWatchService> _log;
    public MinWatchService(ILogger<MinWatchService> log) => _log = log;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        try { await Task.Delay(TimeSpan.FromSeconds(20), ct); } catch (OperationCanceledException) { return; }
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (DbSchema.HasMinReport && new MinReportService().Sweep() > 0) LiveBus.Publish("minreport");
                // รายงานที่ส่งก่อนตั้ง FLOW ลายเซ็น -> เริ่ม FLOW + แจ้งคนเซ็นช่องแรก (Toast / กระดิ่ง / แชท)
                if (DbSchema.HasMinSign && CHR.Nexus.Api.Controllers.MinReportController.StartUnflowed(null) > 0) LiveBus.Publish("minreport");
            }
            catch (Exception ex) { _log.LogDebug(ex, "MinWatch sweep"); } // รอบหน้าลองใหม่
            try { await Task.Delay(TimeSpan.FromMinutes(5), ct); } catch (OperationCanceledException) { return; }
        }
    }
}
