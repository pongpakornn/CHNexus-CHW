using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;
using Nexus.Helpers;

namespace Nexus.Services;

// 📈 PRODUCTION PLAN (schema ProductionPlan ในฐาน CHR-Nexus) · Capacity Planning แทน Excel "PRESS 1 CAPACITY PLANNING"
//   Server ส่งข้อมูลดิบของเดือนครั้งเดียว (เครื่อง + STD + Product + PCS + Actual + วันทำงาน) -> หน้าเว็บคำนวณสูตร C / P / A เอง (ตรงกับ Excel ทุกข้อ)
//   PCS = Order ของเดือน (มี Order) ไม่มี Order = Forecast · ตาม PART A (Nexus.ForecastOrderImports · อ่านอย่างเดียว)
//   C1 = MASTER DATA › Company Workdays (#COMPANY) · ยังไม่ได้ตั้งเดือนนั้น = จันทร์-เสาร์ (แจ้งที่หน้าเว็บ)

public sealed class PpMachine
{
    public int Id { get; set; }
    public string Dept { get; set; }
    public string Code { get; set; }
    public string Group { get; set; }
    public string SubGroup { get; set; }
    public int Sort { get; set; }
    public decimal Qty { get; set; }
    public decimal Eff { get; set; }
    public decimal Man { get; set; }
    public decimal? Sph { get; set; }
    public bool ByPcs { get; set; }       // Stroke = PCS ÷ Pcs./Stroke (เครื่อง Transfer)
    public bool Active { get; set; }
    public int Parts { get; set; }
    public DateTime? FromMonth { get; set; }   // ใช้ตั้งแต่เดือน (ว่าง = ทุกเดือน) · เช่น เครื่องที่ย้าย / เลิกใช้กลางปี
    public DateTime? ToMonth { get; set; }     // ใช้ถึงเดือน (ว่าง = ปัจจุบัน)
    public bool InMonth(DateTime m) => (FromMonth == null || FromMonth <= m) && (ToMonth == null || ToMonth >= m);
    public string UpdatedBy { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class PpPart
{
    public int Id { get; set; }
    public int MachineId { get; set; }
    public int Sort { get; set; }
    public int PartAId { get; set; }
    public string PartA { get; set; }        // PART A (A974-00001)
    public string PdCode { get; set; }       // PRODUCT CODE ของ STORE-FG (เดิม STORE-PC)
    public string Customer { get; set; }
    public int? PartBId { get; set; }
    public string PartB { get; set; }        // PART B (B171-00012) / ชิ้นเดียวกับ PART A
    public string Name { get; set; }
    public string Process { get; set; }
    public decimal Tp { get; set; }
    public decimal Col { get; set; }
    public decimal Ct { get; set; }
    public decimal? Man { get; set; }
    public bool Active { get; set; }
    public decimal Pcs { get; set; }
    public string PcsFrom { get; set; }      // ORDER / FORECAST / MANUAL / ""
    public decimal? PcsAuto { get; set; }    // PCS จาก Order / Forecast (เมื่อกำหนดเองที่เดือนนั้น = MANUAL)
    public DateTime? FromMonth { get; set; } // แถว Product ใช้ตั้งแต่เดือน / ถึงเดือน (ว่าง = ทุกเดือน) เช่น ชิ้นงานที่ย้ายเครื่อง / เลิกผลิต
    public DateTime? ToMonth { get; set; }
    public bool InMonth(DateTime m) => (FromMonth == null || FromMonth <= m) && (ToMonth == null || ToMonth >= m);
}

public sealed class PpActual
{
    public int MachineId { get; set; }
    public int Day { get; set; }
    public decimal? Hr { get; set; }
    public decimal? Stroke { get; set; }
    public decimal? Man { get; set; }
}

// 📸 แผนของเดือนที่ปิดแล้วตามไฟล์ Excel ของหน่วยงาน (มี = หน้าเว็บใช้ค่านี้แทนการคำนวณจาก PCS × ตาราง Product)
public sealed class PpSnap
{
    public int MachineId { get; set; }
    public decimal P1 { get; set; }       // Stroke/Month ตาม Excel
    public decimal? C3 { get; set; }      // SPH 100%
    public decimal? Qty { get; set; }     // C2
    public decimal? Eff { get; set; }     // C4
    public decimal? Man { get; set; }     // P7
    public string Source { get; set; }    // ชื่อไฟล์ Excel
}

public sealed class PpShift
{
    public int Id { get; set; }
    public string Name { get; set; }
    public decimal Hours { get; set; }
    public int Sort { get; set; }
}

public sealed class ProductionPlanService
{
    public const string DefaultDept = "PRESS1";
    private static SqlConnection Conn() => new(GlobalConfig.ConnStr);

    public static string Dept(string d) => string.IsNullOrWhiteSpace(d) ? DefaultDept : d.Trim().ToUpperInvariant();

    // ---------------------------------------------------------------- ค่า STD
    //   month = เฉพาะเครื่องที่ใช้งานในเดือนนั้น (FromMonth ≤ เดือน ≤ ToMonth) เช่น Dashboard / Capacity ของเดือนย้อนหลัง
    public List<PpMachine> Machines(string dept, bool activeOnly, DateTime? month = null)
    {
        string range = DbSchema.HasPpMachineRange ? "m.FromMonth, m.ToMonth," : "";
        using var c = Conn();
        var list = c.Query<PpMachine>($@"
            SELECT m.MachineID AS Id, m.Dept, m.MachineCode AS Code, m.GroupName AS [Group], m.SubGroup, m.SortNo AS Sort, m.QtyLine AS Qty,
                   m.TargetEff AS Eff, m.ManPower AS Man, m.SphOverride AS Sph, m.StrokeByPcs AS ByPcs, m.IsActive AS Active, {range} m.UpdatedBy, m.UpdatedAt,
                   (SELECT COUNT(*) FROM ProductionPlan.MachineParts p WHERE p.MachineID = m.MachineID AND p.IsActive = 1) AS Parts
            FROM ProductionPlan.Machines m
            WHERE m.Dept = @dept AND (@all = 1 OR m.IsActive = 1)
            ORDER BY m.SortNo, m.MachineCode", new { dept, all = activeOnly ? 0 : 1 }).ToList();
        if (month is DateTime mm) { var m1 = new DateTime(mm.Year, mm.Month, 1); list = list.Where(x => x.InMonth(m1)).ToList(); }
        return list;
    }

    public List<PpShift> Shifts()
    {
        using var c = Conn();
        return c.Query<PpShift>("SELECT ShiftID AS Id, ShiftName AS Name, Hours, SortNo AS Sort FROM ProductionPlan.ShiftHours ORDER BY SortNo, ShiftID").ToList();
    }

    public Dictionary<string, decimal> Settings()
    {
        using var c = Conn();
        var d = c.Query<(string K, decimal V)>("SELECT SettingKey, SettingValue FROM ProductionPlan.Settings").ToDictionary(x => x.K, x => x.V);
        d.TryAdd("ManHourFactor", 1.023m);
        d.TryAdd("ManHourPerDay", 11m);
        return d;
    }

    public sealed record MachineForm(int Id, string Dept, string Code, string Group, string SubGroup, int Sort, decimal Qty, decimal Eff, decimal Man, decimal? Sph, bool ByPcs, bool Active,
                                     string From = null, string To = null);

    // "2026-01" -> 1 ม.ค. 2026 · ว่าง = null
    private static DateTime? MonthKey(string s) =>
        DateTime.TryParseExact((s ?? "").Trim() + "-01", "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var d) ? d : null;

    // field rules (no DB) - shared by SaveMachine and the Excel import preview
    public static void ValidateMachine(MachineForm f)
    {
        string code = (f.Code ?? "").Trim(), grp = (f.Group ?? "").Trim();
        if (code.Length == 0) throw new InvalidOperationException("กรุณากรอกชื่อเครื่องจักร");
        if (grp.Length == 0) throw new InvalidOperationException("กรุณากรอก GROUP");
        if (f.Qty <= 0) throw new InvalidOperationException("Q'ty Line or MC ต้องมากกว่า 0");
        if (f.Eff <= 0 || f.Eff > 1.5m) throw new InvalidOperationException("Target Eff ต้องอยู่ระหว่าง 1 - 150 %");
        if (f.Man < 0) throw new InvalidOperationException("STD Man Power ติดลบไม่ได้");
        if (f.Sph is <= 0) throw new InvalidOperationException("SPH 100% ต้องมากกว่า 0 (เว้นว่าง = คำนวณจากตาราง Product)");
        DateTime? from = MonthKey(f.From), to = MonthKey(f.To);
        if (from != null && to != null && to < from) throw new InvalidOperationException("ใช้ถึงเดือน ต้องไม่ก่อน ใช้ตั้งแต่เดือน");
    }

    // cn / t = run inside the caller's transaction (Excel import) · null = own connection (screens)
    public int SaveMachine(MachineForm f, string uid, SqlConnection cn = null, SqlTransaction t = null)
    {
        ValidateMachine(f);
        string code = (f.Code ?? "").Trim(), grp = (f.Group ?? "").Trim().ToUpperInvariant();
        DateTime? from = MonthKey(f.From), to = MonthKey(f.To);
        using var own = cn == null ? Conn() : null;
        var c = cn ?? own;
        var p = new { id = f.Id, dept = Dept(f.Dept), code, grp, sub = string.IsNullOrWhiteSpace(f.SubGroup) ? null : f.SubGroup.Trim(), sort = f.Sort, qty = f.Qty, eff = f.Eff, man = f.Man, sph = f.Sph, pcs = f.ByPcs, act = f.Active, uid };
        if (c.ExecuteScalar<int>("SELECT COUNT(*) FROM ProductionPlan.Machines WHERE Dept = @dept AND MachineCode = @code AND MachineID <> @id", p, t) > 0)
            throw new InvalidOperationException($"มีเครื่องจักร {code} อยู่แล้ว");
        int id = f.Id > 0
            ? c.ExecuteScalar<int>(@"UPDATE ProductionPlan.Machines SET MachineCode = @code, GroupName = @grp, SubGroup = @sub, SortNo = @sort, QtyLine = @qty, TargetEff = @eff,
                                         ManPower = @man, SphOverride = @sph, StrokeByPcs = @pcs, IsActive = @act, UpdatedBy = @uid, UpdatedAt = GETDATE() WHERE MachineID = @id; SELECT @id;", p, t)
            : c.ExecuteScalar<int>(@"INSERT INTO ProductionPlan.Machines (Dept, MachineCode, GroupName, SubGroup, SortNo, QtyLine, TargetEff, ManPower, SphOverride, StrokeByPcs, IsActive, CreatedBy, UpdatedBy)
                                     VALUES (@dept, @code, @grp, @sub, @sort, @qty, @eff, @man, @sph, @pcs, 1, @uid, @uid); SELECT CAST(SCOPE_IDENTITY() AS INT);", p, t);
        if (DbSchema.HasPpMachineRange)
            c.Execute("UPDATE ProductionPlan.Machines SET FromMonth = @from, ToMonth = @to WHERE MachineID = @id", new { id, from, to }, t);
        return id;
    }

    // ลบเครื่อง: มี Actual ที่บันทึกแล้ว = ลบไม่ได้ (เปลี่ยนเป็น INACTIVE แทน)
    public string DeleteMachine(int id)
    {
        using var c = Conn();
        string code = c.ExecuteScalar<string>("SELECT MachineCode FROM ProductionPlan.Machines WHERE MachineID = @id", new { id }) ?? throw new InvalidOperationException("ไม่พบเครื่องจักร");
        if (c.ExecuteScalar<int>("SELECT COUNT(*) FROM ProductionPlan.DailyActuals WHERE MachineID = @id", new { id }) > 0)
            throw new InvalidOperationException($"{code} มี Actual ที่บันทึกไว้แล้ว ลบไม่ได้ · เปลี่ยนเป็น INACTIVE แทน");
        c.Open();
        using var t = c.BeginTransaction();
        c.Execute("DELETE FROM ProductionPlan.MachineParts WHERE MachineID = @id; DELETE FROM ProductionPlan.Machines WHERE MachineID = @id;", new { id }, t);
        t.Commit();
        return code;
    }

    public static void ValidateShift(PpShift s)
    {
        if (string.IsNullOrWhiteSpace(s.Name)) throw new InvalidOperationException("กรุณากรอกชื่อ Plan SPH");
        if (s.Hours <= 0 || s.Hours > 24) throw new InvalidOperationException($"{s.Name}: ชั่วโมงต้องอยู่ระหว่าง 0 - 24");
    }

    public void SaveShifts(IEnumerable<PpShift> list, string uid, SqlConnection cn = null, SqlTransaction tx = null)
    {
        var rows = list.ToList();
        if (rows.Count == 0) throw new InvalidOperationException("ไม่มีข้อมูล");
        foreach (var s in rows) ValidateShift(s);
        using var own = cn == null ? Conn() : null;
        own?.Open();
        var c = cn ?? own;
        using var ownT = tx == null ? c.BeginTransaction() : null;
        foreach (var s in rows)
            c.Execute(@"UPDATE ProductionPlan.ShiftHours SET ShiftName = @Name, Hours = @Hours, UpdatedBy = @uid, UpdatedAt = GETDATE() WHERE ShiftID = @Id",
                      new { s.Name, s.Hours, s.Id, uid }, tx ?? ownT);
        ownT?.Commit();
    }

    public static void ValidateSettings(decimal factor, decimal perDay)
    {
        if (factor <= 0 || factor > 5) throw new InvalidOperationException("ตัวคูณ Man Hour ต้องอยู่ระหว่าง 0 - 5");
        if (perDay <= 0 || perDay > 24) throw new InvalidOperationException("ชั่วโมง / คน / วัน ต้องอยู่ระหว่าง 0 - 24");
    }

    public void SaveSettings(decimal factor, decimal perDay, string uid, SqlConnection cn = null, SqlTransaction t = null)
    {
        ValidateSettings(factor, perDay);
        using var own = cn == null ? Conn() : null;
        var c = cn ?? own;
        c.Execute(@"UPDATE ProductionPlan.Settings SET SettingValue = @factor, UpdatedBy = @uid, UpdatedAt = GETDATE() WHERE SettingKey = 'ManHourFactor';
                    UPDATE ProductionPlan.Settings SET SettingValue = @perDay, UpdatedBy = @uid, UpdatedAt = GETDATE() WHERE SettingKey = 'ManHourPerDay';",
                  new { factor, perDay, uid }, t);
    }

    // ---------------------------------------------------------------- ตาราง Product ของเครื่อง
    private static string PartSql => @"
        SELECT " + (DbSchema.HasPpMachineRange ? "x.FromMonth, x.ToMonth, " : "") + @"x.ItemID AS Id, x.MachineID AS MachineId, x.SortNo AS Sort, x.PartAID AS PartAId, LTRIM(RTRIM(ISNULL(a.PartA, ''))) AS PartA, a.PartCode AS PdCode,
               ISNULL(a.Customer, '') AS Customer, x.PartBID AS PartBId,
               COALESCE(NULLIF(LTRIM(RTRIM(b.PartB)), ''), NULLIF(LTRIM(RTRIM(b.PartA)), ''), b.PartCode) AS PartB,
               COALESCE(NULLIF(LTRIM(RTRIM(b.Description)), ''), a.Description) AS Name,
               x.ProcessCode AS Process, x.TotalProcess AS Tp, x.PcsPerStroke AS Col, x.CycleTime AS Ct, x.StdMan AS Man, x.IsActive AS Active
        FROM ProductionPlan.MachineParts x
        JOIN Nexus.Parts a ON a.PartID = x.PartAID
        LEFT JOIN Nexus.Parts b ON b.PartID = x.PartBID";

    // 📸 แผนตาม Excel ของเดือน (MachineID -> P1 / C3 / C2 / C4 / P7)
    private static Dictionary<int, PpSnap> Snaps(SqlConnection c, DateTime month, int[] ids)
    {
        if (!DbSchema.HasPpMonthPlan || ids.Length == 0) return new();
        var m = new DateTime(month.Year, month.Month, 1);
        return c.Query<PpSnap>(@"SELECT MachineID AS MachineId, P1, C3, QtyLine AS Qty, TargetEff AS Eff, ManPower AS Man, Source
                                 FROM ProductionPlan.MonthPlans WHERE MonthStart = @m AND MachineID IN @ids", new { m, ids })
                .ToDictionary(x => x.MachineId);
    }

    // PCS ของเดือน ตาม PART A: มี Order = Order · ไม่มี = Forecast (รวมทุกลูกค้า)
    private static Dictionary<string, (decimal F, decimal O)> Demand(SqlConnection c, DateTime month)
    {
        var m = new DateTime(month.Year, month.Month, 1);
        return c.Query<(string K, decimal F, decimal O)>(@"
                SELECT LTRIM(RTRIM(PartACode)) AS K, SUM(ISNULL(ForecastQuantity, 0)) AS F, SUM(ISNULL(OrderQuantity, 0)) AS O
                FROM Nexus.ForecastOrderImports WITH (NOLOCK)
                WHERE TargetDate >= @m AND TargetDate < DATEADD(MONTH, 1, @m) AND ISNULL(PartACode, '') <> ''
                GROUP BY LTRIM(RTRIM(PartACode))", new { m })
            .GroupBy(x => x.K, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => (g.Sum(x => x.F), g.Sum(x => x.O)), StringComparer.OrdinalIgnoreCase);
    }

    // PCS ที่กำหนดเองของเดือน (ItemID -> PCS) เช่น Excel พิมพ์ 0 ให้แถวที่ผลิตที่เครื่องอื่นแล้ว
    private static Dictionary<int, decimal> Overrides(SqlConnection c, DateTime month)
    {
        if (!DbSchema.HasPpPcsOverride) return new();
        var m = new DateTime(month.Year, month.Month, 1);
        return c.Query<(int I, decimal P)>("SELECT ItemID AS I, Pcs AS P FROM ProductionPlan.PcsOverrides WHERE MonthStart = @m", new { m })
                .ToDictionary(x => x.I, x => x.P);
    }

    private static void FillPcs(IEnumerable<PpPart> parts, Dictionary<string, (decimal F, decimal O)> dm, Dictionary<int, decimal> ov = null)
    {
        foreach (var p in parts)
        {
            if (!string.IsNullOrEmpty(p.PartA) && dm.TryGetValue(p.PartA, out var v))
            {
                if (v.O > 0) { p.Pcs = v.O; p.PcsFrom = "ORDER"; }
                else if (v.F > 0) { p.Pcs = v.F; p.PcsFrom = "FORECAST"; }
                else p.PcsFrom = "";
            }
            else p.PcsFrom = "";
            if (ov != null && ov.TryGetValue(p.Id, out var set)) { p.PcsAuto = p.Pcs; p.Pcs = set; p.PcsFrom = "MANUAL"; }
        }
    }

    // ✏ PCS ของแถว Product เฉพาะเดือน · null = กลับไปใช้ Order / Forecast
    public string SetPcs(DateTime month, int itemId, decimal? pcs, string uid)
    {
        using var c = Conn();
        return SetPcs(c, null, month, itemId, pcs, uid);
    }

    // Excel import: every row in one transaction (all or nothing) · same SQL as SetPcs
    public void SetPcsBatch(DateTime month, IEnumerable<(int ItemId, decimal? Pcs)> rows, string uid)
    {
        using var c = Conn();
        c.Open();
        using var t = c.BeginTransaction();
        foreach (var (itemId, pcs) in rows) SetPcs(c, t, month, itemId, pcs, uid);
        t.Commit();
    }

    private static string SetPcs(SqlConnection c, SqlTransaction t, DateTime month, int itemId, decimal? pcs, string uid)
    {
        if (pcs is < 0 or > 99_999_999) throw new InvalidOperationException("PCS ต้องอยู่ระหว่าง 0 - 99,999,999");
        var m = new DateTime(month.Year, month.Month, 1);
        var label = c.QueryFirstOrDefault<string>(@"SELECT m.MachineCode + ' | ' + ISNULL(a.PartA, a.PartCode) FROM ProductionPlan.MachineParts x
                                                    JOIN ProductionPlan.Machines m ON m.MachineID = x.MachineID JOIN Nexus.Parts a ON a.PartID = x.PartAID WHERE x.ItemID = @itemId", new { itemId }, t)
                    ?? throw new InvalidOperationException("ไม่พบรายการ");
        if (pcs == null)
            c.Execute("DELETE FROM ProductionPlan.PcsOverrides WHERE MonthStart = @m AND ItemID = @itemId", new { m, itemId }, t);
        else
            c.Execute(@"UPDATE ProductionPlan.PcsOverrides SET Pcs = @pcs, UpdatedBy = @uid, UpdatedAt = GETDATE() WHERE MonthStart = @m AND ItemID = @itemId;
                        IF @@ROWCOUNT = 0 INSERT INTO ProductionPlan.PcsOverrides (MonthStart, ItemID, Pcs, UpdatedBy) VALUES (@m, @itemId, @pcs, @uid);", new { m, itemId, pcs, uid }, t);
        return label;
    }

    // 📄 PCS TEMPLATE / IMPORT: ทุกแถว Product ของหน่วยงาน (เครื่องที่ใช้งาน) + PCS ของเดือน (AUTO / กำหนดเอง)
    public List<(PpMachine Machine, PpPart Part)> DeptParts(string dept, DateTime month)
    {
        var ms = Machines(dept, activeOnly: true, month);
        var ids = ms.Select(x => x.Id).ToArray();
        if (ids.Length == 0) return new();
        var m = new DateTime(month.Year, month.Month, 1);
        using var c = Conn();
        var parts = c.Query<PpPart>(PartSql + " WHERE x.MachineID IN @ids AND x.IsActive = 1 ORDER BY x.MachineID, x.SortNo, x.ItemID", new { ids }).Where(p => p.InMonth(m)).ToList();
        FillPcs(parts, Demand(c, m), Overrides(c, m));
        return ms.SelectMany(mc => parts.Where(p => p.MachineId == mc.Id).Select(p => (mc, p))).ToList();
    }

    public List<PpPart> Parts(int machineId, DateTime month)
    {
        using var c = Conn();
        var m = new DateTime(month.Year, month.Month, 1);
        // เฉพาะแถวที่ใช้ในเดือนที่เลือก (แถวของเดือนเก่าจาก Excel มี FromMonth / ToMonth)
        var list = c.Query<PpPart>(PartSql + " WHERE x.MachineID = @machineId ORDER BY x.SortNo, x.ItemID", new { machineId }).Where(p => p.InMonth(m)).ToList();
        FillPcs(list, Demand(c, month), Overrides(c, month));
        return list;
    }

    public sealed record PartForm(int Id, int MachineId, int Sort, int PartAId, int? PartBId, string Process, decimal Tp, decimal Col, decimal Ct, decimal? Man, bool Active);

    // field rules (no DB) - shared by SavePart and the Excel import preview
    public static void ValidatePart(PartForm f)
    {
        if (f.MachineId <= 0) throw new InvalidOperationException("กรุณาเลือกเครื่องจักร");
        if (f.PartAId <= 0) throw new InvalidOperationException("กรุณาเลือก PART A (STORE-FG)");
        if (f.Tp <= 0) throw new InvalidOperationException("Total Process ต้องมากกว่า 0");
        if (f.Col <= 0) throw new InvalidOperationException("Pcs./Stroke ต้องมากกว่า 0");
        if (f.Ct <= 0) throw new InvalidOperationException("MC CT (วินาที) ต้องมากกว่า 0");
        if (f.Man is < 0) throw new InvalidOperationException("STD MAN ติดลบไม่ได้");
    }

    // every product row of the given machines (any month, active or not) - used by the import preview
    public List<PpPart> PartsOf(int[] machineIds)
    {
        if (machineIds.Length == 0) return new();
        using var c = Conn();
        return c.Query<PpPart>(PartSql + " WHERE x.MachineID IN @machineIds ORDER BY x.MachineID, x.SortNo, x.ItemID", new { machineIds }).ToList();
    }

    public int SavePart(PartForm f, string uid, SqlConnection cn = null, SqlTransaction t = null)
    {
        ValidatePart(f);
        using var own = cn == null ? Conn() : null;
        var c = cn ?? own;
        if (c.ExecuteScalar<int>("SELECT COUNT(*) FROM ProductionPlan.Machines WHERE MachineID = @MachineId", f, t) == 0) throw new InvalidOperationException("ไม่พบเครื่องจักร");
        if (c.ExecuteScalar<int>("SELECT COUNT(*) FROM Nexus.Parts WHERE PartID = @PartAId", f, t) == 0) throw new InvalidOperationException("ไม่พบ PART A");
        if (f.PartBId is > 0 && c.ExecuteScalar<int>("SELECT COUNT(*) FROM Nexus.Parts WHERE PartID = @PartBId", f, t) == 0) throw new InvalidOperationException("ไม่พบ PART B");
        if (c.ExecuteScalar<int>(@"SELECT COUNT(*) FROM ProductionPlan.MachineParts WHERE MachineID = @MachineId AND PartAID = @PartAId
                                   AND ISNULL(PartBID, 0) = ISNULL(@PartBId, 0) AND ItemID <> @Id
                                   AND ISNULL(ProcessCode, '') = ISNULL(@Proc, '')", new { f.MachineId, f.PartAId, f.PartBId, f.Id, Proc = Norm(f.Process) ?? "" }, t) > 0)
            // PART A + PART B เดียวกันมีหลายแถวได้เมื่อเป็นคนละ Process (เช่น PIPE PART ขั้น 1 / 1.1)
            throw new InvalidOperationException("เครื่องนี้มี PART A + PART B + PROCESS ชุดนี้อยู่แล้ว");
        var p = new { f.Id, f.MachineId, f.PartAId, PartBId = f.PartBId is > 0 ? f.PartBId : null, Process = Norm(f.Process),
                      f.Tp, f.Col, f.Ct, f.Man, f.Active, f.Sort, uid };
        return f.Id > 0
            ? c.ExecuteScalar<int>(@"UPDATE ProductionPlan.MachineParts SET MachineID = @MachineId, PartAID = @PartAId, PartBID = @PartBId, ProcessCode = @Process, TotalProcess = @Tp,
                                         PcsPerStroke = @Col, CycleTime = @Ct, StdMan = @Man, IsActive = @Active, UpdatedBy = @uid, UpdatedAt = GETDATE() WHERE ItemID = @Id; SELECT @Id;", p, t)
            : c.ExecuteScalar<int>(@"INSERT INTO ProductionPlan.MachineParts (MachineID, SortNo, PartAID, PartBID, ProcessCode, TotalProcess, PcsPerStroke, CycleTime, StdMan, CreatedBy, UpdatedBy)
                                     VALUES (@MachineId, CASE WHEN @Sort > 0 THEN @Sort ELSE (SELECT ISNULL(MAX(SortNo), 0) + 1 FROM ProductionPlan.MachineParts WHERE MachineID = @MachineId) END,
                                             @PartAId, @PartBId, @Process, @Tp, @Col, @Ct, @Man, @uid, @uid); SELECT CAST(SCOPE_IDENTITY() AS INT);", p, t);
    }

    public static string Norm(string s) => string.IsNullOrWhiteSpace(s) ? null : string.Join(' ', s.Split((char[])null, StringSplitOptions.RemoveEmptyEntries));

    public string DeletePart(int id)
    {
        using var c = Conn();
        var label = c.QueryFirstOrDefault<string>(@"SELECT m.MachineCode + ' | ' + ISNULL(a.PartA, a.PartCode) FROM ProductionPlan.MachineParts x
                                                    JOIN ProductionPlan.Machines m ON m.MachineID = x.MachineID JOIN Nexus.Parts a ON a.PartID = x.PartAID WHERE x.ItemID = @id", new { id })
                    ?? throw new InvalidOperationException("ไม่พบรายการ");
        c.Execute("DELETE FROM ProductionPlan.MachineParts WHERE ItemID = @id", new { id });
        return label;
    }

    // ค้นหา PART A (STORE-FG) / PART B (STORE-SUB + STORE-FG) สำหรับ Dropdown
    //   คลังผูกด้วย StockID ใน EDP.PartStocks (48_EDP_Part_Stocks.sql): PARTA = คลัง FG · PARTB = คลัง SUB -> เปลี่ยนรหัส / ชื่อคลังได้ไม่กระทบ
    public IEnumerable<object> SearchParts(string kind, string key)
    {
        string k = (key ?? "").Trim();
        if (k.Length == 0) return Array.Empty<object>();
        bool b = string.Equals(kind, "B", StringComparison.OrdinalIgnoreCase);
        using var c = Conn();
        return c.Query(@"
            SELECT TOP 30 p.PartID AS id, s.StockCode AS stock,
                   CASE WHEN e.PartCol = 'PARTA' THEN LTRIM(RTRIM(ISNULL(p.PartA, ''))) ELSE COALESCE(NULLIF(LTRIM(RTRIM(p.PartB)), ''), p.PartCode) END AS code,
                   p.PartCode AS pdCode, ISNULL(p.Description, '') AS name, ISNULL(p.Customer, '') AS customer
            FROM Nexus.Parts p WITH (NOLOCK)
            JOIN Nexus.PartStocks ps ON ps.PartID = p.PartID
            JOIN Nexus.Stocks s ON s.StockID = ps.StockID
            JOIN EDP.PartStocks e ON e.StockID = s.StockID AND (e.PartCol = 'PARTA' OR @b = 1)
            WHERE p.IsActive = 1 AND (e.PartCol <> 'PARTA' OR ISNULL(p.PartA, '') <> '')
              AND (p.PartCode LIKE '%' + @k + '%' OR ISNULL(p.PartA, '') LIKE '%' + @k + '%' OR ISNULL(p.PartB, '') LIKE '%' + @k + '%' OR ISNULL(p.Description, '') LIKE '%' + @k + '%')
            ORDER BY CASE WHEN ISNULL(p.PartA, '') = @k OR ISNULL(p.PartB, '') = @k OR p.PartCode = @k THEN 0
                          WHEN ISNULL(p.PartA, '') LIKE @k + '%' OR ISNULL(p.PartB, '') LIKE @k + '%' OR p.PartCode LIKE @k + '%' THEN 1 ELSE 2 END,
                     CASE WHEN e.PartCol = 'PARTB' THEN 0 ELSE 1 END * @b, p.PartA, p.PartCode", new { k, b = b ? 1 : 0 }).ToList();
    }

    // ---------------------------------------------------------------- ข้อมูลทั้งเดือน (Dashboard / Capacity)
    public object Month(string dept, DateTime month)
    {
        var m = new DateTime(month.Year, month.Month, 1);
        int nd = DateTime.DaysInMonth(m.Year, m.Month);
        var machines = Machines(dept, activeOnly: true, m);
        using var c = Conn();
        var ids = machines.Select(x => x.Id).ToArray();
        var parts = ids.Length == 0 ? new List<PpPart>()
            : c.Query<PpPart>(PartSql + " WHERE x.MachineID IN @ids AND x.IsActive = 1 ORDER BY x.MachineID, x.SortNo, x.ItemID", new { ids }).Where(p => p.InMonth(m)).ToList();
        FillPcs(parts, Demand(c, m), Overrides(c, m));
        var actual = ids.Length == 0 ? new List<PpActual>()
            : c.Query<PpActual>(@"SELECT MachineID AS MachineId, DAY(WorkDate) AS Day, WorkHours AS Hr, Stroke, Man FROM ProductionPlan.DailyActuals
                                  WHERE MachineID IN @ids AND WorkDate >= @m AND WorkDate < DATEADD(MONTH, 1, @m)", new { ids, m }).ToList();
        var wd = c.Query<DateTime>("SELECT WorkDate FROM Nexus.CustomerWorkdays WHERE CustomerCode = '#COMPANY' AND WorkDate >= @m AND WorkDate < DATEADD(MONTH, 1, @m)", new { m })
                  .Select(d => d.Day).Distinct().OrderBy(d => d).ToList();
        bool company = wd.Count > 0;
        if (!company) wd = Enumerable.Range(1, nd).Where(d => new DateTime(m.Year, m.Month, d).DayOfWeek != DayOfWeek.Sunday).ToList();
        var byM = parts.GroupBy(p => p.MachineId).ToDictionary(g => g.Key, g => g.ToList());
        var acM = actual.GroupBy(a => a.MachineId).ToDictionary(g => g.Key, g => g.Select(a => new { day = a.Day, hr = a.Hr, stroke = a.Stroke, man = a.Man }).ToList());
        var snaps = Snaps(c, m, ids);
        return new
        {
            dept = Dept(dept),
            month = m.ToString("yyyy-MM"),
            days = nd,
            workdays = wd,
            workdaySource = company ? "COMPANY" : "DEFAULT",
            shifts = Shifts(),
            settings = Settings(),
            machines = machines.Select(x => new
            {
                x.Id, x.Code, x.Group, x.SubGroup, x.Sort, x.Qty, x.Eff, x.Man, x.Sph, x.ByPcs,
                parts = byM.TryGetValue(x.Id, out var l) ? l : new List<PpPart>(),
                actual = acM.TryGetValue(x.Id, out var a) ? (object)a : Array.Empty<object>(),
                snap = snaps.TryGetValue(x.Id, out var sn) ? sn : null
            })
        };
    }

    // ---------------------------------------------------------------- 👥 WORKLOAD (สรุปอัตรากำลังคน N-1 · Current · N…N+3)
    //   ส่งข้อมูลดิบของ 5 เดือน (เหมือน Month() แต่ทุกหน่วยงานพร้อมกัน · ~15 query) -> หน้าเว็บคำนวณ P1 / P9 / A1 ด้วยสูตรเดียวกับ Capacity
    public static readonly string[] WlRows = { "TPS", "DELIVERY", "QA", "QC", "PRESS1", "PRESS2", "ASSEMBLY", "DIE", "PIPEPART", "PIPEASSY", "PAINTPART" };
    public sealed class WlHead
    {
        public DateTime Month { get; set; }
        public string Row { get; set; }
        public decimal? Direct { get; set; }
        public decimal? Ind1 { get; set; }
        public decimal? Ind2 { get; set; }
        public string UpdatedBy { get; set; }
        public DateTime UpdatedAt { get; set; }
    }

    public object Workload(DateTime month)
    {
        var n = new DateTime(month.Year, month.Month, 1);
        var months = Enumerable.Range(-1, 5).Select(i => n.AddMonths(i)).ToList();
        var prev = months[0];
        var shifts = Shifts();
        var settings = Settings();
        using var c = Conn();
        var machines = c.Query<PpMachine>($@"
            SELECT MachineID AS Id, Dept, MachineCode AS Code, GroupName AS [Group], SubGroup, SortNo AS Sort, QtyLine AS Qty,
                   TargetEff AS Eff, ManPower AS Man, SphOverride AS Sph, StrokeByPcs AS ByPcs, IsActive AS Active{(DbSchema.HasPpMachineRange ? ", FromMonth, ToMonth" : "")}
            FROM ProductionPlan.Machines WHERE IsActive = 1 ORDER BY Dept, SortNo, MachineCode").ToList();
        var ids = machines.Select(x => x.Id).ToArray();
        var parts = ids.Length == 0 ? new List<PpPart>()
            : c.Query<PpPart>(PartSql + " WHERE x.MachineID IN @ids AND x.IsActive = 1 ORDER BY x.MachineID, x.SortNo, x.ItemID", new { ids }).ToList();
        // Actual ใช้เฉพาะเดือน N-1 (Production = A1)
        var actual = ids.Length == 0 ? new List<PpActual>()
            : c.Query<PpActual>(@"SELECT MachineID AS MachineId, DAY(WorkDate) AS Day, WorkHours AS Hr, Stroke, Man FROM ProductionPlan.DailyActuals
                                  WHERE MachineID IN @ids AND WorkDate >= @prev AND WorkDate < DATEADD(MONTH, 1, @prev)", new { ids, prev }).ToList();
        var acM = actual.GroupBy(a => a.MachineId).ToDictionary(g => g.Key, g => g.Select(a => new { day = a.Day, hr = a.Hr, stroke = a.Stroke, man = a.Man }).ToList());
        var heads = c.Query<WlHead>(@"SELECT MonthStart AS Month, RowKey AS Row, Direct, Ind1, Ind2, UpdatedBy, UpdatedAt FROM ProductionPlan.WorkloadHeads
                                       WHERE MonthStart IN @ms", new { ms = new[] { prev, n } }).ToList();
        var outMonths = new List<object>();
        foreach (var m in months)
        {
            int nd = DateTime.DaysInMonth(m.Year, m.Month);
            // PCS ของเดือนนั้น: คัดลอก Product แล้วเติม PCS (ไม่แก้รายการต้นฉบับ)
            var mp = parts.Where(p => p.InMonth(m)).Select(p => new PpPart { Id = p.Id, MachineId = p.MachineId, Sort = p.Sort, PartAId = p.PartAId, PartA = p.PartA, PdCode = p.PdCode, Customer = p.Customer,
                                                    PartBId = p.PartBId, PartB = p.PartB, Name = p.Name, Process = p.Process, Tp = p.Tp, Col = p.Col, Ct = p.Ct, Man = p.Man, Active = p.Active }).ToList();
            FillPcs(mp, Demand(c, m), Overrides(c, m));
            var byM = mp.GroupBy(p => p.MachineId).ToDictionary(g => g.Key, g => g.ToList());
            var wd = c.Query<DateTime>("SELECT WorkDate FROM Nexus.CustomerWorkdays WHERE CustomerCode = '#COMPANY' AND WorkDate >= @m AND WorkDate < DATEADD(MONTH, 1, @m)", new { m })
                      .Select(d => d.Day).Distinct().OrderBy(d => d).ToList();
            bool company = wd.Count > 0;
            if (!company) wd = Enumerable.Range(1, nd).Where(d => new DateTime(m.Year, m.Month, d).DayOfWeek != DayOfWeek.Sunday).ToList();
            bool isPrev = m == prev;
            var snaps = Snaps(c, m, ids);
            outMonths.Add(new
            {
                month = m.ToString("yyyy-MM"),
                days = nd,
                workdays = wd,
                workdaySource = company ? "COMPANY" : "DEFAULT",
                depts = machines.Where(x => x.InMonth(m)).GroupBy(x => x.Dept).ToDictionary(g => g.Key, g => g.Select(x => new
                {
                    x.Id, x.Code, x.Group, x.SubGroup, x.Sort, x.Qty, x.Eff, x.Man, x.Sph, x.ByPcs,
                    parts = byM.TryGetValue(x.Id, out var l) ? l : new List<PpPart>(),
                    actual = isPrev && acM.TryGetValue(x.Id, out var a) ? (object)a : Array.Empty<object>(),
                    snap = snaps.TryGetValue(x.Id, out var sn) ? sn : null
                }).ToList())
            });
        }
        return new
        {
            month = n.ToString("yyyy-MM"),
            shifts,
            settings,
            months = outMonths,
            heads = heads.Select(h => new { month = h.Month.ToString("yyyy-MM"), row = h.Row, h.Direct, h.Ind1, h.Ind2, h.UpdatedBy, h.UpdatedAt })
        };
    }

    public sealed record WlCell(string Row, decimal? Direct, decimal? Ind1, decimal? Ind2);

    // บันทึกคนที่มีจริงของเดือน · ว่างทั้ง 3 ช่อง = ลบแถวนั้น
    public int SaveHeads(DateTime month, IEnumerable<WlCell> cells, string uid)
    {
        var m = new DateTime(month.Year, month.Month, 1);
        var list = cells.ToList();
        foreach (var x in list)
        {
            if (!WlRows.Contains(x.Row)) throw new InvalidOperationException($"ไม่รู้จักแถว {x.Row}");
            foreach (var v in new[] { x.Direct, x.Ind1, x.Ind2 })
                if (v is < 0 or > 9999) throw new InvalidOperationException("จำนวนคนต้องอยู่ระหว่าง 0 - 9,999");
        }
        using var c = Conn();
        c.Open();
        using var t = c.BeginTransaction();
        foreach (var x in list)
        {
            if (x.Direct == null && x.Ind1 == null && x.Ind2 == null)
                c.Execute("DELETE FROM ProductionPlan.WorkloadHeads WHERE MonthStart = @m AND RowKey = @Row", new { m, x.Row }, t);
            else
                c.Execute(@"UPDATE ProductionPlan.WorkloadHeads SET Direct = @Direct, Ind1 = @Ind1, Ind2 = @Ind2, UpdatedBy = @uid, UpdatedAt = GETDATE() WHERE MonthStart = @m AND RowKey = @Row;
                            IF @@ROWCOUNT = 0 INSERT INTO ProductionPlan.WorkloadHeads (MonthStart, RowKey, Direct, Ind1, Ind2, UpdatedBy) VALUES (@m, @Row, @Direct, @Ind1, @Ind2, @uid);",
                          new { m, x.Row, x.Direct, x.Ind1, x.Ind2, uid }, t);
        }
        t.Commit();
        return list.Count;
    }

    public sealed record ActualCell(int Day, decimal? Hr, decimal? Stroke, decimal? Man);

    // บันทึก Actual รายวัน (ทั้งเดือนของเครื่องเดียว · ส่งเฉพาะวันที่แก้) ว่างทั้ง 3 ช่อง = ลบวันนั้น
    public int SaveActual(int machineId, DateTime month, IEnumerable<ActualCell> cells, string uid)
    {
        var m = new DateTime(month.Year, month.Month, 1);
        int nd = DateTime.DaysInMonth(m.Year, m.Month);
        var list = cells.ToList();
        using var c = Conn();
        // Working hour = ชั่วโมงเครื่องรวมทุกไลน์ของวัน -> เพดาน 24 × Q'ty Line (เช่น 2 ไลน์ = 48 ชม. ตาม Excel)
        decimal? qty = c.ExecuteScalar<decimal?>("SELECT QtyLine FROM ProductionPlan.Machines WHERE MachineID = @machineId", new { machineId });
        if (qty == null) throw new InvalidOperationException("ไม่พบเครื่องจักร");
        decimal maxHr = 24 * Math.Max(1, qty.Value);
        foreach (var x in list)
        {
            if (x.Day < 1 || x.Day > nd) throw new InvalidOperationException($"วันที่ {x.Day} ไม่อยู่ในเดือนนี้");
            if (x.Hr < 0 || x.Hr > maxHr) throw new InvalidOperationException($"วันที่ {x.Day}: Working hour ต้องอยู่ระหว่าง 0 - {maxHr:0.##} (24 × Q'ty Line)");
            if (x.Stroke is < 0) throw new InvalidOperationException($"วันที่ {x.Day}: Stroke ติดลบไม่ได้");
            if (x.Man is < 0 or > 999) throw new InvalidOperationException($"วันที่ {x.Day}: Man ไม่ถูกต้อง");
        }
        c.Open();
        using var t = c.BeginTransaction();
        foreach (var x in list)
        {
            var d = m.AddDays(x.Day - 1);
            if (x.Hr == null && x.Stroke == null && x.Man == null)
                c.Execute("DELETE FROM ProductionPlan.DailyActuals WHERE MachineID = @machineId AND WorkDate = @d", new { machineId, d }, t);
            else
                c.Execute(@"UPDATE ProductionPlan.DailyActuals SET WorkHours = @Hr, Stroke = @Stroke, Man = @Man, UpdatedBy = @uid, UpdatedAt = GETDATE() WHERE MachineID = @machineId AND WorkDate = @d;
                            IF @@ROWCOUNT = 0 INSERT INTO ProductionPlan.DailyActuals (MachineID, WorkDate, WorkHours, Stroke, Man, UpdatedBy) VALUES (@machineId, @d, @Hr, @Stroke, @Man, @uid);",
                          new { machineId, d, x.Hr, x.Stroke, x.Man, uid }, t);
        }
        t.Commit();
        return list.Count;
    }

    // 🕘 ค่าที่ผู้ใช้คนนี้ (UserID) เคยบันทึก ล่าสุดก่อน · Working hour / Man = ทุกเครื่อง · Stroke = เฉพาะเครื่องนี้ (ยอดแต่ละเครื่องต่างกันมาก)
    public sealed record Recent(List<decimal> Hr, List<decimal> Stroke, List<decimal> Man);
    public Recent RecentValues(string uid, int machineId)
    {
        using var c = Conn();
        List<decimal> Q(string col, bool byMachine) => c.Query<decimal>($@"
            SELECT TOP 8 v FROM (
                SELECT {col} AS v, MAX(COALESCE(UpdatedAt, WorkDate)) AS t
                FROM ProductionPlan.DailyActuals
                WHERE UpdatedBy = @uid AND {col} IS NOT NULL {(byMachine ? "AND MachineID = @machineId" : "")}
                GROUP BY {col}) x
            ORDER BY t DESC", new { uid, machineId }).ToList();
        return new Recent(Q("WorkHours", false), Q("Stroke", true), Q("Man", false));
    }

    // ---------------------------------------------------------------- 📥 IMPORT Template (Actual รายวัน / คนที่มีจริง) : ค่าที่บันทึกไว้แล้ว
    public List<PpMachine> AllMachines()
    {
        using var c = Conn();
        return c.Query<PpMachine>(@"SELECT MachineID AS Id, Dept, MachineCode AS Code, GroupName AS [Group], SubGroup, SortNo AS Sort, IsActive AS Active
                                    FROM ProductionPlan.Machines WHERE IsActive = 1 ORDER BY Dept, SortNo, MachineCode").ToList();
    }

    public List<PpActual> Actuals(IEnumerable<int> machineIds, DateTime month)
    {
        var ids = machineIds.Distinct().ToArray();
        if (ids.Length == 0) return new();
        var m = new DateTime(month.Year, month.Month, 1);
        using var c = Conn();
        return c.Query<PpActual>(@"SELECT MachineID AS MachineId, DAY(WorkDate) AS Day, WorkHours AS Hr, Stroke, Man FROM ProductionPlan.DailyActuals
                                   WHERE MachineID IN @ids AND WorkDate >= @m AND WorkDate < DATEADD(MONTH, 1, @m)", new { ids, m }).ToList();
    }

    // วันทำงานของเดือน (ปฏิทินบริษัท · ไม่มี = ทุกวันยกเว้นอาทิตย์) แบบเดียวกับ Month()
    public List<int> Workdays(DateTime month)
    {
        var m = new DateTime(month.Year, month.Month, 1);
        int nd = DateTime.DaysInMonth(m.Year, m.Month);
        using var c = Conn();
        var wd = c.Query<DateTime>("SELECT WorkDate FROM Nexus.CustomerWorkdays WHERE CustomerCode = '#COMPANY' AND WorkDate >= @m AND WorkDate < DATEADD(MONTH, 1, @m)", new { m })
                  .Select(d => d.Day).Distinct().OrderBy(d => d).ToList();
        return wd.Count > 0 ? wd : Enumerable.Range(1, nd).Where(d => new DateTime(m.Year, m.Month, d).DayOfWeek != DayOfWeek.Sunday).ToList();
    }

    public List<WlHead> Heads(DateTime month)
    {
        var m = new DateTime(month.Year, month.Month, 1);
        using var c = Conn();
        return c.Query<WlHead>(@"SELECT MonthStart AS Month, RowKey AS Row, Direct, Ind1, Ind2, UpdatedBy, UpdatedAt FROM ProductionPlan.WorkloadHeads WHERE MonthStart = @m", new { m }).ToList();
    }

    public string MachineCode(int id)
    {
        using var c = Conn();
        return c.ExecuteScalar<string>("SELECT MachineCode FROM ProductionPlan.Machines WHERE MachineID = @id", new { id });
    }
}
