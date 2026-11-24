using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;
using Nexus.Helpers;

namespace Nexus.Services;

// 🏭 MASTER DATA › ZONE & WORKSTATION INFORMATION (script 74)
//   Production Zone -> Workstations (positions in the zone, optional machine, operators) · Line-side Store = end point of the zone
public sealed class ZoneRow
{
    public int Id { get; set; }
    public string Code { get; set; }
    public string Name { get; set; }
    public int? StoreId { get; set; }
    public string StoreCode { get; set; }
    public string StoreName { get; set; }
    public string Status { get; set; }
    public int Stations { get; set; }
    public int Operators { get; set; }
    public string CreatedBy { get; set; }
    public DateTime CreatedDate { get; set; }
    public string UpdatedBy { get; set; }
    public DateTime UpdatedDate { get; set; }
}

public sealed class StationRow
{
    public int Id { get; set; }
    public int ZoneId { get; set; }
    public string Zone { get; set; }
    public string Code { get; set; }
    public string Name { get; set; }
    public string Machine { get; set; }
    public string MachineName { get; set; }
    public int Operators { get; set; }
    public string Status { get; set; }
    public string CreatedBy { get; set; }
    public DateTime CreatedDate { get; set; }
    public string UpdatedBy { get; set; }
    public DateTime UpdatedDate { get; set; }
}

public sealed class StoreRow
{
    public int Id { get; set; }
    public string Code { get; set; }
    public string Name { get; set; }
    public string Status { get; set; }
    public int Zones { get; set; }
    public string CreatedBy { get; set; }
    public DateTime CreatedDate { get; set; }
    public string UpdatedBy { get; set; }
    public DateTime UpdatedDate { get; set; }
}

public sealed class ZoneService
{
    private static SqlConnection Conn() => new(GlobalConfig.ConnStr);

    private const string ZoneSql = @"SELECT z.ZoneID AS Id, z.ZoneCode AS Code, z.ZoneName AS Name, z.StoreID AS StoreId, s.StoreCode, s.StoreName, z.Status,
                                            (SELECT COUNT(1) FROM Master.Workstations w WHERE w.ZoneID = z.ZoneID) AS Stations,
                                            ISNULL((SELECT SUM(w.Operators) FROM Master.Workstations w WHERE w.ZoneID = z.ZoneID AND w.Status = 'ACTIVE'), 0) AS Operators,
                                            z.CreatedBy, z.CreatedDate, z.UpdatedBy, z.UpdatedDate
                                     FROM Master.ProductionZones z LEFT JOIN Master.LineSideStores s ON s.StoreID = z.StoreID ";
    private static string StationSql => @"SELECT w.StationID AS Id, w.ZoneID AS ZoneId, z.ZoneCode AS Zone, w.StationCode AS Code, w.StationName AS Name, w.MachineCode AS Machine, "
                                        + (DbSchema.HasEquipment ? "(SELECT TOP 1 m.MachineName FROM Master.Machines m WHERE m.MachineCode = w.MachineCode)" : "CAST(NULL AS NVARCHAR(200))") + @" AS MachineName,
                                            w.Operators, w.Status, w.CreatedBy, w.CreatedDate, w.UpdatedBy, w.UpdatedDate
                                     FROM Master.Workstations w JOIN Master.ProductionZones z ON z.ZoneID = w.ZoneID ";
    private const string StoreSql = @"SELECT s.StoreID AS Id, s.StoreCode AS Code, s.StoreName AS Name, s.Status,
                                             (SELECT COUNT(1) FROM Master.ProductionZones z WHERE z.StoreID = s.StoreID) AS Zones,
                                             s.CreatedBy, s.CreatedDate, s.UpdatedBy, s.UpdatedDate
                                      FROM Master.LineSideStores s ";

    public List<ZoneRow> Zones() { using var c = Conn(); return c.Query<ZoneRow>(ZoneSql + "ORDER BY z.ZoneCode").ToList(); }
    public ZoneRow Zone(int id) { using var c = Conn(); return c.QueryFirstOrDefault<ZoneRow>(ZoneSql + "WHERE z.ZoneID = @id", new { id }); }
    public List<StationRow> Stations() { using var c = Conn(); return c.Query<StationRow>(StationSql + "ORDER BY z.ZoneCode, w.StationCode").ToList(); }
    public StationRow Station(int id) { using var c = Conn(); return c.QueryFirstOrDefault<StationRow>(StationSql + "WHERE w.StationID = @id", new { id }); }
    public List<StoreRow> Stores() { using var c = Conn(); return c.Query<StoreRow>(StoreSql + "ORDER BY s.StoreCode").ToList(); }
    public StoreRow Store(int id) { using var c = Conn(); return c.QueryFirstOrDefault<StoreRow>(StoreSql + "WHERE s.StoreID = @id", new { id }); }

    public bool Exists(string table, string col, string code, string idCol, int exceptId)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>($"SELECT COUNT(1) FROM Master.{table} WHERE {col} = @code AND {idCol} <> @exceptId", new { code, exceptId }) > 0;
    }

    /// <summary>zone code is in Zone & Workstation Information (any status)</summary>
    public static bool ZoneExists(string code)
    {
        if (string.IsNullOrEmpty(code) || !DbSchema.HasZones) return true;
        using var c = Conn();
        return c.ExecuteScalar<int>("SELECT COUNT(1) FROM Master.ProductionZones WHERE ZoneCode = @code", new { code }) > 0;
    }

    public bool MachineExists(string code)
    {
        if (!DbSchema.HasEquipment) return true;
        using var c = Conn();
        return c.ExecuteScalar<int>("SELECT COUNT(1) FROM Master.Machines WHERE MachineCode = @code", new { code }) > 0;
    }

    public void SaveZone(int id, ZoneRow r, string uid)
    {
        using var c = Conn();
        var p = new { id, r.Code, r.Name, r.StoreId, r.Status, uid };
        if (id == 0)
            c.Execute(@"INSERT INTO Master.ProductionZones (ZoneCode, ZoneName, StoreID, Status, CreatedBy, UpdatedBy) VALUES (@Code, @Name, @StoreId, @Status, @uid, @uid)", p);
        else
            c.Execute(@"UPDATE Master.ProductionZones SET ZoneName = @Name, StoreID = @StoreId, Status = @Status, UpdatedBy = @uid, UpdatedDate = GETDATE() WHERE ZoneID = @id", p);
    }

    public void SaveStation(int id, StationRow r, string uid)
    {
        using var c = Conn();
        var p = new { id, r.ZoneId, r.Code, r.Name, r.Machine, r.Operators, r.Status, uid };
        if (id == 0)
            c.Execute(@"INSERT INTO Master.Workstations (ZoneID, StationCode, StationName, MachineCode, Operators, Status, CreatedBy, UpdatedBy)
                        VALUES (@ZoneId, @Code, @Name, @Machine, @Operators, @Status, @uid, @uid)", p);
        else
            c.Execute(@"UPDATE Master.Workstations SET ZoneID = @ZoneId, StationName = @Name, MachineCode = @Machine, Operators = @Operators, Status = @Status,
                               UpdatedBy = @uid, UpdatedDate = GETDATE() WHERE StationID = @id", p);
    }

    public void SaveStore(int id, StoreRow r, string uid)
    {
        using var c = Conn();
        var p = new { id, r.Code, r.Name, r.Status, uid };
        if (id == 0)
            c.Execute("INSERT INTO Master.LineSideStores (StoreCode, StoreName, Status, CreatedBy, UpdatedBy) VALUES (@Code, @Name, @Status, @uid, @uid)", p);
        else
            c.Execute("UPDATE Master.LineSideStores SET StoreName = @Name, Status = @Status, UpdatedBy = @uid, UpdatedDate = GETDATE() WHERE StoreID = @id", p);
    }

    public void Delete(string table, string idCol, int id)
    {
        using var c = Conn();
        c.Execute($"DELETE FROM Master.{table} WHERE {idCol} = @id", new { id });
    }

    /// <summary>zones + active workstations + line-side store, for Set Flow and its preview</summary>
    public (List<dynamic> Zones, List<object> Stations) FlowOptions()
    {
        using var c = Conn();
        var zones = c.Query(@"SELECT z.ZoneCode AS code, z.ZoneName AS name, z.Status AS status, s.StoreCode AS store, s.StoreName AS storeName
                              FROM Master.ProductionZones z LEFT JOIN Master.LineSideStores s ON s.StoreID = z.StoreID AND s.Status = 'ACTIVE'
                              ORDER BY z.ZoneCode").ToList();
        var stations = c.Query<StationRow>(StationSql + "WHERE w.Status = 'ACTIVE' ORDER BY z.ZoneCode, w.StationCode")
                        .Select(w => (object)new { zone = w.Zone, code = w.Code, name = w.Name, machine = w.Machine, machineName = w.MachineName, operators = w.Operators }).ToList();
        return (zones, stations);
    }
}
