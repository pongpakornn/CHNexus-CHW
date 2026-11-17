using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;

namespace Nexus.Services;

// 📍 LAYOUT SETUP : ตำแหน่งจัดเก็บ (ประเภท เช่น RACK1 + ชื่อ เช่น 3A) -> Export QR ตำแหน่ง -> สแกนที่ Multi-Scanner ก่อนสแกนป้ายลูกค้า
//   รูปแบบข้อมูลใน QR (ทั้งระบบ): ช่อง TYPE / NAME เรียงตามที่เลือก + ตัวคั่น เช่น "RACK1 3A" / "RACK1|3A" / "3A"
//   ค่าที่หน้า Multi-Scanner แสดง + บันทึกกับแถวสแกน (Nexus.ScanTransactions.Layout) = ข้อความตามรูปแบบนี้ · ใต้ QR พิมพ์ "RACK1 : 3A"
public sealed class LayoutSettings
{
    public List<string> Fields { get; set; } = new() { "TYPE", "NAME" };
    public string Sep { get; set; } = " ";
    public string UpdatedBy { get; set; }
    public DateTime? UpdatedDate { get; set; }
}

public sealed class LayoutLocation
{
    public int LocId { get; set; }
    public int TypeId { get; set; }
    public string TypeName { get; set; }
    public string LocName { get; set; }
    public string CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class LayoutType
{
    public int TypeId { get; set; }
    public string TypeName { get; set; }
    public string CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
    public List<LayoutLocation> Locations { get; set; } = new();
}

public sealed class LayoutService
{
    public static readonly string[] AllFields = { "TYPE", "NAME" };
    private static SqlConnection Conn() => new(GlobalConfig.ConnStr);

    // ชื่อประเภท / ตำแหน่ง: A-Z 0-9 - _ . / # (ตัวพิมพ์ใหญ่ ไม่มีเว้นวรรค) - เครื่องสแกนอ่านตรงทุกเครื่อง ไม่ชนตัวคั่น
    private static readonly Regex NameOk = new("^[A-Z0-9][A-Z0-9_./#-]{0,49}$", RegexOptions.Compiled);
    public static string CleanName(string v) => (v ?? "").Trim().ToUpperInvariant();
    public static bool ValidName(string v) => NameOk.IsMatch(v ?? "");

    public static List<string> CleanFields(IEnumerable<string> fields)
    {
        var list = (fields ?? Enumerable.Empty<string>()).Select(f => (f ?? "").Trim().ToUpperInvariant()).Where(f => AllFields.Contains(f)).Distinct().ToList();
        return list.Count > 0 ? list : new List<string> { "TYPE", "NAME" };
    }
    public static string CleanSep(string sep) => string.IsNullOrEmpty(sep) || sep.Length > 5 || sep.IndexOfAny(new[] { '\r', '\n' }) >= 0 ? " " : sep;

    // ข้อความใน QR / ค่าที่แสดงที่หน้าสแกน
    public static string QrText(LayoutSettings s, string type, string name) =>
        string.Join(s.Sep, s.Fields.Select(f => f == "TYPE" ? type : name));
    public static string LabelText(string type, string name) => $"{type} : {name}";

    // ---------------------------------------------------------------- ตั้งค่ารูปแบบ QR
    // 📦 PLATE (เหล็กแผ่น S1–S9): ช่องละ 3 แพ็ค (1 แพ็ค = 1 Number Coil) · ใช้ตอนสแกนรับเข้าที่ Multi-Scanner
    public const string PlateType = "PLATE";
    public const int PlateCap = 3;
    /// <summary>Scanned layout text is a PLATE location -> (location name, coils IN there now) · otherwise null.
    /// Counted like Layout 3D: coil still IN + its latest IN move was scanned with this location.</summary>
    public (string Loc, int Count)? PlateLoad(string layout, int? exceptCoilId = null)
    {
        if (string.IsNullOrWhiteSpace(layout)) return null;
        string key = layout.Trim();
        var set = GetSettings();
        using var c = Conn();
        var locs = c.Query<string>(@"SELECT l.LocName FROM Nexus.LayoutLocations l JOIN Nexus.LayoutTypes t ON t.TypeID = l.TypeID WHERE t.TypeName = @t", new { t = PlateType }).ToList();
        foreach (var name in locs)
        {
            bool shared = c.ExecuteScalar<int>("SELECT COUNT(*) FROM Nexus.LayoutLocations l JOIN Nexus.LayoutTypes t ON t.TypeID = l.TypeID WHERE l.LocName = @name AND t.TypeName <> @t", new { name, t = PlateType }) > 0;
            var texts = new[] { QrText(set, PlateType, name), LabelText(PlateType, name), PlateType + " " + name }.Concat(shared ? Array.Empty<string>() : new[] { name }).Distinct(StringComparer.OrdinalIgnoreCase).ToArray(); // bare "S1" only if no other type has S1
            if (!texts.Any(x => string.Equals(x, key, StringComparison.OrdinalIgnoreCase))) continue;
            int n = c.ExecuteScalar<int>(@"
                SELECT COUNT(*) FROM Nexus.Coils k
                CROSS APPLY (" + LatestInMoveSql("k") + @") x
                WHERE k.Status = 'IN' AND x.ToStockID = k.StockID AND LTRIM(RTRIM(x.Layout)) IN @texts AND (@ex IS NULL OR k.CoilID <> @ex)", new { texts, ex = exceptCoilId });
            return (name, n);
        }
        return null;
    }

    /// <summary>Latest IN-move of a coil = where it sits (Layout, TransactionDate, UserID, ToStockID). A MOVE_LAYOUT move (Nexus.CoilMoves.Layout) counts like a scan.</summary>
    public static string LatestInMoveSql(string coil) => Nexus.Helpers.DbSchema.HasCoilMoveLayout
        ? $@"SELECT TOP 1 COALESCE(m.Layout, t.Layout) AS Layout, COALESCE(t.TransactionDate, m.MoveDate) AS TransactionDate, COALESCE(t.UserID, m.UserID) AS UserID, m.ToStockID
             FROM Nexus.CoilMoves m LEFT JOIN Nexus.ScanTransactions t ON t.TransactionID = m.ScanTransactionID
             WHERE m.CoilID = {coil}.CoilID AND m.Undone = 0 AND m.ToStatus = 'IN' AND m.Action <> 'CONSUME' AND (m.ScanTransactionID IS NOT NULL OR m.Layout IS NOT NULL)
             ORDER BY m.MoveID DESC"
        : $@"SELECT TOP 1 t.Layout, t.TransactionDate, t.UserID, m.ToStockID
             FROM Nexus.CoilMoves m JOIN Nexus.ScanTransactions t ON t.TransactionID = m.ScanTransactionID
             WHERE m.CoilID = {coil}.CoilID AND m.Undone = 0 AND m.ToStatus = 'IN' AND m.Action <> 'CONSUME'
             ORDER BY m.MoveID DESC";

    public LayoutSettings GetSettings()
    {
        using var c = Conn();
        var r = c.QueryFirstOrDefault<(string QrFields, string QrSep, string UpdatedBy, DateTime? UpdatedDate)>(
            "SELECT QrFields, QrSep, UpdatedBy, UpdatedDate FROM Nexus.LayoutSettings WHERE Id = 1");
        return new LayoutSettings
        {
            Fields = CleanFields((r.QrFields ?? "").Split(',')),
            Sep = CleanSep(r.QrSep),
            UpdatedBy = r.UpdatedBy,
            UpdatedDate = r.UpdatedDate
        };
    }

    public void SaveSettings(IEnumerable<string> fields, string sep, string uid)
    {
        using var c = Conn();
        c.Execute(@"MERGE Nexus.LayoutSettings AS t USING (SELECT 1 AS Id) AS x ON t.Id = x.Id
                    WHEN MATCHED THEN UPDATE SET QrFields = @f, QrSep = @sep, UpdatedBy = @uid, UpdatedDate = GETDATE()
                    WHEN NOT MATCHED THEN INSERT (Id, QrFields, QrSep, UpdatedBy) VALUES (1, @f, @sep, @uid);",
                  new { f = string.Join(",", CleanFields(fields)), sep = CleanSep(sep), uid });
    }

    // ---------------------------------------------------------------- ประเภท + ตำแหน่ง
    public List<LayoutType> GetTypes()
    {
        using var c = Conn();
        var types = c.Query<LayoutType>("SELECT TypeID AS TypeId, TypeName, CreatedBy, CreatedAt FROM Nexus.LayoutTypes ORDER BY SortNo, TypeName").ToList();
        var locs = AllLocations(c);
        foreach (var t in types) t.Locations = locs.Where(l => l.TypeId == t.TypeId).ToList();
        return types;
    }

    public List<LayoutLocation> AllLocations() { using var c = Conn(); return AllLocations(c); }

    private static List<LayoutLocation> AllLocations(SqlConnection c) =>
        c.Query<LayoutLocation>(@"SELECT l.LocID AS LocId, l.TypeID AS TypeId, t.TypeName, l.LocName, l.CreatedBy, l.CreatedAt
                                  FROM Nexus.LayoutLocations l JOIN Nexus.LayoutTypes t ON t.TypeID = l.TypeID
                                  ORDER BY t.SortNo, t.TypeName, l.SortNo, l.LocName").ToList();

    public LayoutType GetType(int typeId)
    {
        using var c = Conn();
        return c.QueryFirstOrDefault<LayoutType>("SELECT TypeID AS TypeId, TypeName, CreatedBy, CreatedAt FROM Nexus.LayoutTypes WHERE TypeID = @typeId", new { typeId });
    }

    public bool TypeExists(string name, int exceptId = 0)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>("SELECT COUNT(*) FROM Nexus.LayoutTypes WHERE TypeName = @name AND TypeID <> @exceptId", new { name, exceptId }) > 0;
    }

    public int AddType(string name, string uid)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>(@"INSERT INTO Nexus.LayoutTypes (TypeName, SortNo, CreatedBy)
                                      OUTPUT INSERTED.TypeID
                                      VALUES (@name, ISNULL((SELECT MAX(SortNo) FROM Nexus.LayoutTypes), 0) + 1, @uid)", new { name, uid });
    }

    public void RenameType(int typeId, string name)
    {
        using var c = Conn();
        c.Execute("UPDATE Nexus.LayoutTypes SET TypeName = @name WHERE TypeID = @typeId", new { typeId, name });
    }

    // ลบประเภท = ลบตำแหน่งในประเภทนั้นด้วย (CASCADE) · แถวสแกนเดิมยังเก็บข้อความตำแหน่งไว้เหมือนเดิม
    public int DeleteType(int typeId)
    {
        using var c = Conn();
        int n = c.ExecuteScalar<int>("SELECT COUNT(*) FROM Nexus.LayoutLocations WHERE TypeID = @typeId", new { typeId });
        c.Execute("DELETE FROM Nexus.LayoutTypes WHERE TypeID = @typeId", new { typeId });
        return n;
    }

    // เพิ่มหลายตำแหน่งทีเดียว (3A 3B 3C) · ชื่อที่มีอยู่แล้วข้ามไป · คืนชื่อที่เพิ่มจริง
    public List<string> AddLocations(int typeId, IEnumerable<string> names, string uid)
    {
        var added = new List<string>();
        using var c = Conn();
        c.Open();
        using var tx = c.BeginTransaction();
        var have = new HashSet<string>(c.Query<string>("SELECT LocName FROM Nexus.LayoutLocations WHERE TypeID = @typeId", new { typeId }, tx), StringComparer.OrdinalIgnoreCase);
        int sort = c.ExecuteScalar<int?>("SELECT MAX(SortNo) FROM Nexus.LayoutLocations WHERE TypeID = @typeId", new { typeId }, tx) ?? 0;
        foreach (var n in names)
        {
            if (!have.Add(n)) continue;
            c.Execute("INSERT INTO Nexus.LayoutLocations (TypeID, LocName, SortNo, CreatedBy) VALUES (@typeId, @n, @sort, @uid)", new { typeId, n, sort = ++sort, uid }, tx);
            added.Add(n);
        }
        tx.Commit();
        return added;
    }

    public LayoutLocation GetLocation(int locId) => AllLocations().FirstOrDefault(l => l.LocId == locId);

    public bool LocationExists(int typeId, string name, int exceptId)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>("SELECT COUNT(*) FROM Nexus.LayoutLocations WHERE TypeID = @typeId AND LocName = @name AND LocID <> @exceptId", new { typeId, name, exceptId }) > 0;
    }

    public void RenameLocation(int locId, string name)
    {
        using var c = Conn();
        c.Execute("UPDATE Nexus.LayoutLocations SET LocName = @name WHERE LocID = @locId", new { locId, name });
    }

    public int DeleteLocations(IEnumerable<int> ids)
    {
        var list = ids.Distinct().ToList();
        if (list.Count == 0) return 0;
        using var c = Conn();
        return c.Execute("DELETE FROM Nexus.LayoutLocations WHERE LocID IN @list", new { list });
    }
}
