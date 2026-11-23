using System.Globalization;
using System.Text.RegularExpressions;
using CHR.Nexus.Api.Web;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Nexus.Core;
using Nexus.Helpers;
using Nexus.Services;

namespace CHR.Nexus.Api.Controllers;

// ⏸ MASTER DATA › COMPANY WORKDAYS › BREAK TIMES (Master.CompanyBreaks, script 71)
//   Break / pause times per shift: production time counting stops inside these ranges (used by the coming production system)
//   Same rights as the workday calendar: VIEW / EDIT of Max-Min Calculator · every write goes to Activity Log
[Route("api/maxmin/workdays/breaks")]
public sealed class BreakTimeController : AppController
{
    private static readonly string[] Shifts = { "DAY", "NIGHT", "ALL" };
    private static SqlConnection Conn() => new(GlobalConfig.ConnStr);
    private IActionResult NotReady() => Fail("ฐานข้อมูลยังไม่มีตารางเวลาพัก (database/nexus/71_Master_Machine_Mold_Breaks.sql)");

    public sealed class BreakRow
    {
        public int Id { get; set; }
        public string Name { get; set; }
        public string Shift { get; set; }
        public TimeSpan Start { get; set; }
        public TimeSpan End { get; set; }
        public bool IsActive { get; set; }
        public string UpdatedBy { get; set; }
        public DateTime UpdatedDate { get; set; }
    }

    private const string Sql = "SELECT BreakID AS Id, BreakName AS Name, Shift, StartTime AS Start, EndTime AS [End], IsActive, UpdatedBy, UpdatedDate FROM Master.CompanyBreaks ";
    private static string Hm(TimeSpan t) => t.ToString(@"hh\:mm", CultureInfo.InvariantCulture);
    private static object Dto(BreakRow r) => new { r.Id, r.Name, r.Shift, start = Hm(r.Start), end = Hm(r.End), r.IsActive, r.UpdatedBy, r.UpdatedDate };

    [HttpGet]
    public IActionResult List()
    {
        if (Me?.CanViewMaxMinCalc != true) return Deny();
        if (!DbSchema.HasCompanyBreaks) return NotReady();
        using var c = Conn();
        var rows = c.Query<BreakRow>(Sql + "ORDER BY CASE Shift WHEN 'DAY' THEN 0 WHEN 'NIGHT' THEN 1 ELSE 2 END, StartTime").Select(Dto);
        return Ok(new { canEdit = Me.CanEditMaxMinCalc, rows });
    }

    public sealed record BreakRequest(string Name, string Shift, string Start, string End, bool? IsActive);

    private static (BreakRow Row, string Error) Clean(BreakRequest q)
    {
        var r = new BreakRow { Name = Regex.Replace((q?.Name ?? "").Trim(), @"\s+", " "), Shift = (q?.Shift ?? "").ToUpperInvariant(), IsActive = q?.IsActive ?? true };
        if (r.Name.Length == 0) return (r, "กรุณากรอกชื่อเวลาพัก (เช่น พักเที่ยง)");
        if (r.Name.Length > 100) return (r, "ชื่อเวลาพักยาวเกิน 100 ตัวอักษร");
        if (!Shifts.Contains(r.Shift)) return (r, "กรุณาเลือกกะ (DAY / NIGHT / ALL)");
        if (!TimeSpan.TryParseExact(q?.Start ?? "", @"hh\:mm", CultureInfo.InvariantCulture, out var s)) return (r, "กรุณาเลือกเวลาเริ่ม");
        if (!TimeSpan.TryParseExact(q?.End ?? "", @"hh\:mm", CultureInfo.InvariantCulture, out var e)) return (r, "กรุณาเลือกเวลาสิ้นสุด");
        if (s == e) return (r, "เวลาเริ่มกับเวลาสิ้นสุดต้องไม่เท่ากัน");
        (r.Start, r.End) = (s, e);
        return (r, null);
    }

    [HttpPost]
    public IActionResult Add([FromBody] BreakRequest req) => Save(0, req);

    [HttpPut("{id:int}")]
    public IActionResult Edit(int id, [FromBody] BreakRequest req) => Save(id, req);

    private IActionResult Save(int id, BreakRequest req)
    {
        if (Me?.CanEditMaxMinCalc != true) return Deny();
        if (!DbSchema.HasCompanyBreaks) return NotReady();
        var (r, err) = Clean(req);
        if (err != null) return Fail(err);
        try
        {
            using var c = Conn();
            var old = id == 0 ? null : c.QueryFirstOrDefault<BreakRow>(Sql + "WHERE BreakID = @id", new { id });
            if (id != 0 && old == null) return Fail("ไม่พบเวลาพักนี้ (อาจถูกลบไปแล้ว)");
            var p = new { id, r.Name, r.Shift, r.Start, r.End, r.IsActive, uid = Uid };
            if (id == 0)
                c.Execute(@"INSERT INTO Master.CompanyBreaks (BreakName, Shift, StartTime, EndTime, IsActive, CreatedBy, UpdatedBy)
                            VALUES (@Name, @Shift, @Start, @End, @IsActive, @uid, @uid)", p);
            else
                c.Execute(@"UPDATE Master.CompanyBreaks SET BreakName = @Name, Shift = @Shift, StartTime = @Start, EndTime = @End, IsActive = @IsActive,
                                   UpdatedBy = @uid, UpdatedDate = GETDATE() WHERE BreakID = @id", p);
            string now = $"{r.Name} | {r.Shift} {Hm(r.Start)}-{Hm(r.End)} | {(r.IsActive ? "ACTIVE" : "INACTIVE")}";
            LogService.WriteLog(Uid, old == null ? "WORKDAY_BREAK_ADD" : "WORKDAY_BREAK_EDIT",
                old == null ? "Break: " + now : $"Break: {old.Name} | {old.Shift} {Hm(old.Start)}-{Hm(old.End)} | {(old.IsActive ? "ACTIVE" : "INACTIVE")} > {now}", r.Name);
            return Ok(new { message = old == null ? $"เพิ่มเวลาพัก {r.Name} แล้ว" : $"บันทึกเวลาพัก {r.Name} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    [HttpDelete("{id:int}")]
    public IActionResult Delete(int id)
    {
        if (Me?.CanEditMaxMinCalc != true) return Deny();
        if (!DbSchema.HasCompanyBreaks) return NotReady();
        try
        {
            using var c = Conn();
            var old = c.QueryFirstOrDefault<BreakRow>(Sql + "WHERE BreakID = @id", new { id });
            if (old == null) return Fail("ไม่พบเวลาพักนี้ (อาจถูกลบไปแล้ว)");
            c.Execute("DELETE FROM Master.CompanyBreaks WHERE BreakID = @id", new { id });
            LogService.WriteLog(Uid, "WORKDAY_BREAK_DELETE", $"Break: {old.Name} | {old.Shift} {Hm(old.Start)}-{Hm(old.End)}", old.Name);
            return Ok(new { message = $"ลบเวลาพัก {old.Name} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "ลบไม่สำเร็จ"); }
    }
}
