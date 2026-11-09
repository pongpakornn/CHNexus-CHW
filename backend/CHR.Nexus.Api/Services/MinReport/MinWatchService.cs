using Nexus.Helpers;
using Nexus.Services;

namespace CHR.Nexus.Api.Web;

// 📋 เฝ้าสินค้าที่อยู่ใต้ MIN ของคลังที่เปิด MIN REPORT (User Management > SETUP > MIN REPORT)
//   บันทึกช่วงที่ใต้ MIN ลง Nexus.MinWatch: เริ่ม (BelowSince) / ยังอยู่ (LastSeen) / พ้นแล้ว (ResolvedAt) -> แจ้งจอที่ฟังหัวข้อ minreport
//   แจ้งเตือน = ใต้ MIN "ต่อเนื่อง" ครบวันที่ตั้ง (กลับมาพ้น MIN = ปิดช่วง · ตกใต้ MIN อีก = เริ่มนับใหม่)
//   ⚡ เรียลไทม์: ยอดสินค้าเปลี่ยน (สแกน / แก้ / Import / StorePC Live) = เช็คใหม่ภายในไม่กี่วินาที -> กลับเป็นเขียว = หายจากหน้าต่างแจ้งเตือนทันที
//   ไม่มีการเปลี่ยนแปลง = เช็คทุก 5 นาที (เวลาเดิน = รายการที่เพิ่งครบวันขึ้นเอง) · ไม่ถี่กว่ารอบละ 5 วินาที (ไม่กวนฐานข้อมูล)
//   ไม่มีตาราง (ยังไม่รันสคริปต์ 19) = ไม่ทำอะไร · อ่านสถานะอย่างเดียว ไม่แก้ยอดสินค้า
public sealed class MinWatchService : BackgroundService
{
    private static readonly TimeSpan Every = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan Gap = TimeSpan.FromSeconds(5);
    private readonly ILogger<MinWatchService> _log;
    public MinWatchService(ILogger<MinWatchService> log) => _log = log;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        try { await Task.Delay(TimeSpan.FromSeconds(20), ct); } catch (OperationCanceledException) { return; }
        long seen = -1;
        var last = DateTime.MinValue;
        while (!ct.IsCancellationRequested)
        {
            long ver = LiveBus.DataVersion;   // ยอด / ตารางสินค้าเปลี่ยน (หัวข้อ data / store)
            if (ver != seen || DateTime.UtcNow - last >= Every)
            {
                seen = ver;
                last = DateTime.UtcNow;
                try
                {
                    if (DbSchema.HasMinReport && new MinReportService().Sweep() > 0) LiveBus.Publish("minreport");
                    // รายงานที่ส่งก่อนตั้ง FLOW ลายเซ็น -> เริ่ม FLOW + แจ้งคนเซ็นช่องแรก (Toast / กระดิ่ง / แชท)
                    if (DbSchema.HasMinSign && CHR.Nexus.Api.Controllers.MinReportController.StartUnflowed(null) > 0) LiveBus.Publish("minreport");
                }
                catch (Exception ex) { _log.LogDebug(ex, "MinWatch sweep"); } // รอบหน้าลองใหม่
            }
            try
            {
                await Task.Delay(Gap, ct);
                // รอจนมีการเปลี่ยนแปลง หรือครบรอบ 5 นาที
                var left = Every - (DateTime.UtcNow - last);
                if (LiveBus.DataVersion == seen && left > TimeSpan.Zero) await Task.WhenAny(LiveBus.Next(), Task.Delay(left, ct));
            }
            catch (OperationCanceledException) { return; }
        }
    }
}
