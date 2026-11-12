using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;

namespace Nexus.Services;

// ⚙ SETUP › ADD USERID : ตัวเลือก Dropdown ของฟอร์มผู้ใช้ (database/nexus/43_User_Org_Options.sql)
//   POSITION = รายการเดียว · DIVISION (ฝ่าย) -> SECTION (แผนก) -> UNIT (หน่วยงาน) = ผูกกันเป็นลำดับชั้น
//   ผู้ใช้เก็บเป็นข้อความเหมือนเดิม (Nexus.Users) -> แก้ / ลบตัวเลือกไม่กระทบผู้ใช้ที่มีอยู่
public sealed class UserOrgService
{
    public static readonly string[] Kinds = { "POSITION", "DIVISION", "SECTION", "UNIT" };
    private static SqlConnection Conn() => new(GlobalConfig.ConnStr);

    public sealed record Opt(int Id, string Kind, string Name, int? ParentId, int Sort);
    // Id ติดลบ = รายการใหม่ (ParentId อ้างรายการใหม่ได้ด้วยเลขติดลบเดียวกัน)
    public sealed record Item(int Id, string Kind, string Name, int? ParentId);

    public List<Opt> All()
    {
        using var c = Conn();
        return c.Query<Opt>(@"SELECT OptionID AS Id, Kind, Name, ParentID AS ParentId, SortNo AS Sort FROM Nexus.UserOrgOptions
                              ORDER BY CASE Kind WHEN 'POSITION' THEN 0 WHEN 'DIVISION' THEN 1 WHEN 'SECTION' THEN 2 ELSE 3 END, ParentID, SortNo, Name").ToList();
    }

    // บันทึกทั้งชุด: ที่ไม่มีในรายการ = ลบ (ลบฝ่าย = ลบแผนก / หน่วยงานข้างใต้ด้วย) · ลำดับ = ตามที่ส่งมา
    public (int Added, int Updated, int Deleted) Save(List<Item> items, string uid)
    {
        items ??= new();
        var clean = items.Select(x => x with { Kind = (x.Kind ?? "").Trim().ToUpperInvariant(), Name = System.Text.RegularExpressions.Regex.Replace(x.Name ?? "", @"\s+", " ").Trim() }).ToList();
        var byId = clean.ToDictionary(x => x.Id);
        foreach (var x in clean)
        {
            if (!Kinds.Contains(x.Kind)) throw new InvalidOperationException($"ประเภท {x.Kind} ไม่ถูกต้อง");
            if (x.Name.Length == 0) throw new InvalidOperationException("มีตัวเลือกที่ชื่อว่าง กรุณาใส่ชื่อ หรือกด ✕ เพื่อลบ");
            if (x.Name.Length > 100) throw new InvalidOperationException($"\"{x.Name[..20]}…\" ยาวเกิน 100 ตัวอักษร");
            string need = x.Kind == "SECTION" ? "DIVISION" : x.Kind == "UNIT" ? "SECTION" : null;
            if (need == null && x.ParentId != null) throw new InvalidOperationException($"{x.Name}: {x.Kind} ไม่มีลำดับชั้นบน");
            if (x.ParentId != null && (!byId.TryGetValue(x.ParentId.Value, out var p) || p.Kind != need)) throw new InvalidOperationException($"{x.Name}: ไม่พบ{(need == "DIVISION" ? "ฝ่าย" : "แผนก")}ที่สังกัด");
        }
        var dup = clean.GroupBy(x => (x.Kind, x.ParentId, Name: x.Name.ToUpperInvariant())).FirstOrDefault(g => g.Count() > 1);
        if (dup != null) throw new InvalidOperationException($"\"{dup.First().Name}\" ซ้ำกันในรายการเดียวกัน");

        using var c = Conn();
        c.Open();
        using var t = c.BeginTransaction();
        var have = c.Query<int>("SELECT OptionID FROM Nexus.UserOrgOptions", transaction: t).ToHashSet();
        var map = new Dictionary<int, int>();
        int add = 0, upd = 0;
        foreach (string kind in Kinds)
            foreach (var g in clean.Where(x => x.Kind == kind).GroupBy(x => x.ParentId))
            {
                int sort = 0;
                foreach (var x in g)
                {
                    sort++;
                    int? parent = x.ParentId == null ? null : x.ParentId.Value > 0 ? x.ParentId.Value : map[x.ParentId.Value];
                    if (x.Id > 0 && have.Contains(x.Id))
                    {
                        upd += c.Execute(@"UPDATE Nexus.UserOrgOptions SET Name = @Name, ParentID = @parent, SortNo = @sort, UpdatedBy = @uid, UpdatedAt = SYSDATETIME()
                                           WHERE OptionID = @Id AND (Name <> @Name COLLATE Latin1_General_CS_AS OR ISNULL(ParentID, 0) <> ISNULL(@parent, 0) OR SortNo <> @sort)",
                                         new { x.Name, parent, sort, uid, x.Id }, t);
                        map[x.Id] = x.Id;
                    }
                    else
                    {
                        map[x.Id] = c.ExecuteScalar<int>(@"INSERT INTO Nexus.UserOrgOptions (Kind, Name, ParentID, SortNo, UpdatedBy) VALUES (@Kind, @Name, @parent, @sort, @uid);
                                                           SELECT CAST(SCOPE_IDENTITY() AS INT);", new { x.Kind, x.Name, parent, sort, uid }, t);
                        add++;
                    }
                }
            }
        // ที่ไม่ได้ส่งมา = ลบ (ลูกที่ยังอ้างถึง = ลบไปด้วย)
        var keep = map.Values.ToHashSet();
        var gone = have.Where(id => !keep.Contains(id)).ToList();
        int del = 0;
        if (gone.Count > 0)
        {
            del += c.Execute("DELETE FROM Nexus.UserOrgOptions WHERE ParentID IN (SELECT OptionID FROM Nexus.UserOrgOptions WHERE ParentID IN @gone)", new { gone }, t);
            del += c.Execute("DELETE FROM Nexus.UserOrgOptions WHERE ParentID IN @gone", new { gone }, t);
            del += c.Execute("DELETE FROM Nexus.UserOrgOptions WHERE OptionID IN @gone", new { gone }, t);
        }
        t.Commit();
        return (add, upd, del);
    }
}
