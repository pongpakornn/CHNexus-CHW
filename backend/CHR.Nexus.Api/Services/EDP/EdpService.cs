using ClosedXML.Excel;
using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;

namespace Nexus.Services;

// 🏭 EDP PLANNING (schema EDP ในฐาน CHR-Nexus) - ย้ายมาจากโปรแกรม EDP Systems (WPF) เงื่อนไขเดิมทุกข้อ
//   ชิ้นงาน = EDP.vw_Parts (VIEW เหนือ MASTER DATA › Product Control › STORE-PC) · PT_ID = Nexus.Parts.PartID
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
    public int QtyPlan { get; set; }
    public int HgPlan { get; set; }
    public int QtyAct { get; set; }
    public int? HgAct { get; set; }
    public bool IsDone { get; set; }
    public bool IsVisible { get; set; }
    public bool IsProblem { get; set; }
    public string Remark { get; set; }
    public int? OrigHg { get; set; }        // HG ตามแผนก่อนถูกแก้ครั้งแรก (ฐานคิดส่วนต่างเวลา)
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
                   ISNULL(P.PCS_HG,0) AS PcsHg, ISNULL(D.QTY_PLAN,0) AS QtyPlan, ISNULL(D.HG_PLAN,0) AS HgPlan, ISNULL(D.QTY_ACT,0) AS QtyAct, D.HG_ACT AS HgAct,
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
        foreach (var card in list) if (orig.TryGetValue(card.PldId, out int h)) card.OrigHg = h;
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

    // ---------------------------------------------------------------- Plan Submission (หน้างาน)
    public void Start(DateTime date, string shift)
    {
        using var c = Conn();
        c.Execute("UPDATE EDP.PlanHeaders SET STAT = 'IN PROGRESS' WHERE PLH_DATE = @date AND (@shift = 'ALL' OR SHIFT = @shift) AND STAT = 'READY'",
                  new { date = date.Date, shift });
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
            if (nw == default) throw new InvalidOperationException("ไม่พบชิ้นงานที่เลือกใน STORE-PC");
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
    public int Save(DateTime date, string shift, int round, List<EdpPlanCardIn> cards, string uid)
    {
        using var c = Conn();
        c.Open();
        EnsureRoundInShift(c, null, shift, round);
        using var t = c.BeginTransaction();
        int h = Header(c, t, date, shift, uid);
        c.Execute("DELETE FROM EDP.PlanCards WHERE PLH_ID = @h AND ROUND_ID = @round", new { h, round }, t);
        c.Execute(@"INSERT INTO EDP.PlanCards (PLH_ID, PT_ID, TIME_START, TIME_END, QTY_PLAN, HG_PLAN, IS_VISIBLE, ROUND_ID)
                    VALUES (@h, @PartId, @TimeStart, @TimeEnd, @Qty, @Hg, @Visible, @round)",
                  cards.Select(x => new { h, x.PartId, x.TimeStart, x.TimeEnd, x.Qty, x.Hg, x.Visible, round }), t);
        t.Commit();
        return cards.Count;
    }

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
        c.Execute("DELETE FROM EDP.PlanCards WHERE PLH_ID = @h AND (@tr IS NULL OR ROUND_ID = @tr)", new { h, tr }, t);
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
    public (int Removed, int Kept) Clear(DateTime date, string shift, int? round, bool includeDone)
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
        t.Commit();
        return (removed, kept);
    }

    // ---------------------------------------------------------------- แม่แบบ
    public List<EdpTemplate> Templates()
    {
        using var c = Conn();
        return c.Query<EdpTemplate>(@"SELECT T.TPL_ID AS TplId, T.TPL_NAME AS TplName, T.SHIFT AS Shift, T.ROUND_ID AS RoundId, T.REMARK AS Remark,
                                             T.CREATE_BY AS CreateBy, T.CREATE_AT AS CreateAt, T.UPDATE_AT AS UpdateAt,
                                             (SELECT COUNT(*) FROM EDP.PlanTemplateCards D WHERE D.TPL_ID = T.TPL_ID) AS CardCount
                                      FROM EDP.PlanTemplates T ORDER BY T.TPL_NAME").ToList();
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
            c.Execute("DELETE FROM EDP.PlanCards WHERE PLH_ID = @h AND (@r IS NULL OR ROUND_ID = @r)", new { h, r = round }, t);
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
                       D.CUR_STD_TIME_HG AS CycleTime, D.TOTAL_TIME_MIN / 60.0 AS TotalTimeMin, D.OP_NAME AS Operator, D.REMARK AS Remark,
                       CAST(ISNULL(D.IS_DONE,0) AS BIT) AS IsDone, CAST(ISNULL(D.IS_PROBLEM,0) AS BIT) AS IsProblem, H.SHIFT AS Shift" + baseSql +
              " ORDER BY P.CUST_CODE, P.PT_NO"
            : @"SELECT MIN(D.PLD_ID) AS Id, P.CUST_CODE AS Customer, P.PT_CODE AS PartCode, P.PT_NO AS PartNo, P.PT_NAME AS PartName,
                       SUM(ISNULL(D.QTY_PLAN,0)) AS [Plan], SUM(ISNULL(D.QTY_ACT,0)) AS Actual, SUM(ISNULL(D.HG_PLAN,0)) AS QtyHg, SUM(ISNULL(D.HG_ACT,0)) AS HgAct,
                       MAX(D.CUR_STD_TIME_HG) AS CycleTime, SUM(D.TOTAL_TIME_MIN / 60.0) AS TotalTimeMin, MAX(D.OP_NAME) AS Operator, MAX(D.REMARK) AS Remark,
                       CAST(MAX(CAST(ISNULL(D.IS_DONE,0) AS INT)) AS BIT) AS IsDone, CAST(MAX(CAST(ISNULL(D.IS_PROBLEM,0) AS INT)) AS BIT) AS IsProblem,
                       MAX(H.SHIFT) AS Shift" + baseSql +
              " GROUP BY P.CUST_CODE, P.PT_CODE, P.PT_NO, P.PT_NAME ORDER BY P.CUST_CODE, P.PT_NO";
        return (d, c.Query<EdpMonitorRow>(sql, new { d, shift, like }).ToList());
    }

    public bool UpdateMonitor(int id, string op, string remark, bool done)
    {
        using var c = Conn();
        return c.Execute("UPDATE EDP.PlanCards SET OP_NAME = @op, REMARK = @remark, IS_DONE = @done WHERE PLD_ID = @id", new { id, op, remark, done }) > 0;
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
                ws.Cell(row, 9).Value = (double)(r.TotalTimeMin ?? 0) / 24.0; ws.Cell(row, 9).Style.NumberFormat.Format = "[h]:mm";
                ws.Cell(row, 10).Value = r.Operator; ws.Cell(row, 11).Value = r.Remark;
                row++;
            }
        ws.Cell(row, 1).Value = "รวมทั้งหมด (Total)";
        ws.Range(row, 1, row, 5).Merge().Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
        var all = day.Concat(night).ToList();
        ws.Cell(row, 6).Value = all.Sum(x => x.QtyHg); ws.Cell(row, 7).Value = all.Sum(x => x.Plan); ws.Cell(row, 8).Value = all.Sum(x => x.Actual);
        ws.Cell(row, 9).Value = (double)all.Sum(x => x.TotalTimeMin ?? 0) / 24.0; ws.Cell(row, 9).Style.NumberFormat.Format = "[h]:mm";
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
        var daily = c.Query<(DateTime D, double Plan, double Act)>(@"
            SELECT H.PLH_DATE, ISNULL(SUM(D.HG_PLAN),0), ISNULL(SUM(D.HG_ACT),0)
            FROM EDP.PlanHeaders H JOIN EDP.PlanCards D ON D.PLH_ID = H.PLH_ID
            WHERE ISNULL(D.IS_VISIBLE,1) = 1 AND YEAR(H.PLH_DATE) = YEAR(GETDATE()) AND MONTH(H.PLH_DATE) = MONTH(GETDATE())
            GROUP BY H.PLH_DATE").ToDictionary(x => x.D.Day);
        var rounds = c.Query<(int Round, int Start, int End, double Plan, double Act)>(@"
            SELECT R.ROUND_ID, ISNULL(R.START_HOUR,0), ISNULL(R.END_HOUR,0), ISNULL(SUM(D.HG_PLAN),0), ISNULL(SUM(D.HG_ACT),0)
            FROM EDP.Rounds R
            LEFT JOIN (EDP.vw_PlanCards D JOIN EDP.PlanHeaders H ON H.PLH_ID = D.PLH_ID AND H.PLH_DATE = CAST(GETDATE() AS DATE))
                   ON D.EFF_ROUND_ID = R.ROUND_ID AND ISNULL(D.IS_VISIBLE,1) = 1
            GROUP BY R.ROUND_ID, R.START_HOUR, R.END_HOUR ORDER BY R.ROUND_ID").ToList();
        var hgMonth = c.Query<(int M, double Plan, double Act)>(@"
            SELECT MONTH(H.PLH_DATE), ISNULL(SUM(D.HG_PLAN),0), ISNULL(SUM(D.HG_ACT),0)
            FROM EDP.PlanHeaders H JOIN EDP.PlanCards D ON D.PLH_ID = H.PLH_ID
            WHERE ISNULL(D.IS_VISIBLE,1) = 1 AND YEAR(H.PLH_DATE) = YEAR(GETDATE()) GROUP BY MONTH(H.PLH_DATE)").ToDictionary(x => x.M);
        var custs = c.Query<(string Name, double Hg)>(@"
            SELECT ISNULL(NULLIF(P.CUST_CODE,''),'-'), SUM(ISNULL(D.HG_ACT,0))
            FROM EDP.PlanHeaders H JOIN EDP.PlanCards D ON D.PLH_ID = H.PLH_ID LEFT JOIN EDP.vw_Parts P ON P.PT_ID = D.PT_ID
            WHERE ISNULL(D.IS_VISIBLE,1) = 1 AND YEAR(H.PLH_DATE) = YEAR(GETDATE()) AND MONTH(H.PLH_DATE) = MONTH(GETDATE())
            GROUP BY ISNULL(NULLIF(P.CUST_CODE,''),'-') HAVING SUM(ISNULL(D.HG_ACT,0)) > 0 ORDER BY 2 DESC").ToList();
        double custTotal = custs.Sum(x => x.Hg);
        var now = DateTime.Now;
        string[] mn = { "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" };
        return new
        {
            month = now.ToString("MM/yyyy"),
            year = now.Year,
            hgMonths = Enumerable.Range(1, 12).Select(m => new { label = mn[m - 1], plan = hgMonth.TryGetValue(m, out var x) ? x.Plan : 0, act = hgMonth.TryGetValue(m, out var y) ? y.Act : 0 }),
            customers = custs.Select(x => new { name = x.Name, amount = x.Hg, percentage = custTotal > 0 ? Math.Round(x.Hg * 100 / custTotal, 1) : 0 }),
            monthly = Enumerable.Range(1, 12).Select(m => new { name = mn[m - 1], eff = Math.Round(monthly.GetValueOrDefault(m), 1) }),
            daily = Enumerable.Range(1, DateTime.DaysInMonth(now.Year, now.Month)).Select(d => new
            {
                day = $"{d:D2}/{now:MM}",
                plan = daily.TryGetValue(d, out var v) ? v.Plan : 0,
                act = daily.TryGetValue(d, out var w) ? w.Act : 0
            }),
            rounds = rounds.Select(r => new { round = r.Round, start = r.Start, end = r.End, plan = r.Plan, act = r.Act, eff = r.Plan > 0 ? Math.Min(100, Math.Round(r.Act * 100 / r.Plan, 1)) : 0 })
        };
    }
}
