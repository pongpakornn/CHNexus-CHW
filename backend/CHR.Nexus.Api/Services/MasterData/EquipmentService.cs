using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;

namespace Nexus.Services;

// 🏭 MASTER DATA › Machine Information / Mold Information (Master.Machines / Master.Molds, script 71)
public sealed class MachineRow
{
    public int Id { get; set; }
    public string Code { get; set; }
    public string Name { get; set; }
    public string Type { get; set; }
    public string Zone { get; set; }
    public decimal? SetupMin { get; set; }
    public decimal? ChangeMoldMin { get; set; }
    public int? Speed { get; set; }
    public string Status { get; set; }
    public string CreatedBy { get; set; }
    public DateTime CreatedDate { get; set; }
    public string UpdatedBy { get; set; }
    public DateTime UpdatedDate { get; set; }
}

public sealed class MoldRow
{
    public int Id { get; set; }
    public string Code { get; set; }
    public string Name { get; set; }
    public string Owner { get; set; }
    public string Customer { get; set; }
    public string CustomerName { get; set; }
    public string Zone { get; set; }
    public int? PartsPerStroke { get; set; }
    public string Status { get; set; }
    public string CreatedBy { get; set; }
    public DateTime CreatedDate { get; set; }
    public string UpdatedBy { get; set; }
    public DateTime UpdatedDate { get; set; }
}

public sealed class EquipmentService
{
    private static SqlConnection Conn() => new(GlobalConfig.ConnStr);

    private const string MachineSql = @"SELECT MachineID AS Id, MachineCode AS Code, MachineName AS Name, MachineType AS Type, MachineZone AS Zone,
                                               SetupMin, ChangeMoldMin, SpeedSph AS Speed, Status, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate
                                        FROM Master.Machines ";
    private const string MoldSql = @"SELECT m.MoldID AS Id, m.MoldCode AS Code, m.MoldName AS Name, m.OwnerType AS Owner, m.CustomerCode AS Customer, c.CustomerName,
                                            m.MoldZone AS Zone, m.PartsPerStroke, m.Status, m.CreatedBy, m.CreatedDate, m.UpdatedBy, m.UpdatedDate
                                     FROM Master.Molds m LEFT JOIN Master.Customers c ON c.CustomerCode = m.CustomerCode ";

    public List<MachineRow> Machines() { using var c = Conn(); return c.Query<MachineRow>(MachineSql + "ORDER BY MachineType, MachineCode").ToList(); }
    public MachineRow Machine(int id) { using var c = Conn(); return c.QueryFirstOrDefault<MachineRow>(MachineSql + "WHERE MachineID = @id", new { id }); }
    public List<MoldRow> Molds() { using var c = Conn(); return c.Query<MoldRow>(MoldSql + "ORDER BY m.OwnerType DESC, m.CustomerCode, m.MoldCode").ToList(); }
    public MoldRow Mold(int id) { using var c = Conn(); return c.QueryFirstOrDefault<MoldRow>(MoldSql + "WHERE m.MoldID = @id", new { id }); }

    public bool MachineCodeExists(string code, int exceptId = 0)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>("SELECT COUNT(1) FROM Master.Machines WHERE MachineCode = @code AND MachineID <> @exceptId", new { code, exceptId }) > 0;
    }

    public bool MoldCodeExists(string code, int exceptId = 0)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>("SELECT COUNT(1) FROM Master.Molds WHERE MoldCode = @code AND MoldID <> @exceptId", new { code, exceptId }) > 0;
    }

    public bool CustomerExists(string code)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>("SELECT COUNT(1) FROM Master.Customers WHERE CustomerCode = @code", new { code }) > 0;
    }

    /// <summary>id = 0 -> insert (returns new id) · else update</summary>
    public int SaveMachine(int id, MachineRow r, string uid)
    {
        using var c = Conn();
        var p = new { id, r.Code, r.Name, r.Type, r.Zone, r.SetupMin, r.ChangeMoldMin, r.Speed, r.Status, uid };
        if (id == 0)
            return c.QuerySingle<int>(@"INSERT INTO Master.Machines (MachineCode, MachineName, MachineType, MachineZone, SetupMin, ChangeMoldMin, SpeedSph, Status, CreatedBy, UpdatedBy)
                                        OUTPUT INSERTED.MachineID VALUES (@Code, @Name, @Type, @Zone, @SetupMin, @ChangeMoldMin, @Speed, @Status, @uid, @uid)", p);
        c.Execute(@"UPDATE Master.Machines SET MachineCode = @Code, MachineName = @Name, MachineType = @Type, MachineZone = @Zone, SetupMin = @SetupMin,
                           ChangeMoldMin = @ChangeMoldMin, SpeedSph = @Speed, Status = @Status, UpdatedBy = @uid, UpdatedDate = GETDATE()
                    WHERE MachineID = @id", p);
        return id;
    }

    public int SaveMold(int id, MoldRow r, string uid)
    {
        using var c = Conn();
        var p = new { id, r.Code, r.Name, r.Owner, r.Customer, r.Zone, r.PartsPerStroke, r.Status, uid };
        if (id == 0)
            return c.QuerySingle<int>(@"INSERT INTO Master.Molds (MoldCode, MoldName, OwnerType, CustomerCode, MoldZone, PartsPerStroke, Status, CreatedBy, UpdatedBy)
                                        OUTPUT INSERTED.MoldID VALUES (@Code, @Name, @Owner, @Customer, @Zone, @PartsPerStroke, @Status, @uid, @uid)", p);
        c.Execute(@"UPDATE Master.Molds SET MoldCode = @Code, MoldName = @Name, OwnerType = @Owner, CustomerCode = @Customer, MoldZone = @Zone,
                           PartsPerStroke = @PartsPerStroke, Status = @Status, UpdatedBy = @uid, UpdatedDate = GETDATE()
                    WHERE MoldID = @id", p);
        return id;
    }

    public void DeleteMachine(int id) { using var c = Conn(); c.Execute("DELETE FROM Master.Machines WHERE MachineID = @id", new { id }); }
    public void DeleteMold(int id) { using var c = Conn(); c.Execute("DELETE FROM Master.Molds WHERE MoldID = @id", new { id }); }
}
