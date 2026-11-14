using Microsoft.Data.SqlClient;
using Nexus.Helpers;
using Nexus.Models;

namespace CHR.Nexus.Api.Web;

// ⚡ เรียลไทม์ของหน้าตารางคลัง (StoreMaxMinView.AttachLiveStructure + LiveRefresh.DbToken): ค่าเดิม = ไม่มีอะไรเปลี่ยน
//   settings  = ตั้งค่าคลัง / รูปแบบบาร์โค้ดของคลังถูกแก้จากเครื่องอื่น -> เปิดหน้าใหม่ด้วยค่าล่าสุด (ไม่มีคลัง = กลับหน้าการ์ดคลัง)
//   structure = เพิ่ม / ลบสินค้า แก้ชื่อ รหัส กลุ่ม รูป BIN -> โหลดตารางใหม่ (คลังที่แสดงสดจาก StorePC ไม่ดู)
//   coils     = Coil เข้า / ออก / ย้าย -> แถว Coil ที่เปิดดูอยู่อัพเดทเอง
public static class StoreLive
{
    public static string Settings(int stkId) => Token(
        "SELECT COUNT(*), CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM Nexus.Stocks WHERE StockID = @stk",
        "SELECT COUNT(*), CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM Nexus.StockBarcodeFormats WHERE StockID = @stk", stkId);

    public static string Structure(StockModel s)
    {
        if (s.IsLiveView) return null;
        string partB = DbSchema.HasPartB ? ", PartB" : "";
        return Token(s.IsMain
            ? $@"SELECT COUNT(*), CHECKSUM_AGG(CHECKSUM(PartID, PartCode, Description, Category, Customer, Supplier, PartA, PartNumber, Model, Bin,
                                                     ImageFileName, IsShowInMaster, IsActive{partB})) FROM Nexus.Parts WHERE IsShowInMaster = 1"
            : $@"SELECT COUNT(*), CHECKSUM_AGG(CHECKSUM(ps.PartID, ps.IsShow, p.PartCode, p.Description, p.Category, p.Customer, p.Supplier, p.PartA,
                                                      p.PartNumber, p.Model, p.Bin, p.ImageFileName, p.IsActive{(DbSchema.HasPartB ? ", p.PartB" : "")}))
                 FROM Nexus.PartStocks ps JOIN Nexus.Parts p ON p.PartID = ps.PartID WHERE ps.StockID = @stk", null, s.StkId);
    }

    public static string Coils(StockModel s) =>
        s.ShowCoilRows && DbSchema.HasCoilRegister && !s.IsLiveView
            ? Token($"SELECT COUNT(*), CHECKSUM_AGG(CHECKSUM(CoilID, PartID, Status, WeightKG, MotherCoil{(DbSchema.HasCoilRemark ? ", Remark" : "")})) FROM Nexus.Coils WHERE StockID = @stk", null, s.StkId)
            : null;

    private static string Token(string sql1, string sql2, int stkId)
    {
        using var conn = new SqlConnection(global::Nexus.Core.GlobalConfig.ConnStr);
        conn.Open();
        string One(string sql)
        {
            using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 10 };   // ช้าเกิน 10 วิ = ข้ามรอบ
            cmd.Parameters.AddWithValue("@stk", stkId);
            using var r = cmd.ExecuteReader();
            return r.Read() ? $"{r.GetInt32(0)}:{(r.IsDBNull(1) ? 0 : r.GetInt32(1))}" : "";
        }
        return sql2 == null ? One(sql1) : One(sql1) + "|" + One(sql2);
    }
}
