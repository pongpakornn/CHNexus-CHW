using ClosedXML.Excel;
using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;
using Nexus.Helpers;

namespace Nexus.Services;

// 🏭 EDP PLANNING (schema EDP ในฐาน CHR-Nexus) - ย้ายมาจากโปรแกรม EDP Systems (WPF) เงื่อนไขเดิมทุกข้อ
//   ชิ้นงาน = EDP.vw_Parts (VIEW เหนือ MASTER DATA › Product Control › STORE-FG = PART A / STORE-SUB = PART B) · PT_ID = Nexus.Parts.PartID
//   คลังชิ้นงานผูกด้วย StockID (EDP.PartStocks · 48_EDP_Part_Stocks.sql) -> เปลี่ยนรหัส / ชื่อคลังได้ ไม่กระทบ EDP
//   รอบ 1 = 08-12 · 2 = 12-16 · 3 = 16-20 (กะ DAY) · 4 = 20-24 · 5 = 00-04 · 6 = 04-08 (กะ NIGHT)
//   1 HG = 3.25 นาที (เวลาของการ์ดยืด / หดตาม HG คิดที่หน้าเว็บ แบบเดียวกับ WPF)

public sealed class EdpRound
{
    public int RoundId { get; set; }
    public int StartHour { get; set; }
    public int EndHour { get; set; }
    public string Shift => StartHour >= 8 && StartHour < 20 ? "DAY" : "NIGHT";
}

public sealed class EdpCard
{
    public int PldId { get; set; }
    public int PlhId { get; set; }
    public string Shift { get; set; }
    public int RoundId { get; set; }
    public string TimeStart { get; set; }
    public string TimeEnd { get; set; }
    public int? PartId { get; set; }
    public string Customer { get; set; }
    public string PartNo { get; set; }
    public string PartCode { get; set; }
    public string PartName { get; set; }
    public string Img { get; set; }
    public int PcsHg { get; set; }
    public int QtyHg { get; set; }          // ชิ้นต่อ 1 HG (QTY_HG) = ฐานแปลง ชิ้น <-> HG แบบโปรแกรม EDP Systems (BaseQtyPerHg)
    public int QtyPlan { get; set; }
    public int HgPlan { get; set; }
    public int QtyAct { get; set; }
    public int? HgAct { get; set; }
    public bool IsDone { get; set; }
    public bool IsVisible { get; set; }
    public bool IsProblem { get; set; }
    public string Remark { get; set; }
    public int? OrigHg { get; set; }        // HG ตามแผนก่อนถูกแก้ครั้งแรก (ฐานคิดส่วนต่างเวลา)
    public bool IsEdited { get; set; }      // หน้างานกด EDIT แก้แผนแล้ว (มีประวัติแก้ที่ไม่ใช่แจ้งผลิตไม่ได้) -> การ์ดสีส้ม
}

public sealed class EdpPart
{
    public int PartId { get; set; }
    public string Customer { get; set; }
    public string PartNo { get; set; }
    public string PartCode { get; set; }
    public string PartName { get; set; }
    public string Img { get; set; }
    public int PcsHg { get; set; }
    public int QtyHg { get; set; }
    public int TotalPcs { get; set; }
}

public sealed class EdpPlanCardIn
{
    public int? PldId { get; set; }          // การ์ดเดิมในรอบนี้ (SAVE ALL แก้ทับ · ยอดจริง / MARK / หมายเหตุไม่หาย) · ไม่มี = การ์ดใหม่
    public int? PartId { get; set; }
    public string TimeStart { get; set; }
    public string TimeEnd { get; set; }
    public int Qty { get; set; }
    public int Hg { get; set; }
    public bool Visible { get; set; } = true;
    public int? RoundId { get; set; }
}

public sealed class EdpTemplate
{
    public int TplId { get; set; }
    public string TplName { get; set; }
    public string Shift { get; set; }
    public int? RoundId { get; set; }
    public string Remark { get; set; }
    public string CreateBy { get; set; }
    public DateTime CreateAt { get; set; }
    public DateTime? UpdateAt { get; set; }
    public int CardCount { get; set; }
    public bool IsDaily { get; set; }
}

// 📅 ช่องของแม่แบบประจำวัน (รอบคิดแล้ว) สำหรับแสดงเป็นร่างในวัน / รอบที่ยังไม่มีการ์ด
public sealed class EdpDailyCard
{
    public int? PartId { get; set; }
    public string TimeStart { get; set; }
    public string TimeEnd { get; set; }
    public decimal Qty { get; set; }
    public decimal Hg { get; set; }
    public int? RoundId { get; set; }
}

public sealed class EdpMonitorRow
{
    public int Id { get; set; }
    public string Customer { get; set; }
    public string PartCode { get; set; }
    public string PartNo { get; set; }
    public string PartName { get; set; }
    public int Plan { get; set; }
    public int Actual { get; set; }
    public int QtyHg { get; set; }
    public int HgAct { get; set; }
    public decimal? CycleTime { get; set; }
    public decimal? TotalTimeMin { get; set; }
    public string Operator { get; set; }
    public string Remark { get; set; }
    public bool IsDone { get; set; }
    public bool IsProblem { get; set; }
    public string Shift { get; set; }
}

// ⏰ แจ้งเตือนการ์ดเลยเวลา (ทั้งระบบ 1 แถว · EDP.AlertSettings)
public sealed class EdpAlertSettings
{
    public bool Enabled { get; set; } = true;
    public int GraceMinutes { get; set; }
    public int RemindMinutes { get; set; } = 10;
    public bool OnlyStarted { get; set; } = true;
    public string UpdatedBy { get; set; }
    public DateTime? UpdatedDate { get; set; }
    // 🔊 40_EDP_Alert_Sound_Users.sql: ผู้รับแจ้งเตือน + เสียง (ไม่มีคอลัมน์ = ค่าเริ่มต้น / ทุกคนที่ MARK ได้)
    public string AlertUsers { get; set; }
    public bool SoundOn { get; set; } = true;
    public int SoundId { get; set; } = 15;
    public int LeadRepeat { get; set; } = 1;
    public bool EndChime { get; set; } = true;
    public int GapSeconds { get; set; } = 30;
    public decimal AlarmVolume { get; set; } = 1;
    public decimal VoiceVolume { get; set; } = 1;
    public decimal VoiceRate { get; set; } = 0.9m;
    public string MsgTh { get; set; }
    public string MsgMy { get; set; }

    public List<string> Users() => (AlertUsers ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
}

// 🗣 ไฟล์เสียงประโยคแจ้งเตือนที่อัพโหลดเอง (EDP.AlertVoices) · Key = SHA-256 ของประโยค
public sealed record EdpVoice(string Lang, string TextKey, string ContentType, DateTime UpdatedDate, string UpdatedBy);

public sealed class EdpService
{
    public const string AllDay = "ALL";
    private static SqlConnection Conn() => new(GlobalConfig.ConnStr);

    // ---------------------------------------------------------------- ข้อมูลตั้งต้น
    public List<EdpRound> Rounds()
    {
        using var c = Conn();
        return c.Query<EdpRound>("SELECT ROUND_ID AS RoundId, ISNULL(START_HOUR,0) AS StartHour, ISNULL(END_HOUR,0) AS EndHour FROM EDP.Rounds ORDER BY ROUND_ID").ToList();
    }

    public List<DateTime> Dates(string shift)
    {
        using var c = Conn();
        return c.Query<DateTime>("SELECT DISTINCT PLH_DATE FROM EDP.PlanHeaders WHERE (@shift IS NULL OR SHIFT = @shift) ORDER BY PLH_DATE DESC",
                                 new { shift = string.IsNullOrEmpty(shift) || shift == AllDay ? null : shift }).ToList();
    }

    public List<EdpPart> Parts()
    {
        using var c = Conn();
        return c.Query<EdpPart>(@"SELECT PT_ID AS PartId, ISNULL(CUST_CODE,'') AS Customer, ISNULL(PT_NO,'') AS PartNo, PT_CODE AS PartCode, PT_NAME AS PartName,
                                         PT_IMG AS Img, ISNULL(PCS_HG,0) AS PcsHg, ISNULL(QTY_HG,0) AS QtyHg, ISNULL(TOTAL_PCS,0) AS TotalPcs
                                  FROM EDP.vw_Parts WHERE IS_ACTIVE = 1 AND NULLIF(PT_NO,'') IS NOT NULL
                                  ORDER BY CUST_CODE, PT_NO").ToList();
    }

    // ชิ้นงานที่ EDP ใช้ (มีค่า HG) - ปุ่ม FILTER EDP ที่ Product Control
    // 🏭 ค่าที่ระบบ EDP ใช้ของชิ้นงาน (คอลัมน์แบบหน้า Product Control ของ EDP Systems .exe): HG TYPE · PCS/HG · HG QTY · CT(S) · STD(M) · WEIGHT
    public sealed record PartEdp(int PT_ID, string HG_TYPE, int? PCS_HG, int? QTY_HG, decimal? STD_CT, decimal? STD_TIME_HG, decimal? STD_WT);
    public Dictionary<int, PartEdp> PartInfo(IEnumerable<int> ids)
    {
        var list = ids.Distinct().ToArray();
        if (list.Length == 0) return new();
        using var c = Conn();
        return c.Query<PartEdp>("SELECT PT_ID, HG_TYPE, PCS_HG, QTY_HG, STD_CT, STD_TIME_HG, STD_WT FROM EDP.vw_Parts WHERE PT_ID IN @list", new { list })
                .GroupBy(x => x.PT_ID).ToDictionary(g => g.Key, g => g.First());
    }

    // คลังชิ้นงาน EDP: StockID -> PARTA / PARTB (ยังไม่รัน 48_EDP_Part_Stocks.sql = ว่าง)
    public Dictionary<int, string> PartStocks()
    {
        using var c = Conn();
        if (c.ExecuteScalar<int>("SELECT CASE WHEN OBJECT_ID('EDP.PartStocks') IS NULL THEN 0 ELSE 1 END") == 0) return new();
        return c.Query<(int StockID, string PartCol)>("SELECT StockID, PartCol FROM EDP.PartStocks").ToDictionary(x => x.StockID, x => x.PartCol);
    }

    public HashSet<int> PartIds()
    {
        using var c = Conn();
        return c.Query<int>("SELECT PT_ID FROM EDP.vw_Parts WHERE PCS_HG IS NOT NULL OR QTY_HG IS NOT NULL").ToHashSet();
    }

    public string Status(DateTime date, string shift)
    {
        using var c = Conn();
        return c.ExecuteScalar<string>("SELECT STAT FROM EDP.PlanHeaders WHERE PLH_DATE = @date AND SHIFT = @shift", new { date = date.Date, shift });
    }

    // ---------------------------------------------------------------- การ์ดของ วันที่ + กะ (+ รอบ)
    public List<EdpCard> Cards(DateTime date, string shift, int? round)
    {
        using var c = Conn();
        var list = c.Query<EdpCard>(@"
            SELECT D.PLD_ID AS PldId, D.PLH_ID AS PlhId, H.SHIFT AS Shift, ISNULL(D.EFF_ROUND_ID, 0) AS RoundId,
                   D.TIME_START AS TimeStart, D.TIME_END AS TimeEnd, D.PT_ID AS PartId,
                   ISNULL(P.CUST_CODE,'') AS Customer, ISNULL(P.PT_NO,'') AS PartNo, P.PT_CODE AS PartCode, P.PT_NAME AS PartName, P.PT_IMG AS Img,
                   ISNULL(P.PCS_HG,0) AS PcsHg, ISNULL(P.QTY_HG,0) AS QtyHg, ISNULL(D.QTY_PLAN,0) AS QtyPlan, ISNULL(D.HG_PLAN,0) AS HgPlan, ISNULL(D.QTY_ACT,0) AS QtyAct, D.HG_ACT AS HgAct,
                   CAST(ISNULL(D.IS_DONE,0) AS BIT) AS IsDone, CAST(ISNULL(D.IS_VISIBLE,1) AS BIT) AS IsVisible, CAST(ISNULL(D.IS_PROBLEM,0) AS BIT) AS IsProblem,
                   D.REMARK AS Remark
            FROM EDP.vw_PlanCards D
            JOIN EDP.PlanHeaders H ON H.PLH_ID = D.PLH_ID
            LEFT JOIN EDP.vw_Parts P ON P.PT_ID = D.PT_ID
            WHERE H.PLH_DATE = @date AND (@shift = 'ALL' OR H.SHIFT = @shift) AND (@round IS NULL OR D.EFF_ROUND_ID = @round)
            ORDER BY D.PLD_ID", new { date = date.Date, shift, round }).ToList();
        if (list.Count == 0) return list;

        // HG ตามแผนก่อนแก้ครั้งแรก (แถวแรกของ Log ที่ไม่ใช่แจ้งปัญหา)
        var orig = c.Query<(int Id, int Hg)>(@"
            SELECT PLD_ID, OLD_HG_PLAN FROM (
                SELECT L.PLD_ID, L.OLD_HG_PLAN, ROW_NUMBER() OVER (PARTITION BY L.PLD_ID ORDER BY L.EDIT_DATE, L.LOG_ID) RN
                FROM EDP.PlanEditLogs L JOIN EDP.PlanCards D ON D.PLD_ID = L.PLD_ID JOIN EDP.PlanHeaders H ON H.PLH_ID = D.PLH_ID
                WHERE L.IS_PROBLEM = 0 AND L.OLD_HG_PLAN IS NOT NULL AND H.PLH_DATE = @date) X WHERE RN = 1",
            new { date = date.Date }).ToDictionary(x => x.Id, x => x.Hg);
        foreach (var card in list) if (orig.TryGetValue(card.PldId, out int h)) (card.OrigHg, card.IsEdited) = (h, true);
        return list;
    }

    public string Signature(DateTime date, string shift)
    {
        using var c = Conn();
        return c.QuerySingle<string>(@"
            SELECT CONCAT(COUNT(*), ':', ISNULL(CHECKSUM_AGG(CHECKSUM(D.PLD_ID, D.PT_ID, D.QTY_PLAN, D.HG_PLAN, D.TIME_START, D.TIME_END,
                                                                     D.IS_VISIBLE, D.ROUND_ID, D.IS_DONE, D.HG_ACT, D.IS_PROBLEM, D.REMARK)), 0))
            FROM EDP.PlanCards D JOIN EDP.PlanHeaders H ON H.PLH_ID = D.PLH_ID
            WHERE H.PLH_DATE = @date AND (@shift = 'ALL' OR H.SHIFT = @shift)", new { date = date.Date, shift });
    }

    // ลายเซ็นแผนแบบ PlanService.GetPlanSignature (SUB-16): COUNT + CHECKSUM ของ PLD_ID, PT_ID, QTY_PLAN, HG_PLAN, TIME_START, TIME_END, IS_VISIBLE, EFF_ROUND_ID
    //   ไม่รวมยอดจริง / MARK -> หน้างานเครื่องอื่นกด MARK ไม่ทำให้การสลับการ์ดถูกยกเลิก (SUB-14)
    public string PlanSignature(DateTime date, string shift)
    {
        using var c = Conn();
        return c.QuerySingle<string>(@"
            SELECT CONCAT(COUNT(*), ':', ISNULL(CHECKSUM_AGG(CHECKSUM(D.PLD_ID, D.PT_ID, D.QTY_PLAN, D.HG_PLAN, D.TIME_START, D.TIME_END, D.IS_VISIBLE, D.EFF_ROUND_ID)), 0))
            FROM EDP.vw_PlanCards D JOIN EDP.PlanHeaders H ON H.PLH_ID = D.PLH_ID
            WHERE H.PLH_DATE = @date AND (@shift = 'ALL' OR H.SHIFT = @shift)", new { date = date.Date, shift });
    }

    // ---------------------------------------------------------------- Plan Submission (หน้างาน)
    public void Start(DateTime date, string shift)
    {
        using var c = Conn();
        c.Execute("UPDATE EDP.PlanHeaders SET STAT = 'IN PROGRESS' WHERE PLH_DATE = @date AND (@shift = 'ALL' OR SHIFT = @shift) AND STAT = 'READY'",
                  new { date = date.Date, shift });
    }

    public string Operator(DateTime date, string shift)
    {
        using var c = Conn();
        return c.ExecuteScalar<string>("SELECT OPERATOR_CODE FROM EDP.ShiftOperators WHERE PLAN_DATE = @date AND SHIFT = @shift", new { date = date.Date, shift });
    }

    public void SetOperator(DateTime date, string shift, string code, string uid)
    {
        using var c = Conn();
        c.Execute(@"MERGE EDP.ShiftOperators AS T USING (SELECT @date AS D, @shift AS S) AS X ON T.PLAN_DATE = X.D AND T.SHIFT = X.S
                    WHEN MATCHED THEN UPDATE SET OPERATOR_CODE = @code, SAVED_BY = @uid, SAVED_AT = GETDATE()
                    WHEN NOT MATCHED THEN INSERT (PLAN_DATE, SHIFT, OPERATOR_CODE, SAVED_BY) VALUES (@date, @shift, @code, @uid);",
                  new { date = date.Date, shift, code, uid });
    }

    public void Finish(DateTime date, string shift)
    {
        using var c = Conn();
        c.Execute("UPDATE EDP.PlanHeaders SET STAT = 'COMPLETED' WHERE PLH_DATE = @date AND (@shift = 'ALL' OR SHIFT = @shift)", new { date = date.Date, shift });
    }

    public void Mark(int pldId, int qtyAct, int hgAct)
    {
        using var c = Conn();
        if (c.Execute("UPDATE EDP.PlanCards SET QTY_ACT = @qtyAct, HG_ACT = @hgAct, IS_DONE = 1 WHERE PLD_ID = @pldId", new { pldId, qtyAct, hgAct }) == 0)
            throw new InvalidOperationException("ไม่พบรายการนี้ในระบบ หรือข้อมูลถูกลบไปแล้ว");
    }

    // แก้ไขการ์ดจากหน้างาน: เปลี่ยนชิ้นงาน / จำนวน หรือแจ้งว่าผลิตไม่ได้ · เก็บค่าเดิม -> ค่าใหม่ลง Log ทุกครั้ง
    public (string OldText, string NewText) Edit(int pldId, bool problem, int? partId, int qty, int hg, string remark, string uid)
    {
        using var c = Conn();
        c.Open();
        using var t = c.BeginTransaction();
        var old = c.QueryFirstOrDefault<(string Cust, string PtNo, int Qty, int Hg)>(@"
            SELECT ISNULL(P.CUST_CODE,''), ISNULL(P.PT_NO,''), ISNULL(D.QTY_PLAN,0), ISNULL(D.HG_PLAN,0)
            FROM EDP.PlanCards D WITH (UPDLOCK) LEFT JOIN EDP.vw_Parts P ON P.PT_ID = D.PT_ID WHERE D.PLD_ID = @pldId", new { pldId }, t);
        if (old == default) throw new InvalidOperationException("ไม่พบรายการนี้ในระบบ หรือข้อมูลถูกลบไปแล้ว");

        (string Cust, string PtNo) nw = (old.Cust, old.PtNo);
        if (problem)
            c.Execute("UPDATE EDP.PlanCards SET REMARK = @remark, IS_PROBLEM = 1 WHERE PLD_ID = @pldId", new { pldId, remark }, t);
        else
        {
            nw = c.QueryFirstOrDefault<(string, string)>("SELECT ISNULL(CUST_CODE,''), ISNULL(PT_NO,'') FROM EDP.vw_Parts WHERE PT_ID = @partId", new { partId }, t);
            if (nw == default) throw new InvalidOperationException("ไม่พบชิ้นงานที่เลือกในคลังชิ้นงาน EDP (STORE-FG / STORE-SUB)");
            c.Execute("UPDATE EDP.PlanCards SET PT_ID = @partId, QTY_PLAN = @qty, HG_PLAN = @hg, REMARK = @remark, IS_PROBLEM = 0 WHERE PLD_ID = @pldId",
                      new { pldId, partId, qty, hg, remark }, t);
        }
        c.Execute(@"INSERT INTO EDP.PlanEditLogs (PLD_ID, OLD_CUST, OLD_PT_NO, OLD_QTY_PLAN, OLD_HG_PLAN, NEW_CUST, NEW_PT_NO, NEW_QTY_PLAN, NEW_HG_PLAN, IS_PROBLEM, REMARK, EDIT_BY)
                    VALUES (@pldId, @oc, @op, @oq, @oh, @nc, @np, @nq, @nh, @problem, @remark, @uid)",
                  new { pldId, oc = old.Cust, op = old.PtNo, oq = old.Qty, oh = old.Hg, nc = nw.Cust, np = nw.PtNo,
                        nq = problem ? old.Qty : qty, nh = problem ? old.Hg : hg, problem, remark, uid }, t);
        t.Commit();
        return ($"{old.Cust} {old.PtNo} {old.Qty} PCS / {old.Hg} HG", problem ? "ผลิตไม่ได้" : $"{nw.Cust} {nw.PtNo} {qty} PCS / {hg} HG");
    }

    public sealed record SlotTime(int PldId, string TimeStart, string TimeEnd);

    // ลากสลับการ์ด 2 ใบ: แลกรอบกัน + เวลาใหม่ของทุกการ์ดที่ขยับ (คำนวณจากหน้าจอแล้ว) · Transaction เดียว ล็อกแถว
    public Guid Swap(int a, int b, IEnumerable<SlotTime> times, string uid)
    {
        const string conflict = "แผนนี้ถูกแก้ไขจากเครื่องอื่นไปแล้ว ระบบจะโหลดแผนล่าสุดให้ กรุณาลองใหม่อีกครั้ง";
        if (a <= 0 || b <= 0 || a == b) throw new InvalidOperationException("เลือกการ์ดที่จะสลับไม่ถูกต้อง");
        using var c = Conn();
        c.Open();
        using var t = c.BeginTransaction();
        var rows = c.Query<(int Id, int Plh, int? Round, bool Done)>(
            "SELECT PLD_ID, PLH_ID, ROUND_ID, CAST(ISNULL(IS_DONE,0) AS BIT) FROM EDP.PlanCards WITH (UPDLOCK, HOLDLOCK) WHERE PLD_ID IN (@a, @b)", new { a, b }, t)
            .ToDictionary(x => x.Id);
        if (!rows.TryGetValue(a, out var ra) || !rows.TryGetValue(b, out var rb)) throw new InvalidOperationException(conflict);
        if (ra.Plh != rb.Plh) throw new InvalidOperationException("สลับได้เฉพาะการ์ดในแผนวันที่และกะเดียวกัน");
        if (ra.Done || rb.Done) throw new InvalidOperationException("การ์ดที่ทำเสร็จแล้วสลับเวลาไม่ได้");
        // เก็บค่าเดิมของทุกการ์ดที่จะขยับ (ย้อนกลับได้ด้วย UNDO SWAP)
        var list = (times ?? Enumerable.Empty<SlotTime>()).ToList();
        var ids = list.Select(x => x.PldId).Append(a).Append(b).Distinct().ToList();
        var batch = Guid.NewGuid();
        c.Execute(@"INSERT INTO EDP.PlanTimeFixLogs (PLD_ID, OLD_TIME_START, NEW_TIME_START, OLD_TIME_END, NEW_TIME_END, OLD_ROUND_ID, NEW_ROUND_ID, BATCH_ID, FIX_BY)
                    SELECT PLD_ID, TIME_START, TIME_START, TIME_END, TIME_END, ROUND_ID, ROUND_ID, @batch, @uid FROM EDP.PlanCards WHERE PLD_ID IN @ids",
                  new { ids, batch, uid }, t);
        c.Execute("UPDATE EDP.PlanCards SET ROUND_ID = @r WHERE PLD_ID = @id", new[] { new { r = rb.Round, id = a }, new { r = ra.Round, id = b } }, t);
        foreach (var s in list)
            if (c.Execute("UPDATE EDP.PlanCards SET TIME_START = @s, TIME_END = @e WHERE PLD_ID = @id AND PLH_ID = @h",
                          new { s = s.TimeStart, e = s.TimeEnd, id = s.PldId, h = ra.Plh }, t) != 1)
                throw new InvalidOperationException(conflict);
        c.Execute(@"UPDATE L SET NEW_TIME_START = D.TIME_START, NEW_TIME_END = D.TIME_END, NEW_ROUND_ID = D.ROUND_ID
                    FROM EDP.PlanTimeFixLogs L JOIN EDP.PlanCards D ON D.PLD_ID = L.PLD_ID WHERE L.BATCH_ID = @batch", new { batch }, t);
        t.Commit();
        return batch;
    }

    // ↶ ย้อนการสลับ: คืนเวลา / รอบเดิมของทุกการ์ดในชุดนั้น (เฉพาะเมื่อยังไม่มีใครแก้การ์ดชุดนี้ต่อ)
    public int UndoSwap(Guid batch)
    {
        using var c = Conn();
        c.Open();
        using var t = c.BeginTransaction();
        var rows = c.Query<(int Id, string Os, string Ns, string Oe, string Ne, int? Or, int? Nr, string Cs, string Ce, int? Cr)>(@"
            SELECT L.PLD_ID, L.OLD_TIME_START, L.NEW_TIME_START, L.OLD_TIME_END, L.NEW_TIME_END, L.OLD_ROUND_ID, L.NEW_ROUND_ID, D.TIME_START, D.TIME_END, D.ROUND_ID
            FROM EDP.PlanTimeFixLogs L JOIN EDP.PlanCards D WITH (UPDLOCK, HOLDLOCK) ON D.PLD_ID = L.PLD_ID WHERE L.BATCH_ID = @batch", new { batch }, t).ToList();
        if (rows.Count == 0) throw new InvalidOperationException("ไม่พบรายการสลับนี้แล้ว");
        if (rows.Any(r => r.Cs != r.Ns || r.Ce != r.Ne || r.Cr != r.Nr))
            throw new InvalidOperationException("การ์ดชุดนี้ถูกแก้ไข / ย้อนไปแล้ว จึงย้อนการสลับไม่ได้");
        foreach (var r in rows)
            c.Execute("UPDATE EDP.PlanCards SET TIME_START = @Os, TIME_END = @Oe, ROUND_ID = @Or WHERE PLD_ID = @Id", new { r.Os, r.Oe, r.Or, r.Id }, t);
        t.Commit();
        return rows.Count;
    }

    // ---------------------------------------------------------------- Plan Setting (ผู้วางแผน)
    private static void EnsureRoundInShift(SqlConnection c, SqlTransaction t, string shift, int round)
    {
        int? start = c.ExecuteScalar<int?>("SELECT START_HOUR FROM EDP.Rounds WHERE ROUND_ID = @round", new { round }, t);
        if (start == null) throw new InvalidOperationException($"ไม่พบรอบ {round} ในระบบ");
        string rs = start >= 8 && start < 20 ? "DAY" : "NIGHT";
        if (!string.Equals(rs, shift, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"รอบ {round} เป็นรอบของกะ {rs} บันทึกลงกะ {shift} ไม่ได้ กรุณาเลือกรอบใหม่");
    }

    private static int Header(SqlConnection c, SqlTransaction t, DateTime date, string shift, string uid) =>
        c.ExecuteScalar<int?>("SELECT PLH_ID FROM EDP.PlanHeaders WITH (UPDLOCK, HOLDLOCK) WHERE PLH_DATE = @date AND SHIFT = @shift", new { date = date.Date, shift }, t)
        ?? c.QuerySingle<int>("INSERT INTO EDP.PlanHeaders (PLH_DATE, SHIFT, STAT, CREATE_BY) OUTPUT INSERTED.PLH_ID VALUES (@date, @shift, 'READY', @uid)",
                              new { date = date.Date, shift, uid }, t);

    // บันทึกเฉพาะรอบที่เลือก (รอบอื่นของวันที่ + กะเดียวกันไม่ถูกแตะ)
    //   แก้จากโปรแกรมเดิม (SPEC CHK-01 / CHK-03): เดิมลบการ์ดทั้งรอบแล้วสร้างใหม่ -> การ์ดที่หน้างาน MARK แล้วยอดจริง / สถานะ / หมายเหตุหาย และ PLD_ID ใหม่ (ประวัติ EDIT หลุด)
    //   ตอนนี้: การ์ดเดิม (PLD_ID) = แก้ค่าแผนทับ (ยอดจริง / MARK / ผลิตไม่ได้ / หมายเหตุ / Operator คงเดิม) · ใบที่เอาออกจากจอ = ลบ · ใบใหม่ = เพิ่ม
    //   ขอบเขต = รอบจริงของการ์ด (EFF_ROUND_ID) การ์ดเก่าที่ ROUND_ID ว่างจึงไม่ค้างซ้อน
    public int Save(DateTime date, string shift, int round, List<EdpPlanCardIn> cards, string uid)
    {
        using var c = Conn();
        c.Open();
        EnsureRoundInShift(c, null, shift, round);
        using var t = c.BeginTransaction();
        int h = Header(c, t, date, shift, uid);
        var have = c.Query<int>(@"SELECT D.PLD_ID FROM EDP.PlanCards D WITH (UPDLOCK, HOLDLOCK) JOIN EDP.vw_PlanCards E ON E.PLD_ID = D.PLD_ID
                                  WHERE D.PLH_ID = @h AND E.EFF_ROUND_ID = @round", new { h, round }, t).ToHashSet();
        var keep = cards.Where(x => x.PldId is int id && have.Contains(id)).ToList();
        var keepIds = keep.Select(x => x.PldId.Value).ToHashSet();
        var drop = have.Where(id => !keepIds.Contains(id)).ToList();
        if (drop.Count > 0) c.Execute("DELETE FROM EDP.PlanCards WHERE PLD_ID IN @drop", new { drop }, t);
        c.Execute(@"UPDATE EDP.PlanCards SET PT_ID = @PartId, TIME_START = @TimeStart, TIME_END = @TimeEnd, QTY_PLAN = @Qty, HG_PLAN = @Hg, IS_VISIBLE = @Visible, ROUND_ID = @round
                    WHERE PLD_ID = @PldId AND PLH_ID = @h",
                  keep.Select(x => new { x.PldId, h, x.PartId, x.TimeStart, x.TimeEnd, x.Qty, x.Hg, x.Visible, round }), t);
        c.Execute(@"INSERT INTO EDP.PlanCards (PLH_ID, PT_ID, TIME_START, TIME_END, QTY_PLAN, HG_PLAN, IS_VISIBLE, ROUND_ID)
                    VALUES (@h, @PartId, @TimeStart, @TimeEnd, @Qty, @Hg, @Visible, @round)",
                  cards.Where(x => !(x.PldId is int id && keepIds.Contains(id))).Select(x => new { h, x.PartId, x.TimeStart, x.TimeEnd, x.Qty, x.Hg, x.Visible, round }), t);
        // 📅 SAVE ALL ตอนรอบว่าง = ตั้งใจให้ว่าง (ไม่แสดงร่างจากแม่แบบประจำวันซ้ำ) · มีการ์ด = ยกเลิกเครื่องหมาย
        if (DbSchema.HasEdpDailySkip)
            c.Execute(cards.Count == 0 ? SkipSet : "DELETE FROM EDP.PlanDailySkips WHERE PLH_DATE = @d AND SHIFT = @s AND ROUND_ID = @r",
                      new { d = date.Date, s = shift, r = round, uid }, t);
        t.Commit();
        return cards.Count;
    }

    private const string SkipSet = @"IF NOT EXISTS (SELECT 1 FROM EDP.PlanDailySkips WHERE PLH_DATE = @d AND SHIFT = @s AND ROUND_ID = @r)
                                     INSERT INTO EDP.PlanDailySkips (PLH_DATE, SHIFT, ROUND_ID, CREATE_BY) VALUES (@d, @s, @r, @uid)";

    private const string SrcScope = @" FROM EDP.vw_PlanCards D JOIN EDP.PlanHeaders H ON H.PLH_ID = D.PLH_ID
                                       WHERE H.PLH_DATE = @sd AND H.SHIFT = @ss AND (@sr IS NULL OR D.EFF_ROUND_ID = @sr)";

    // คัดลอกแผน (ค่าของแผนเท่านั้น) วันเก่า -> วันที่ + กะ + รอบ ปลายทาง · รอบ = null คือทั้งกะ
    public int Copy(DateTime sd, string ss, int? sr, DateTime td, string ts, int? tr, string uid)
    {
        bool whole = sr == null || tr == null;
        if (whole && (sr != null || tr != null)) throw new InvalidOperationException("ต้นทางกับปลายทางต้องเป็นแบบทั้งกะทั้งคู่ หรือแบบรายรอบทั้งคู่");
        if (whole && !string.Equals(ss, ts, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("คัดลอกแบบทั้งกะได้เฉพาะกะเดียวกัน (DAY -> DAY / NIGHT -> NIGHT)");
        if (sd.Date == td.Date && ss == ts && sr == tr) throw new InvalidOperationException("ต้นทางกับปลายทางเป็นชุดเดียวกัน กรุณาเลือกใหม่");
        using var c = Conn();
        c.Open();
        if (!whole) EnsureRoundInShift(c, null, ts, tr.Value);
        using var t = c.BeginTransaction();
        var p = new { sd = sd.Date, ss, sr };
        if (c.ExecuteScalar<int>("SELECT COUNT(*)" + SrcScope, p, t) == 0) { t.Rollback(); return 0; }
        int h = Header(c, t, td, ts, uid);
        c.Execute(@"DELETE D FROM EDP.PlanCards D JOIN EDP.vw_PlanCards E ON E.PLD_ID = D.PLD_ID
                    WHERE D.PLH_ID = @h AND (@tr IS NULL OR E.EFF_ROUND_ID = @tr)", new { h, tr }, t);   // รอบจริง (CHK-03)
        int n = c.Execute(@"INSERT INTO EDP.PlanCards (PLH_ID, PT_ID, TIME_START, TIME_END, QTY_PLAN, HG_PLAN, IS_VISIBLE, ROUND_ID)
                            SELECT @h, D.PT_ID, D.TIME_START, D.TIME_END, D.QTY_PLAN, D.HG_PLAN, 1, ISNULL(@tr, D.EFF_ROUND_ID)" + SrcScope + " ORDER BY D.PLD_ID",
                          new { h, tr, sd = sd.Date, ss, sr }, t);
        t.Commit();
        return n;
    }

    public (int Total, int Done) Count(DateTime date, string shift, int? round)
    {
        using var c = Conn();
        return c.QuerySingle<(int, int)>(@"SELECT COUNT(*), ISNULL(SUM(CASE WHEN ISNULL(D.IS_DONE,0) = 1 THEN 1 ELSE 0 END), 0)" + SrcScope,
                                         new { sd = date.Date, ss = shift, sr = round });
    }

    // ล้างแผน: includeDone = false เก็บการ์ดที่ MARK SUCCESS แล้วไว้ (ยอดผลิตจริงไม่หาย)
    public (int Removed, int Kept) Clear(DateTime date, string shift, int? round, bool includeDone, string uid = null)
    {
        using var c = Conn();
        c.Open();
        using var t = c.BeginTransaction();
        const string scope = @" FROM EDP.PlanCards D JOIN EDP.vw_PlanCards E ON E.PLD_ID = D.PLD_ID
                                JOIN EDP.PlanHeaders H WITH (UPDLOCK, HOLDLOCK) ON H.PLH_ID = D.PLH_ID
                                WHERE H.PLH_DATE = @d AND H.SHIFT = @s AND (@r IS NULL OR E.EFF_ROUND_ID = @r)";
        var p = new { d = date.Date, s = shift, r = round };
        int kept = includeDone ? 0 : c.ExecuteScalar<int>("SELECT COUNT(*)" + scope + " AND ISNULL(D.IS_DONE,0) = 1", p, t);
        int removed = c.Execute("DELETE D" + scope + (includeDone ? "" : " AND ISNULL(D.IS_DONE,0) = 0"), p, t);
        // 📅 รอบที่ว่างแล้วหลังล้าง = ตั้งใจให้ว่าง (แม่แบบประจำวันไม่เติมกลับมา)
        if (DbSchema.HasEdpDailySkip)
            c.Execute(@"INSERT INTO EDP.PlanDailySkips (PLH_DATE, SHIFT, ROUND_ID, CREATE_BY)
                        SELECT @d, @s, R.ROUND_ID, @uid FROM EDP.Rounds R
                        WHERE (@r IS NULL OR R.ROUND_ID = @r)
                          AND CASE WHEN R.START_HOUR >= 8 AND R.START_HOUR < 20 THEN 'DAY' ELSE 'NIGHT' END = @s
                          AND NOT EXISTS (SELECT 1 FROM EDP.PlanDailySkips K WHERE K.PLH_DATE = @d AND K.SHIFT = @s AND K.ROUND_ID = R.ROUND_ID)
                          AND NOT EXISTS (SELECT 1 FROM EDP.vw_PlanCards E JOIN EDP.PlanHeaders H ON H.PLH_ID = E.PLH_ID
                                          WHERE H.PLH_DATE = @d AND H.SHIFT = @s AND E.EFF_ROUND_ID = R.ROUND_ID)",
                      new { d = date.Date, s = shift, r = round, uid }, t);
        t.Commit();
        return (removed, kept);
    }

    // ---------------------------------------------------------------- แม่แบบ
    public List<EdpTemplate> Templates()
    {
        using var c = Conn();
        return c.Query<EdpTemplate>(@"SELECT T.TPL_ID AS TplId, T.TPL_NAME AS TplName, T.SHIFT AS Shift, T.ROUND_ID AS RoundId, T.REMARK AS Remark,
                                             T.CREATE_BY AS CreateBy, T.CREATE_AT AS CreateAt, T.UPDATE_AT AS UpdateAt,
                                             (SELECT COUNT(*) FROM EDP.PlanTemplateCards D WHERE D.TPL_ID = T.TPL_ID) AS CardCount" +
                                      (DbSchema.HasEdpDaily ? ", CAST(ISNULL(T.IS_DAILY,0) AS BIT) AS IsDaily" : "") +
                                    " FROM EDP.PlanTemplates T ORDER BY T.TPL_NAME").ToList();
    }

    private const string TplRoundSrc = @"ISNULL(D.ROUND_ID, (SELECT TOP 1 R.ROUND_ID FROM EDP.Rounds R
                                WHERE TRY_CAST(LEFT(D.TIME_START, 2) AS INT) % 24 >= R.START_HOUR AND TRY_CAST(LEFT(D.TIME_START, 2) AS INT) % 24 < R.END_HOUR
                                ORDER BY R.ROUND_ID))";

    // 📅 ตั้ง / ยกเลิกแม่แบบประจำวัน (มีได้ตัวเดียว · ต้องเป็นแม่แบบทั้งวัน 6 รอบ) · id = null = ปิด
    public string SetDaily(int? id)
    {
        using var c = Conn();
        c.Open();
        using var t = c.BeginTransaction();
        string name = null;
        if (id is int x)
        {
            var row = c.QuerySingleOrDefault<(string Name, string Shift)>("SELECT TPL_NAME, ISNULL(SHIFT,'') FROM EDP.PlanTemplates WHERE TPL_ID = @x", new { x }, t);
            if (row.Name == null) throw new InvalidOperationException("ไม่พบแม่แบบนี้แล้ว อาจถูกลบไปจากเครื่องอื่น");
            if (!string.Equals(row.Shift, AllDay, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("ใช้ประจำวันได้เฉพาะแม่แบบทั้งวัน 6 รอบ (SAVE TEMPLATE แบบทั้งวัน)");
            name = row.Name;
        }
        c.Execute("UPDATE EDP.PlanTemplates SET IS_DAILY = CASE WHEN TPL_ID = @id THEN 1 ELSE 0 END WHERE IS_DAILY = 1 OR TPL_ID = @id", new { id }, t);
        t.Commit();
        return name;
    }

    // 📅 แม่แบบประจำวันที่เลือกไว้ + ช่องทั้งหมด (ไม่มี = null)
    // รอบนี้ผู้วางแผนตั้งใจให้ว่าง (SAVE ALL ว่าง / CLEAR) = ไม่เติมร่างจากแม่แบบประจำวัน
    public bool DailySkipped(DateTime date, string shift, int round)
    {
        if (!DbSchema.HasEdpDailySkip) return false;
        using var c = Conn();
        return c.ExecuteScalar<int>("SELECT COUNT(*) FROM EDP.PlanDailySkips WHERE PLH_DATE = @d AND SHIFT = @s AND ROUND_ID = @r", new { d = date.Date, s = shift, r = round }) > 0;
    }

    public (int Id, string Name, List<EdpDailyCard> Cards)? Daily()
    {
        if (!DbSchema.HasEdpDaily) return null;
        using var c = Conn();
        var h = c.QueryFirstOrDefault<(int Id, string Name)>("SELECT TOP 1 TPL_ID, TPL_NAME FROM EDP.PlanTemplates WHERE IS_DAILY = 1 AND SHIFT = 'ALL' ORDER BY TPL_ID");
        if (h.Name == null) return null;
        var cards = c.Query<EdpDailyCard>("SELECT D.PT_ID AS PartId, D.TIME_START AS TimeStart, D.TIME_END AS TimeEnd, ISNULL(D.QTY_PLAN,0) AS Qty, ISNULL(D.HG_PLAN,0) AS Hg, " + TplRoundSrc +
                                          " AS RoundId FROM EDP.PlanTemplateCards D WHERE D.TPL_ID = @id ORDER BY D.SEQ, D.TPD_ID", new { id = h.Id }).ToList();
        return (h.Id, h.Name, cards);
    }

    // ชื่อซ้ำ = เขียนทับแม่แบบเดิม · round = null คือแม่แบบทั้งกะ (การ์ดแต่ละใบจำรอบของตัวเอง)
    public int SaveTemplate(string name, string shift, int? round, List<EdpPlanCardIn> cards, string uid)
    {
        name = (name ?? "").Trim();
        if (name.Length == 0) throw new InvalidOperationException("กรุณาตั้งชื่อแม่แบบก่อนบันทึก");
        if (cards == null || cards.Count == 0) throw new InvalidOperationException("ไม่มีการ์ดให้บันทึกเป็นแม่แบบ");
        using var c = Conn();
        c.Open();
        using var t = c.BeginTransaction();
        int? id = c.ExecuteScalar<int?>("SELECT TPL_ID FROM EDP.PlanTemplates WHERE TPL_NAME = @name", new { name }, t);
        if (id is int old)
        {
            c.Execute("UPDATE EDP.PlanTemplates SET SHIFT = @shift, ROUND_ID = @round, UPDATE_AT = GETDATE() WHERE TPL_ID = @old", new { shift, round, old }, t);
            c.Execute("DELETE FROM EDP.PlanTemplateCards WHERE TPL_ID = @old", new { old }, t);
        }
        else id = c.QuerySingle<int>("INSERT INTO EDP.PlanTemplates (TPL_NAME, SHIFT, ROUND_ID, CREATE_BY) OUTPUT INSERTED.TPL_ID VALUES (@name, @shift, @round, @uid)",
                                     new { name, shift, round, uid }, t);
        c.Execute(@"INSERT INTO EDP.PlanTemplateCards (TPL_ID, SEQ, PT_ID, TIME_START, TIME_END, QTY_PLAN, HG_PLAN, IS_VISIBLE, ROUND_ID)
                    VALUES (@id, @Seq, @PartId, @TimeStart, @TimeEnd, @Qty, @Hg, 1, @Round)",
                  cards.Select((x, i) => new { id, Seq = i, x.PartId, x.TimeStart, x.TimeEnd, x.Qty, x.Hg, Round = round ?? (x.RoundId > 0 ? x.RoundId : null) }), t);
        t.Commit();
        return cards.Count;
    }

    public bool DeleteTemplate(int id)
    {
        using var c = Conn();
        return c.Execute("DELETE FROM EDP.PlanTemplates WHERE TPL_ID = @id", new { id }) > 0;
    }

    // ลงแม่แบบ: round มีค่า = ทับเฉพาะรอบ · null = ทั้งกะ (การ์ดลงรอบเดิมในแม่แบบ) · shift = ALL = แม่แบบทั้งวันลงทั้ง 2 กะ
    public int ApplyTemplate(int tplId, DateTime date, string shift, int? round, string uid)
    {
        bool wholeDay = string.Equals(shift, AllDay, StringComparison.OrdinalIgnoreCase);
        if (wholeDay && round.HasValue) throw new InvalidOperationException("ลงแบบทั้งวันเลือกรอบไม่ได้");
        using var c = Conn();
        c.Open();
        if (round.HasValue) EnsureRoundInShift(c, null, shift, round.Value);
        using var t = c.BeginTransaction();
        string tplShift = c.ExecuteScalar<string>("SELECT ISNULL(SHIFT,'') FROM EDP.PlanTemplates WHERE TPL_ID = @tplId", new { tplId }, t)
                          ?? throw new InvalidOperationException("ไม่พบแม่แบบนี้แล้ว อาจถูกลบไปจากเครื่องอื่น");
        bool dayTpl = string.Equals(tplShift, AllDay, StringComparison.OrdinalIgnoreCase);
        if (wholeDay && !dayTpl) throw new InvalidOperationException("ลงแบบทั้งวันได้เฉพาะแม่แบบทั้งวัน 6 รอบ");

        const string src = @"ISNULL(D.ROUND_ID, (SELECT TOP 1 R.ROUND_ID FROM EDP.Rounds R
                                WHERE TRY_CAST(LEFT(D.TIME_START, 2) AS INT) % 24 >= R.START_HOUR AND TRY_CAST(LEFT(D.TIME_START, 2) AS INT) % 24 < R.END_HOUR
                                ORDER BY R.ROUND_ID))";
        string expr = "ISNULL(@r, " + src + ")";
        int rows = 0;
        foreach (string s in wholeDay ? new[] { "DAY", "NIGHT" } : new[] { shift })
        {
            string where = " WHERE D.TPL_ID = @id";
            if (dayTpl)
                where += round.HasValue ? " AND " + src + " = @r"
                    : " AND EXISTS (SELECT 1 FROM EDP.Rounds RS WHERE RS.ROUND_ID = " + src
                      + " AND CASE WHEN RS.START_HOUR >= 8 AND RS.START_HOUR < 20 THEN 'DAY' ELSE 'NIGHT' END = @s)";
            var p = new { id = tplId, s, r = round };
            var rounds = c.Query<int?>("SELECT DISTINCT " + expr + " FROM EDP.PlanTemplateCards D" + where, p, t).ToList();
            if (rounds.Count == 0) continue;
            if (rounds.Any(x => x == null)) throw new InvalidOperationException("แม่แบบมีการ์ดที่ระบุรอบไม่ได้ กรุณาบันทึกแม่แบบใหม่");
            if (!round.HasValue) foreach (int r in rounds.Select(x => x.Value)) EnsureRoundInShift(c, t, s, r);
            int h = Header(c, t, date, s, uid);
            c.Execute(@"DELETE D FROM EDP.PlanCards D JOIN EDP.vw_PlanCards E ON E.PLD_ID = D.PLD_ID
                        WHERE D.PLH_ID = @h AND (@r IS NULL OR E.EFF_ROUND_ID = @r)", new { h, r = round }, t);   // รอบจริง (CHK-03)
            rows += c.Execute(@"INSERT INTO EDP.PlanCards (PLH_ID, PT_ID, TIME_START, TIME_END, QTY_PLAN, HG_PLAN, IS_VISIBLE, ROUND_ID)
                                SELECT @h, D.PT_ID, D.TIME_START, D.TIME_END, ISNULL(D.QTY_PLAN,0), ISNULL(D.HG_PLAN,0), 1, " + expr +
                              " FROM EDP.PlanTemplateCards D" + where + " ORDER BY D.SEQ, D.TPD_ID", new { h, id = tplId, s, r = round }, t);
        }
        if (rows == 0) { t.Rollback(); return 0; }
        t.Commit();
        return rows;
    }

    // ---------------------------------------------------------------- EDP Planning (ตารางติดตาม)
    // ทั้งกะ: รวมยอดตามชิ้นงาน (เหมือน sp_SearchEDPPlanByDate) · ALL: รายการ์ด · วันที่ว่าง = แผนล่าสุดของกะ
    public (DateTime? Date, List<EdpMonitorRow> Rows) Monitor(DateTime? date, string shift, string q)
    {
        using var c = Conn();
        shift = string.IsNullOrEmpty(shift) ? AllDay : shift;
        DateTime? d = date?.Date ?? c.ExecuteScalar<DateTime?>("SELECT MAX(PLH_DATE) FROM EDP.PlanHeaders WHERE (@shift = 'ALL' OR SHIFT = @shift)", new { shift });
        if (d == null) return (null, new List<EdpMonitorRow>());
        string like = "%" + (q ?? "").Trim() + "%";
        const string baseSql = @"
            FROM EDP.PlanCards D JOIN EDP.PlanHeaders H ON H.PLH_ID = D.PLH_ID LEFT JOIN EDP.vw_Parts P ON P.PT_ID = D.PT_ID
            WHERE ISNULL(D.IS_VISIBLE,1) = 1 AND H.PLH_DATE = @d AND (@shift = 'ALL' OR H.SHIFT = @shift)
              AND (ISNULL(P.PT_CODE,'') LIKE @like OR ISNULL(P.PT_NO,'') LIKE @like OR ISNULL(P.CUST_CODE,'') LIKE @like)";
        string sql = shift == AllDay
            ? @"SELECT D.PLD_ID AS Id, P.CUST_CODE AS Customer, P.PT_CODE AS PartCode, P.PT_NO AS PartNo, P.PT_NAME AS PartName,
                       ISNULL(D.QTY_PLAN,0) AS [Plan], ISNULL(D.QTY_ACT,0) AS Actual, ISNULL(D.HG_PLAN,0) AS QtyHg, ISNULL(D.HG_ACT,0) AS HgAct,
                       D.CUR_STD_TIME_HG AS CycleTime, ISNULL(D.HG_ACT,0) * 195 / 3600.0 AS TotalTimeMin, D.OP_NAME AS Operator, D.REMARK AS Remark,
                       CAST(ISNULL(D.IS_DONE,0) AS BIT) AS IsDone, CAST(ISNULL(D.IS_PROBLEM,0) AS BIT) AS IsProblem, H.SHIFT AS Shift" + baseSql +
              " ORDER BY P.CUST_CODE, P.PT_NO"
            : @"SELECT MIN(D.PLD_ID) AS Id, P.CUST_CODE AS Customer, P.PT_CODE AS PartCode, P.PT_NO AS PartNo, P.PT_NAME AS PartName,
                       SUM(ISNULL(D.QTY_PLAN,0)) AS [Plan], SUM(ISNULL(D.QTY_ACT,0)) AS Actual, SUM(ISNULL(D.HG_PLAN,0)) AS QtyHg, SUM(ISNULL(D.HG_ACT,0)) AS HgAct,
                       MAX(D.CUR_STD_TIME_HG) AS CycleTime, SUM(ISNULL(D.HG_ACT,0)) * 195 / 3600.0 AS TotalTimeMin, MAX(D.OP_NAME) AS Operator, MAX(D.REMARK) AS Remark,
                       CAST(MAX(CAST(ISNULL(D.IS_DONE,0) AS INT)) AS BIT) AS IsDone, CAST(MAX(CAST(ISNULL(D.IS_PROBLEM,0) AS INT)) AS BIT) AS IsProblem,
                       MAX(H.SHIFT) AS Shift" + baseSql +
              " GROUP BY P.CUST_CODE, P.PT_CODE, P.PT_NO, P.PT_NAME ORDER BY P.CUST_CODE, P.PT_NO";
        return (d, c.Query<EdpMonitorRow>(sql, new { d, shift, like }).ToList());
    }

    //   แก้จากโปรแกรมเดิม (SPEC CHK-05): เดิมเขียน IS_DONE ค่ารวมของกลุ่มลงการ์ดใบแรกทุกครั้งที่บันทึก Operator / Remark -> ใบแรกกลายเป็น DONE ทั้งที่ยังไม่ผลิต
    //   ตอนนี้: done = null (ไม่ได้ติ๊ก) ไม่แตะ IS_DONE · ติ๊ก DONE ของแถวรวม (group) = ทุกการ์ดที่แสดงของชิ้นงานนั้นในแผน (วันที่ + กะ) เดียวกัน
    public bool UpdateMonitor(int id, string op, string remark, bool? done, bool group)
    {
        using var c = Conn();
        c.Open();
        using var t = c.BeginTransaction();
        if (c.Execute("UPDATE EDP.PlanCards SET OP_NAME = @op, REMARK = @remark WHERE PLD_ID = @id", new { id, op, remark }, t) == 0) return false;
        if (done.HasValue)
            c.Execute(group
                ? @"UPDATE D SET D.IS_DONE = @done FROM EDP.PlanCards D JOIN EDP.PlanCards X ON X.PLH_ID = D.PLH_ID AND X.PT_ID = D.PT_ID
                    WHERE X.PLD_ID = @id AND ISNULL(D.IS_VISIBLE, 1) = 1"
                : "UPDATE EDP.PlanCards SET IS_DONE = @done WHERE PLD_ID = @id", new { id, done = done.Value }, t);
        t.Commit();
        return true;
    }

    // Excel แบบเดิม: วันที่ · กะ DAY แล้ว NIGHT · รวมทั้งหมด
    public byte[] Export(DateTime date)
    {
        var day = Monitor(date, "DAY", "").Rows;
        var night = Monitor(date, "NIGHT", "").Rows;
        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("EDP Planning");
        ws.Cell(1, 1).Value = $"วันที่ : {date:dd/MM/yyyy}";
        ws.Cell(1, 1).Style.Font.Bold = true;
        string[] head = { "SHIFT", "CUSTOMER", "PART CODE", "PART NO", "PART NAME", "QTY HG", "PLAN", "ACTUAL", "TOTAL TIME", "OPERATOR", "REMARK" };
        for (int i = 0; i < head.Length; i++) ws.Cell(3, i + 1).Value = head[i];
        var hr = ws.Range(3, 1, 3, head.Length);
        hr.Style.Font.Bold = true; hr.Style.Font.FontColor = XLColor.White; hr.Style.Fill.BackgroundColor = XLColor.FromHtml("#3F3F46");
        int row = 4;
        foreach (var (name, rows) in new[] { ("DAY", day), ("NIGHT", night) })
            foreach (var r in rows)
            {
                ws.Cell(row, 1).Value = name; ws.Cell(row, 2).Value = r.Customer; ws.Cell(row, 3).Value = r.PartCode; ws.Cell(row, 4).Value = r.PartNo;
                ws.Cell(row, 5).Value = r.PartName; ws.Cell(row, 6).Value = r.QtyHg; ws.Cell(row, 7).Value = r.Plan; ws.Cell(row, 8).Value = r.Actual;
                ws.Cell(row, 9).Value = Math.Round((double)(r.TotalTimeMin ?? 0), 2);
                ws.Cell(row, 10).Value = r.Operator; ws.Cell(row, 11).Value = r.Remark;
                row++;
            }
        ws.Cell(row, 1).Value = "รวมทั้งหมด (Total)";
        ws.Range(row, 1, row, 5).Merge().Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
        var all = day.Concat(night).ToList();
        ws.Cell(row, 6).Value = all.Sum(x => x.QtyHg); ws.Cell(row, 7).Value = all.Sum(x => x.Plan); ws.Cell(row, 8).Value = all.Sum(x => x.Actual);
        ws.Cell(row, 9).Value = Math.Round((double)all.Sum(x => x.TotalTimeMin ?? 0), 2);
        ws.Range(row, 1, row, head.Length).Style.Font.Bold = true;
        ws.Range(3, 1, row, head.Length).Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
        ws.Range(3, 1, row, head.Length).Style.Border.InsideBorder = XLBorderStyleValues.Thin;
        ws.Columns().AdjustToContents();
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    // ---------------------------------------------------------------- กราฟ (เฉพาะการ์ดที่ Show)
    public object Graph()
    {
        using var c = Conn();
        var monthly = c.Query<(int M, double Eff)>(@"
            SELECT MONTH(H.PLH_DATE), CASE WHEN SUM(D.HG_PLAN) > 0 THEN SUM(ISNULL(D.HG_ACT,0)) * 100.0 / SUM(D.HG_PLAN) ELSE 0 END
            FROM EDP.PlanHeaders H JOIN EDP.PlanCards D ON D.PLH_ID = H.PLH_ID
            WHERE ISNULL(D.IS_VISIBLE,1) = 1 AND YEAR(H.PLH_DATE) = YEAR(GETDATE()) GROUP BY MONTH(H.PLH_DATE)").ToDictionary(x => x.M, x => x.Eff);
        var daily = c.Query<(DateTime D, double Plan, double Act, double QPlan, double QAct)>(@"
            SELECT H.PLH_DATE, ISNULL(SUM(D.HG_PLAN),0), ISNULL(SUM(D.HG_ACT),0), ISNULL(SUM(D.QTY_PLAN),0), ISNULL(SUM(D.QTY_ACT),0)
            FROM EDP.PlanHeaders H JOIN EDP.PlanCards D ON D.PLH_ID = H.PLH_ID
            WHERE ISNULL(D.IS_VISIBLE,1) = 1 AND YEAR(H.PLH_DATE) = YEAR(GETDATE()) AND MONTH(H.PLH_DATE) = MONTH(GETDATE())
            GROUP BY H.PLH_DATE").ToDictionary(x => x.D.Day);
        var rounds = c.Query<(int Round, int Start, int End, double Plan, double Act, double QPlan, double QAct)>(@"
            SELECT R.ROUND_ID, ISNULL(R.START_HOUR,0), ISNULL(R.END_HOUR,0), ISNULL(SUM(D.HG_PLAN),0), ISNULL(SUM(D.HG_ACT),0), ISNULL(SUM(D.QTY_PLAN),0), ISNULL(SUM(D.QTY_ACT),0)
            FROM EDP.Rounds R
            LEFT JOIN (EDP.vw_PlanCards D JOIN EDP.PlanHeaders H ON H.PLH_ID = D.PLH_ID AND H.PLH_DATE = CAST(GETDATE() AS DATE))
                   ON D.EFF_ROUND_ID = R.ROUND_ID AND ISNULL(D.IS_VISIBLE,1) = 1
            GROUP BY R.ROUND_ID, R.START_HOUR, R.END_HOUR ORDER BY R.ROUND_ID").ToList();
        var hgMonth = c.Query<(int M, double Plan, double Act, double QPlan, double QAct)>(@"
            SELECT MONTH(H.PLH_DATE), ISNULL(SUM(D.HG_PLAN),0), ISNULL(SUM(D.HG_ACT),0), ISNULL(SUM(D.QTY_PLAN),0), ISNULL(SUM(D.QTY_ACT),0)
            FROM EDP.PlanHeaders H JOIN EDP.PlanCards D ON D.PLH_ID = H.PLH_ID
            WHERE ISNULL(D.IS_VISIBLE,1) = 1 AND YEAR(H.PLH_DATE) = YEAR(GETDATE()) GROUP BY MONTH(H.PLH_DATE)").ToDictionary(x => x.M);
        var custs = c.Query<(string Name, double Hg, double Pcs)>(@"
            SELECT ISNULL(NULLIF(P.CUST_CODE,''),'-'), SUM(ISNULL(D.HG_ACT,0)), SUM(ISNULL(D.QTY_ACT,0))
            FROM EDP.PlanHeaders H JOIN EDP.PlanCards D ON D.PLH_ID = H.PLH_ID LEFT JOIN EDP.vw_Parts P ON P.PT_ID = D.PT_ID
            WHERE ISNULL(D.IS_VISIBLE,1) = 1 AND YEAR(H.PLH_DATE) = YEAR(GETDATE()) AND MONTH(H.PLH_DATE) = MONTH(GETDATE())
            GROUP BY ISNULL(NULLIF(P.CUST_CODE,''),'-') HAVING SUM(ISNULL(D.HG_ACT,0)) > 0 OR SUM(ISNULL(D.QTY_ACT,0)) > 0 ORDER BY 2 DESC").ToList();
        double custTotal = custs.Sum(x => x.Hg), custPcs = custs.Sum(x => x.Pcs);
        var now = DateTime.Now;
        string[] mn = { "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" };
        return new
        {
            month = now.ToString("MM/yyyy"),
            year = now.Year,
            hgMonths = Enumerable.Range(1, 12).Select(m => new { label = mn[m - 1], plan = hgMonth.TryGetValue(m, out var x) ? x.Plan : 0, act = hgMonth.TryGetValue(m, out var y) ? y.Act : 0,
                                                             qtyPlan = hgMonth.TryGetValue(m, out var q1) ? q1.QPlan : 0, qtyAct = hgMonth.TryGetValue(m, out var q2) ? q2.QAct : 0 }),
            customers = custs.Select(x => new { name = x.Name, amount = x.Hg, percentage = custTotal > 0 ? Math.Round(x.Hg * 100 / custTotal, 1) : 0,
                                          pcs = x.Pcs, pcsPct = custPcs > 0 ? Math.Round(x.Pcs * 100 / custPcs, 1) : 0 }),
            monthly = Enumerable.Range(1, 12).Select(m => new { name = mn[m - 1], eff = Math.Round(monthly.GetValueOrDefault(m), 1) }),
            daily = Enumerable.Range(1, DateTime.DaysInMonth(now.Year, now.Month)).Select(d => new
            {
                day = $"{d:D2}/{now:MM}",
                plan = daily.TryGetValue(d, out var v) ? v.Plan : 0,
                act = daily.TryGetValue(d, out var w) ? w.Act : 0,
                qtyPlan = daily.TryGetValue(d, out var q3) ? q3.QPlan : 0,
                qtyAct = daily.TryGetValue(d, out var q4) ? q4.QAct : 0
            }),
            rounds = rounds.Select(r => new { round = r.Round, start = r.Start, end = r.End, plan = r.Plan, act = r.Act, qtyPlan = r.QPlan, qtyAct = r.QAct, eff = r.Plan > 0 ? Math.Min(100, Math.Round(r.Act * 100 / r.Plan, 1)) : 0 })
        };
    }

    // ---------------------------------------------------------------- ⏰ แจ้งเตือนการ์ดเลยเวลา (SETUP › EDP ALERT)
    public const string SnoozeKey = "EDP_ALERT_SNOOZE";

    public EdpAlertSettings AlertSettings()
    {
        using var c = Conn();
        string extra = DbSchema.HasEdpAlertSound ? ", AlertUsers, SoundOn, SoundId, LeadRepeat, EndChime, GapSeconds, AlarmVolume, VoiceVolume, VoiceRate, MsgTh, MsgMy" : "";
        return c.QueryFirstOrDefault<EdpAlertSettings>($"SELECT Enabled, GraceMinutes, RemindMinutes, OnlyStarted, UpdatedBy, UpdatedDate{extra} FROM EDP.AlertSettings WHERE Id = 1") ?? new EdpAlertSettings();
    }

    public void SaveAlertSettings(EdpAlertSettings s, string uid)
    {
        using var c = Conn();
        c.Execute(@"MERGE EDP.AlertSettings AS t USING (SELECT 1 AS Id) AS x ON t.Id = x.Id
                    WHEN MATCHED THEN UPDATE SET Enabled = @Enabled, GraceMinutes = @GraceMinutes, RemindMinutes = @RemindMinutes, OnlyStarted = @OnlyStarted, UpdatedBy = @uid, UpdatedDate = GETDATE()
                    WHEN NOT MATCHED THEN INSERT (Id, Enabled, GraceMinutes, RemindMinutes, OnlyStarted, UpdatedBy) VALUES (1, @Enabled, @GraceMinutes, @RemindMinutes, @OnlyStarted, @uid);",
                  new { s.Enabled, s.GraceMinutes, s.RemindMinutes, s.OnlyStarted, uid });
        if (!DbSchema.HasEdpAlertSound) return;
        c.Execute(@"UPDATE EDP.AlertSettings SET AlertUsers = @AlertUsers, SoundOn = @SoundOn, SoundId = @SoundId, LeadRepeat = @LeadRepeat, EndChime = @EndChime, GapSeconds = @GapSeconds,
                           AlarmVolume = @AlarmVolume, VoiceVolume = @VoiceVolume, VoiceRate = @VoiceRate, MsgTh = @MsgTh, MsgMy = @MsgMy WHERE Id = 1",
                  new { s.AlertUsers, s.SoundOn, s.SoundId, s.LeadRepeat, s.EndChime, s.GapSeconds, s.AlarmVolume, s.VoiceVolume, s.VoiceRate, s.MsgTh, s.MsgMy });
    }

    // ---------------------------------------------------------------- 🗣 ไฟล์เสียงประโยค (อัพโหลดเอง)
    public static string TextKey(string text)
    {
        var h = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes((text ?? "").Trim()));
        return Convert.ToHexString(h).ToLowerInvariant();
    }

    public List<EdpVoice> Voices()
    {
        using var c = Conn();
        return c.Query<EdpVoice>("SELECT Lang, TextKey, ContentType, UpdatedDate, UpdatedBy FROM EDP.AlertVoices").ToList();
    }

    public (byte[] Audio, string ContentType)? Voice(string lang, string key)
    {
        using var c = Conn();
        var r = c.QueryFirstOrDefault<(byte[] Audio, string ContentType)?>("SELECT Audio, ContentType FROM EDP.AlertVoices WHERE Lang = @lang AND TextKey = @key", new { lang, key });
        return r;
    }

    public string SaveVoice(string lang, string text, byte[] audio, string contentType, string uid)
    {
        string key = TextKey(text);
        using var c = Conn();
        c.Execute(@"MERGE EDP.AlertVoices AS t USING (SELECT @lang AS Lang, @key AS TextKey) AS x ON t.Lang = x.Lang AND t.TextKey = x.TextKey
                    WHEN MATCHED THEN UPDATE SET [Text] = @text, Audio = @audio, ContentType = @contentType, UpdatedBy = @uid, UpdatedDate = GETDATE()
                    WHEN NOT MATCHED THEN INSERT (Lang, TextKey, [Text], Audio, ContentType, UpdatedBy) VALUES (@lang, @key, @text, @audio, @contentType, @uid);",
                  new { lang, key, text = text.Trim(), audio, contentType, uid });
        return key;
    }

    public bool DeleteVoice(string lang, string key)
    {
        using var c = Conn();
        return c.Execute("DELETE FROM EDP.AlertVoices WHERE Lang = @lang AND TextKey = @key", new { lang, key }) > 0;
    }

    // CANCEL ของผู้ใช้แต่ละคน (Nexus.UserSettings) -> ซ่อนจนถึงเวลานี้ แล้วแจ้งซ้ำ
    public static DateTime? GetSnooze(string uid)
    {
        string v = UserSettings.Get(uid, SnoozeKey);
        return DateTime.TryParse(v, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var d) ? d : null;
    }

    public static DateTime Snooze(string uid, int minutes)
    {
        var until = DateTime.Now.AddMinutes(Math.Max(1, minutes));
        UserSettings.Set(uid, SnoozeKey, until.ToString("yyyy-MM-ddTHH:mm:ss", System.Globalization.CultureInfo.InvariantCulture));
        return until;
    }
}
