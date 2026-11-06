using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;

namespace Nexus.Services;

// 🗂 MASTER DATA › Customer Information / Supplier Information (Master.Customers / Master.Suppliers)
//   ตารางสองตัวโครงเดียวกัน -> Service เดียว เลือกตารางจาก PartnerKind (ชื่อตาราง / คอลัมน์มาจากโค้ดเท่านั้น ไม่รับจากผู้ใช้)
//   สินค้าที่ใช้รหัสนี้ = Nexus.Parts.Customer / Supplier (ข้อความเดิม · CIMS Windows ใช้ต่อ) -> ใช้อยู่ = ห้ามลบ / ห้ามเปลี่ยนรหัส
public sealed record PartnerKind(string Key, string Label, string Table, string Id, string Code, string Name, string PartsCol);

public sealed class PartnerRow
{
    public int Id { get; set; }
    public string Code { get; set; }
    public string Name { get; set; }
    public bool IsActive { get; set; }
    public string CreatedBy { get; set; }
    public DateTime CreatedDate { get; set; }
    public string UpdatedBy { get; set; }
    public DateTime UpdatedDate { get; set; }
    public int Parts { get; set; }          // จำนวนสินค้าที่ใช้รหัสนี้
}

public sealed class PartnerService
{
    public static readonly PartnerKind Customers = new("customers", "CUSTOMER", "Master.Customers", "CustomerID", "CustomerCode", "CustomerName", "Customer");
    public static readonly PartnerKind Suppliers = new("suppliers", "SUPPLIER", "Master.Suppliers", "SupplierID", "SupplierCode", "SupplierName", "Supplier");
    public static PartnerKind Of(string key) => key?.ToLowerInvariant() switch { "customers" => Customers, "suppliers" => Suppliers, _ => null };

    private readonly PartnerKind _k;
    public PartnerService(PartnerKind kind) => _k = kind;
    private static SqlConnection Conn() => new(GlobalConfig.ConnStr);

    private string Select => $@"SELECT t.{_k.Id} AS Id, t.{_k.Code} AS Code, t.{_k.Name} AS Name, t.IsActive, t.CreatedBy, t.CreatedDate, t.UpdatedBy, t.UpdatedDate,
                                       ISNULL(u.n, 0) AS Parts
                                FROM {_k.Table} t
                                LEFT JOIN (SELECT UPPER(LTRIM(RTRIM({_k.PartsCol}))) AS c, COUNT(*) AS n FROM Nexus.Parts
                                           WHERE NULLIF(LTRIM(RTRIM({_k.PartsCol})), '') IS NOT NULL GROUP BY UPPER(LTRIM(RTRIM({_k.PartsCol})))) u ON u.c = t.{_k.Code} ";

    public List<PartnerRow> List()
    {
        using var c = Conn();
        return c.Query<PartnerRow>(Select + $"ORDER BY t.{_k.Code}").ToList();
    }

    public PartnerRow Get(int id)
    {
        using var c = Conn();
        return c.QueryFirstOrDefault<PartnerRow>(Select + $"WHERE t.{_k.Id} = @id", new { id });
    }

    public bool CodeExists(string code, int exceptId = 0)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>($"SELECT COUNT(1) FROM {_k.Table} WHERE {_k.Code} = @code AND {_k.Id} <> @exceptId", new { code, exceptId }) > 0;
    }

    public int Add(string code, string name, string uid)
    {
        using var c = Conn();
        return c.QuerySingle<int>($@"INSERT INTO {_k.Table} ({_k.Code}, {_k.Name}, IsActive, CreatedBy, UpdatedBy)
                                    OUTPUT INSERTED.{_k.Id} VALUES (@code, @name, 1, @uid, @uid)", new { code, name, uid });
    }

    public void Update(int id, string code, string name, bool active, string uid)
    {
        using var c = Conn();
        c.Execute($@"UPDATE {_k.Table} SET {_k.Code} = @code, {_k.Name} = @name, IsActive = @active, UpdatedBy = @uid, UpdatedDate = GETDATE()
                     WHERE {_k.Id} = @id", new { id, code, name, active, uid });
    }

    public void Delete(int id)
    {
        using var c = Conn();
        c.Execute($"DELETE FROM {_k.Table} WHERE {_k.Id} = @id", new { id });
    }
}
