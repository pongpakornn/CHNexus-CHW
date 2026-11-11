using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;

namespace Nexus.Services;

// 🧪 CHEMICAL CONTROL (schema ChemControl) · ระบบควบคุมคุณภาพน้ำยาเคมี
//   พารามิเตอร์ควบคุม (Spec Min/Max · LCL/UCL · Target · เวลาตรวจวัดต่อกะ) -> บันทึกผลการตรวจวัด -> แผนภูมิควบคุมรายเดือน
//   -> บันทึกการแก้ไข (Corrective Action) -> ส่งใบบันทึกประจำเดือนเข้า FLOW ลายเซ็น (Prepared / Checked / Reviewed / Approved)

public sealed class ChemParam
{
    public int Id { get; set; }
    public string Code { get; set; }
    public string Name { get; set; }
    public string NameTh { get; set; }
    public string Line { get; set; }
    public string Process { get; set; }
    public string Category { get; set; }
    public string Unit { get; set; }
    public decimal? SpecMin { get; set; }
    public decimal? SpecMax { get; set; }
    public decimal? Lcl { get; set; }
    public decimal? Ucl { get; set; }
    public decimal? Target { get; set; }
    public int Decimals { get; set; }
    public string Shifts { get; set; }
    public string DayTimes { get; set; }
    public string NightTimes { get; set; }
    public string Method { get; set; }
    public string FormNo { get; set; }
    public int Sort { get; set; }
    public bool Active { get; set; }
    public int Readings { get; set; }
    public string UpdatedBy { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class ChemReading
{
    public int Id { get; set; }
    public int ParamId { get; set; }
    public DateTime Date { get; set; }
    public string Shift { get; set; }
    public int Slot { get; set; }
    public string Time { get; set; }
    public decimal Value { get; set; }
    public string Inspector { get; set; }
    public string InspectorId { get; set; }
    public string Remark { get; set; }
}

public sealed class ChemAction
{
    public int Id { get; set; }
    public int ParamId { get; set; }
    public DateTime Date { get; set; }
    public string CheckTime { get; set; }
    public string Problem { get; set; }
    public decimal? Before { get; set; }
    public decimal? After { get; set; }
    public string Correction { get; set; }
    public string AdjustTime { get; set; }
    public string Responsible { get; set; }
    public string CreatedBy { get; set; }
}

public sealed class ChemSheet
{
    public int Id { get; set; }
    public int ParamId { get; set; }
    public int Year { get; set; }
    public int Month { get; set; }
    public string Status { get; set; }
    public int? NextSlot { get; set; }
    public string SubmittedBy { get; set; }
    public DateTime? SubmittedAt { get; set; }
    public DateTime? DoneAt { get; set; }
}

public sealed class ChemSign
{
    public int Slot { get; set; }
    public string UserId { get; set; }
    public string UserName { get; set; }
    public DateTime SignedAt { get; set; }
}

public sealed class ChemControlService
{
    public static readonly string[] SlotNames = { "", "Prepared", "Checked", "Reviewed", "Approved" };
    public static string SlotName(int s) => s >= 1 && s <= 4 ? SlotNames[s] : "";
    private static SqlConnection Conn() => new(GlobalConfig.ConnStr);

    // ---------------------------------------------------------------- พารามิเตอร์ควบคุม
    private const string ParamSql = @"
        SELECT p.ParamID AS Id, p.Code, p.Name, p.NameTh, p.Line, p.Process, p.Category, p.Unit, p.SpecMin, p.SpecMax, p.LCL AS Lcl, p.UCL AS Ucl, p.Target,
               CAST(p.Decimals AS INT) AS Decimals, p.Shifts, p.DayTimes, p.NightTimes, p.Method, p.FormNo, p.SortNo AS Sort, p.IsActive AS Active, p.UpdatedBy, p.UpdatedAt";

    public List<ChemParam> Params(bool activeOnly)
    {
        using var c = Conn();
        return c.Query<ChemParam>(ParamSql + @", (SELECT COUNT(*) FROM ChemControl.Readings r WHERE r.ParamID = p.ParamID) AS Readings
                                               FROM ChemControl.Parameters p WHERE @all = 1 OR p.IsActive = 1 ORDER BY p.SortNo, p.Code", new { all = activeOnly ? 0 : 1 }).ToList();
    }

    public ChemParam Param(int id)
    {
        using var c = Conn();
        return c.QueryFirstOrDefault<ChemParam>(ParamSql + " , 0 AS Readings FROM ChemControl.Parameters p WHERE p.ParamID = @id", new { id });
    }

    private static readonly System.Text.RegularExpressions.Regex TimeRx = new(@"^([01]\d|2[0-3]):[0-5]\d$");
    public static List<string> Times(string s) => (s ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

    public int SaveParam(ChemParam f, string uid)
    {
        string code = (f.Code ?? "").Trim().ToUpperInvariant(), name = (f.Name ?? "").Trim();
        if (code.Length == 0 || code.Length > 30) throw new InvalidOperationException("กรุณากรอกรหัสพารามิเตอร์ (ไม่เกิน 30 ตัวอักษร)");
        if (name.Length == 0) throw new InvalidOperationException("กรุณากรอกชื่อพารามิเตอร์");
        if (f.SpecMin == null && f.SpecMax == null) throw new InvalidOperationException("กรุณากำหนด Spec Min หรือ Spec Max อย่างน้อย 1 ค่า");
        if (f.SpecMin != null && f.SpecMax != null && f.SpecMin >= f.SpecMax) throw new InvalidOperationException("Spec Min ต้องน้อยกว่า Spec Max");
        if (f.Lcl != null && f.Ucl != null && f.Lcl >= f.Ucl) throw new InvalidOperationException("LCL ต้องน้อยกว่า UCL");
        if (f.Decimals is < 0 or > 4) throw new InvalidOperationException("ทศนิยมได้ 0 - 4 ตำแหน่ง");
        string shifts = f.Shifts == "D" ? "D" : "DN";
        var day = Times(f.DayTimes); var night = Times(f.NightTimes);
        if (day.Count == 0) throw new InvalidOperationException("กรุณากำหนดเวลาตรวจวัดกะกลางวันอย่างน้อย 1 เวลา");
        if (shifts == "DN" && night.Count == 0) throw new InvalidOperationException("กรุณากำหนดเวลาตรวจวัดกะกลางคืนอย่างน้อย 1 เวลา");
        if (day.Concat(night).Any(t => !TimeRx.IsMatch(t))) throw new InvalidOperationException("รูปแบบเวลาไม่ถูกต้อง (HH:mm เช่น 08:30)");
        if (day.Count > 6 || night.Count > 6) throw new InvalidOperationException("ตรวจวัดได้ไม่เกิน 6 ครั้ง / กะ");
        using var c = Conn();
        if (c.ExecuteScalar<int>("SELECT COUNT(*) FROM ChemControl.Parameters WHERE Code = @code AND ParamID <> @Id", new { code, f.Id }) > 0)
            throw new InvalidOperationException($"มีรหัส {code} อยู่แล้ว");
        var p = new
        {
            f.Id, code, name, nameTh = Trim(f.NameTh), line = Trim(f.Line) ?? "ED PAINT LINE", process = Trim(f.Process), cat = (Trim(f.Category) ?? "CHEMICAL").ToUpperInvariant(),
            unit = Trim(f.Unit), f.SpecMin, f.SpecMax, f.Lcl, f.Ucl, f.Target, dec = (byte)f.Decimals, shifts,
            day = string.Join(",", day), night = shifts == "D" ? null : string.Join(",", night), method = Trim(f.Method), form = Trim(f.FormNo), f.Sort, f.Active, uid
        };
        return f.Id > 0
            ? c.ExecuteScalar<int>(@"UPDATE ChemControl.Parameters SET Code = @code, Name = @name, NameTh = @nameTh, Line = @line, Process = @process, Category = @cat, Unit = @unit,
                                        SpecMin = @SpecMin, SpecMax = @SpecMax, LCL = @Lcl, UCL = @Ucl, Target = @Target, Decimals = @dec, Shifts = @shifts, DayTimes = @day, NightTimes = @night,
                                        Method = @method, FormNo = @form, SortNo = @Sort, IsActive = @Active, UpdatedBy = @uid, UpdatedAt = GETDATE() WHERE ParamID = @Id; SELECT @Id;", p)
            : c.ExecuteScalar<int>(@"INSERT INTO ChemControl.Parameters (Code, Name, NameTh, Line, Process, Category, Unit, SpecMin, SpecMax, LCL, UCL, Target, Decimals, Shifts, DayTimes, NightTimes, Method, FormNo, SortNo, IsActive, CreatedBy, UpdatedBy)
                                     VALUES (@code, @name, @nameTh, @line, @process, @cat, @unit, @SpecMin, @SpecMax, @Lcl, @Ucl, @Target, @dec, @shifts, @day, @night, @method, @form,
                                             CASE WHEN @Sort > 0 THEN @Sort ELSE (SELECT ISNULL(MAX(SortNo), 0) + 1 FROM ChemControl.Parameters) END, 1, @uid, @uid);
                                     SELECT CAST(SCOPE_IDENTITY() AS INT);", p);
    }

    private static string Trim(string s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    // ลบได้เฉพาะพารามิเตอร์ที่ยังไม่มีผลการตรวจวัด (มีแล้ว = ปิดใช้งานแทน)
    public string DeleteParam(int id)
    {
        using var c = Conn();
        string code = c.ExecuteScalar<string>("SELECT Code FROM ChemControl.Parameters WHERE ParamID = @id", new { id }) ?? throw new InvalidOperationException("ไม่พบพารามิเตอร์");
        if (c.ExecuteScalar<int>("SELECT COUNT(*) FROM ChemControl.Readings WHERE ParamID = @id", new { id }) > 0
            || c.ExecuteScalar<int>("SELECT COUNT(*) FROM ChemControl.Sheets WHERE ParamID = @id", new { id }) > 0)
            throw new InvalidOperationException($"{code} มีผลการตรวจวัดแล้ว ลบไม่ได้ · เปลี่ยนเป็น INACTIVE แทน");
        c.Open();
        using var t = c.BeginTransaction();
        c.Execute("DELETE FROM ChemControl.Actions WHERE ParamID = @id; DELETE FROM ChemControl.SignFlow WHERE ParamID = @id; DELETE FROM ChemControl.Parameters WHERE ParamID = @id;", new { id }, t);
        t.Commit();
        return code;
    }

    // ---------------------------------------------------------------- ผลการตรวจวัด
    private const string ReadSql = @"SELECT ReadingID AS Id, ParamID AS ParamId, ReadDate AS Date, Shift, CAST(Slot AS INT) AS Slot, ReadTime AS Time, Value,
                                            InspectorName AS Inspector, InspectorID AS InspectorId, Remark FROM ChemControl.Readings";

    public List<ChemReading> Readings(DateTime from, DateTime to, int? paramId = null)
    {
        using var c = Conn();
        return c.Query<ChemReading>(ReadSql + " WHERE ReadDate >= @from AND ReadDate < @to AND (@pid IS NULL OR ParamID = @pid) ORDER BY ReadDate, Shift, Slot",
                                    new { from = from.Date, to = to.Date, pid = paramId }).ToList();
    }

    public sealed record ReadingCell(int ParamId, int Slot, string Time, decimal? Value, string Remark);

    // บันทึกทั้งกะ: ค่าว่าง = ลบครั้งนั้น · ส่งเฉพาะช่องที่แก้ · คืน (บันทึก, ลบ)
    public (int saved, int removed) SaveReadings(DateTime date, string shift, IEnumerable<ReadingCell> cells, string uid, string userName)
    {
        var list = cells.ToList();
        if (date.Date > DateTime.Today.AddDays(1)) throw new InvalidOperationException("บันทึกล่วงหน้าไม่ได้");
        var ps = Params(false).ToDictionary(p => p.Id);
        foreach (var x in list)
        {
            if (!ps.TryGetValue(x.ParamId, out var p)) throw new InvalidOperationException("ไม่พบพารามิเตอร์");
            int n = Times(shift == "N" ? p.NightTimes : p.DayTimes).Count;
            if (shift == "N" && p.Shifts == "D") throw new InvalidOperationException($"{p.Code} ตรวจวัดเฉพาะกะกลางวัน");
            if (x.Slot < 1 || x.Slot > Math.Max(1, n)) throw new InvalidOperationException($"{p.Code}: ครั้งที่ตรวจวัดไม่ถูกต้อง");
            if (x.Value is < -999999 or > 999999) throw new InvalidOperationException($"{p.Code}: ค่าไม่ถูกต้อง");
        }
        int saved = 0, removed = 0;
        using var c = Conn();
        c.Open();
        using var t = c.BeginTransaction();
        foreach (var x in list)
        {
            var a = new { x.ParamId, d = date.Date, shift, slot = (byte)x.Slot, time = Trim(x.Time), x.Value, remark = Trim(x.Remark), uid, userName };
            if (x.Value == null)
                removed += c.Execute("DELETE FROM ChemControl.Readings WHERE ParamID = @ParamId AND ReadDate = @d AND Shift = @shift AND Slot = @slot", a, t);
            else
            {
                int u = c.Execute(@"UPDATE ChemControl.Readings SET Value = @Value, ReadTime = @time, Remark = @remark, UpdatedBy = @uid, UpdatedAt = GETDATE()
                                    WHERE ParamID = @ParamId AND ReadDate = @d AND Shift = @shift AND Slot = @slot", a, t);
                if (u == 0)
                    c.Execute(@"INSERT INTO ChemControl.Readings (ParamID, ReadDate, Shift, Slot, ReadTime, Value, InspectorID, InspectorName, Remark, UpdatedBy)
                                VALUES (@ParamId, @d, @shift, @slot, @time, @Value, @uid, @userName, @remark, @uid)", a, t);
                saved++;
            }
        }
        t.Commit();
        return (saved, removed);
    }

    // ---------------------------------------------------------------- บันทึกการแก้ไข (Corrective Action)
    public List<ChemAction> Actions(int paramId, DateTime from, DateTime to)
    {
        using var c = Conn();
        return c.Query<ChemAction>(@"SELECT ActionID AS Id, ParamID AS ParamId, ActDate AS Date, CheckTime, Problem, ValueBefore AS Before, ValueAfter AS After, Correction, AdjustTime, Responsible, CreatedBy
                                     FROM ChemControl.Actions WHERE ParamID = @paramId AND ActDate >= @from AND ActDate < @to ORDER BY ActDate, CheckTime, ActionID",
                                   new { paramId, from = from.Date, to = to.Date }).ToList();
    }

    public int SaveAction(ChemAction a, string uid)
    {
        if (a.ParamId <= 0) throw new InvalidOperationException("กรุณาเลือกพารามิเตอร์");
        if (string.IsNullOrWhiteSpace(a.Problem) && string.IsNullOrWhiteSpace(a.Correction)) throw new InvalidOperationException("กรุณากรอกปัญหาที่พบ หรือวิธีการแก้ไข");
        foreach (var t in new[] { a.CheckTime, a.AdjustTime })
            if (!string.IsNullOrWhiteSpace(t) && !TimeRx.IsMatch(t.Trim())) throw new InvalidOperationException("รูปแบบเวลาไม่ถูกต้อง (HH:mm)");
        using var c = Conn();
        var p = new { a.Id, a.ParamId, d = a.Date.Date, ct = Trim(a.CheckTime), problem = Trim(a.Problem), a.Before, a.After, corr = Trim(a.Correction), at = Trim(a.AdjustTime), resp = Trim(a.Responsible), uid };
        return a.Id > 0
            ? c.ExecuteScalar<int>(@"UPDATE ChemControl.Actions SET ActDate = @d, CheckTime = @ct, Problem = @problem, ValueBefore = @Before, ValueAfter = @After, Correction = @corr, AdjustTime = @at,
                                        Responsible = @resp, UpdatedBy = @uid, UpdatedAt = GETDATE() WHERE ActionID = @Id; SELECT @Id;", p)
            : c.ExecuteScalar<int>(@"INSERT INTO ChemControl.Actions (ParamID, ActDate, CheckTime, Problem, ValueBefore, ValueAfter, Correction, AdjustTime, Responsible, CreatedBy, UpdatedBy)
                                     VALUES (@ParamId, @d, @ct, @problem, @Before, @After, @corr, @at, @resp, @uid, @uid); SELECT CAST(SCOPE_IDENTITY() AS INT);", p);
    }

    public ChemAction Action(int id)
    {
        using var c = Conn();
        return c.QueryFirstOrDefault<ChemAction>("SELECT ActionID AS Id, ParamID AS ParamId, ActDate AS Date FROM ChemControl.Actions WHERE ActionID = @id", new { id });
    }

    public void DeleteAction(int id)
    {
        using var c = Conn();
        c.Execute("DELETE FROM ChemControl.Actions WHERE ActionID = @id", new { id });
    }

    // ---------------------------------------------------------------- ใบบันทึกประจำเดือน + FLOW ลายเซ็น
    public List<MinFlowSlot> Flow(int paramId)
    {
        using var c = Conn();
        var rows = c.Query<(int ParamID, byte Slot, string Mode, string Users)>("SELECT ParamID, Slot, Mode, Users FROM ChemControl.SignFlow WHERE ParamID IN (0, @paramId)", new { paramId }).ToList();
        // ใช้ FLOW ของพารามิเตอร์ก่อน · ยังไม่ตั้ง = FLOW ค่าเริ่มต้น (ParamID 0)
        int use = rows.Any(r => r.ParamID == paramId && paramId > 0 && r.Mode != "OFF") ? paramId : 0;
        return Enumerable.Range(1, 4).Select(i =>
        {
            var r = rows.FirstOrDefault(x => x.ParamID == use && x.Slot == i);
            return new MinFlowSlot { Slot = i, Mode = r.Mode ?? "OFF", Users = (r.Users ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList() };
        }).ToList();
    }

    public List<MinFlowSlot> FlowRaw(int paramId)
    {
        using var c = Conn();
        var rows = c.Query<(byte Slot, string Mode, string Users)>("SELECT Slot, Mode, Users FROM ChemControl.SignFlow WHERE ParamID = @paramId", new { paramId }).ToList();
        return Enumerable.Range(1, 4).Select(i =>
        {
            var r = rows.FirstOrDefault(x => x.Slot == i);
            return new MinFlowSlot { Slot = i, Mode = r.Mode ?? "OFF", Users = (r.Users ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList() };
        }).ToList();
    }

    public HashSet<int> FlowConfigured()
    {
        using var c = Conn();
        return c.Query<int>("SELECT DISTINCT ParamID FROM ChemControl.SignFlow WHERE Mode <> 'OFF' AND ISNULL(Users, '') <> ''").ToHashSet();
    }

    public void SaveFlow(int paramId, List<MinFlowSlot> slots, string uid)
    {
        using var c = Conn();
        c.Open();
        using var tx = c.BeginTransaction();
        foreach (var s in slots)
            c.Execute(@"MERGE ChemControl.SignFlow AS t USING (SELECT @paramId AS ParamID, @slot AS Slot) AS x ON t.ParamID = x.ParamID AND t.Slot = x.Slot
                        WHEN MATCHED THEN UPDATE SET Mode = @mode, Users = @users, UpdatedBy = @uid, UpdatedDate = GETDATE()
                        WHEN NOT MATCHED THEN INSERT (ParamID, Slot, Mode, Users, UpdatedBy) VALUES (@paramId, @slot, @mode, @users, @uid);",
                      new { paramId, slot = (byte)s.Slot, mode = s.Mode, users = s.Users.Count == 0 ? null : string.Join(",", s.Users), uid }, tx);
        tx.Commit();
    }

    public static int? NextActive(List<MinFlowSlot> flow, int after) => flow.Where(s => s.Slot > after && s.Active).Select(s => (int?)s.Slot).FirstOrDefault();

    public ChemSheet Sheet(int paramId, int year, int month)
    {
        using var c = Conn();
        return c.QueryFirstOrDefault<ChemSheet>(SheetSql + " WHERE ParamID = @paramId AND PeriodYear = @year AND PeriodMonth = @month", new { paramId, year, month });
    }

    public ChemSheet SheetById(int id)
    {
        using var c = Conn();
        return c.QueryFirstOrDefault<ChemSheet>(SheetSql + " WHERE SheetID = @id", new { id });
    }

    private const string SheetSql = @"SELECT SheetID AS Id, ParamID AS ParamId, CAST(PeriodYear AS INT) AS Year, CAST(PeriodMonth AS INT) AS Month, Status, CAST(NextSlot AS INT) AS NextSlot,
                                             SubmittedBy, SubmittedAt, DoneAt FROM ChemControl.Sheets";

    public List<ChemSign> Signs(int sheetId)
    {
        using var c = Conn();
        return c.Query<ChemSign>("SELECT CAST(Slot AS INT) AS Slot, UserID AS UserId, UserName, SignedAt FROM ChemControl.Signs WHERE SheetID = @sheetId ORDER BY Slot", new { sheetId }).ToList();
    }

    // ส่งใบบันทึกเข้า FLOW: เริ่มที่ช่องแรกที่ใช้ (ส่งซ้ำหลังถูกตีกลับ = เริ่มใหม่)
    public ChemSheet Submit(int paramId, int year, int month, string uid)
    {
        var flow = Flow(paramId);
        int? first = NextActive(flow, 0) ?? throw new InvalidOperationException("ยังไม่ได้ตั้ง FLOW ลายเซ็นของรายการนี้\nตั้งได้ที่ User Management › SETUP › SIGN FLOW › CHEMICAL CONTROL");
        using var c = Conn();
        c.Open();
        using var t = c.BeginTransaction();
        int id = c.ExecuteScalar<int?>("SELECT SheetID FROM ChemControl.Sheets WITH (UPDLOCK) WHERE ParamID = @paramId AND PeriodYear = @year AND PeriodMonth = @month", new { paramId, year, month }, t) ?? 0;
        if (id > 0)
        {
            string st = c.ExecuteScalar<string>("SELECT Status FROM ChemControl.Sheets WHERE SheetID = @id", new { id }, t);
            if (st != "DRAFT") throw new InvalidOperationException(st == "APPROVED" ? "ใบบันทึกเดือนนี้อนุมัติแล้ว" : "ใบบันทึกเดือนนี้อยู่ระหว่างลงลายเซ็น");
            c.Execute("DELETE FROM ChemControl.Signs WHERE SheetID = @id; UPDATE ChemControl.Sheets SET Status = 'SIGNING', NextSlot = @first, SubmittedBy = @uid, SubmittedAt = GETDATE(), DoneAt = NULL WHERE SheetID = @id;",
                      new { id, first, uid }, t);
        }
        else
            id = c.ExecuteScalar<int>(@"INSERT INTO ChemControl.Sheets (ParamID, PeriodYear, PeriodMonth, Status, NextSlot, SubmittedBy, SubmittedAt)
                                        VALUES (@paramId, @year, @month, 'SIGNING', @first, @uid, GETDATE()); SELECT CAST(SCOPE_IDENTITY() AS INT);",
                                      new { paramId, year = (short)year, month = (byte)month, first, uid }, t);
        t.Commit();
        return SheetById(id);
    }

    // ลงลายเซ็นช่องที่รออยู่ -> ไปช่องถัดไป / ครบ = APPROVED
    public ChemSheet Sign(int sheetId, string uid, string userName)
    {
        var s = SheetById(sheetId) ?? throw new InvalidOperationException("ไม่พบใบบันทึก");
        if (s.Status != "SIGNING" || s.NextSlot == null) throw new InvalidOperationException("ใบบันทึกนี้ไม่ได้รอลงลายเซ็น");
        var flow = Flow(s.ParamId);
        var slot = flow.First(x => x.Slot == s.NextSlot);
        if (!slot.Allows(uid)) throw new InvalidOperationException($"ช่อง {SlotName(slot.Slot)} ไม่ใช่ของคุณ");
        if (!SignatureStore.Has(uid)) throw new InvalidOperationException("ยังไม่มีลายเซ็นของคุณ\nบันทึกได้ที่ โปรไฟล์ › ลายเซ็นของฉัน");
        int? next = NextActive(flow, slot.Slot);
        using var c = Conn();
        c.Open();
        using var t = c.BeginTransaction();
        int n = c.Execute("UPDATE ChemControl.Sheets SET NextSlot = @next, Status = CASE WHEN @next IS NULL THEN 'APPROVED' ELSE 'SIGNING' END, DoneAt = CASE WHEN @next IS NULL THEN GETDATE() END WHERE SheetID = @sheetId AND NextSlot = @cur",
                          new { sheetId, next, cur = (byte)slot.Slot }, t);
        if (n == 0) throw new InvalidOperationException("ใบบันทึกถูกลงลายเซ็นไปแล้ว");
        c.Execute("INSERT INTO ChemControl.Signs (SheetID, Slot, UserID, UserName) VALUES (@sheetId, @slot, @uid, @userName)", new { sheetId, slot = (byte)slot.Slot, uid, userName }, t);
        t.Commit();
        return SheetById(sheetId);
    }

    // ตีกลับ: ผู้ลงลายเซ็นช่องที่รออยู่ ส่งกลับเป็น DRAFT (ล้างลายเซ็นทั้งหมด) เพื่อแก้ไขแล้วส่งใหม่
    public ChemSheet Return(int sheetId, string uid)
    {
        var s = SheetById(sheetId) ?? throw new InvalidOperationException("ไม่พบใบบันทึก");
        if (s.Status != "SIGNING") throw new InvalidOperationException("ใบบันทึกนี้ไม่ได้อยู่ระหว่างลงลายเซ็น");
        var slot = Flow(s.ParamId).FirstOrDefault(x => x.Slot == s.NextSlot);
        if (slot == null || !slot.Allows(uid)) throw new InvalidOperationException("ตีกลับได้เฉพาะผู้ลงลายเซ็นช่องที่รออยู่");
        using var c = Conn();
        c.Execute("DELETE FROM ChemControl.Signs WHERE SheetID = @sheetId; UPDATE ChemControl.Sheets SET Status = 'DRAFT', NextSlot = NULL, DoneAt = NULL WHERE SheetID = @sheetId;", new { sheetId });
        return SheetById(sheetId);
    }

    // ใบบันทึกที่รอฉันลงลายเซ็น
    public List<ChemSheet> Inbox(string uid)
    {
        using var c = Conn();
        var all = c.Query<ChemSheet>(SheetSql + " WHERE Status = 'SIGNING' ORDER BY SubmittedAt").ToList();
        return all.Where(s => Flow(s.ParamId).Any(f => f.Slot == s.NextSlot && f.Allows(uid))).ToList();
    }

    public List<ChemSheet> SheetsOf(int year, int month)
    {
        using var c = Conn();
        return c.Query<ChemSheet>(SheetSql + " WHERE PeriodYear = @year AND PeriodMonth = @month", new { year, month }).ToList();
    }

    public Dictionary<string, string> Names(IEnumerable<string> ids)
    {
        var list = ids.Where(x => !string.IsNullOrWhiteSpace(x)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (list.Length == 0) return new(StringComparer.OrdinalIgnoreCase);
        using var c = Conn();
        return c.Query<(string UserID, string FullName)>("SELECT UserID, FullName FROM Nexus.Users WHERE UserID IN @list", new { list })
                .ToDictionary(x => x.UserID, x => string.IsNullOrWhiteSpace(x.FullName) ? x.UserID : x.FullName, StringComparer.OrdinalIgnoreCase);
    }
}
