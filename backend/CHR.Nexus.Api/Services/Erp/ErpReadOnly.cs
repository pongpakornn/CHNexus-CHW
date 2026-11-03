using Microsoft.Data.SqlClient;
using System;
using System.Data;
using System.Text.RegularExpressions;

namespace Nexus.Services
{
    // 🔒 ERP (192.168.10.10) = อ่านอย่างเดียว: ยืมข้อมูลมาแสดง / ปริ้นเท่านั้น ห้ามเพิ่ม / แก้ / ลบ
    //    ชั้นที่ 1: คำสั่งต้องเป็น SELECT และไม่มีคำสั่งเขียนใดๆ (ไม่ผ่าน = ไม่ส่งไป ERP เลย)
    //    ชั้นที่ 2: รันใน Transaction ที่ Rollback ทุกครั้ง (ถ้ามีอะไรหลุดไปก็ไม่ถูกบันทึก)
    //    ชั้นที่ 3 (แนะนำ): Login ของ ERP มีสิทธิ์แค่ db_datareader
    public static class ErpReadOnly
    {
        private static readonly Regex Forbidden = new Regex(
            @"\b(INSERT|UPDATE|DELETE|MERGE|INTO|EXEC|EXECUTE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|DENY|BACKUP|RESTORE|DBCC|OPENROWSET|OPENQUERY|OPENDATASOURCE|xp_\w+|sp_\w+)\b",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        public static void Check(string sql)
        {
            string s = Regex.Replace(sql ?? "", @"--[^\n]*|/\*.*?\*/", " ", RegexOptions.Singleline).Trim();
            if (!s.StartsWith("SELECT", StringComparison.OrdinalIgnoreCase) && !s.StartsWith("WITH", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("ERP อ่านอย่างเดียว - ใช้ได้เฉพาะคำสั่ง SELECT");
            var m = Forbidden.Match(s);
            if (m.Success) throw new InvalidOperationException($"ERP อ่านอย่างเดียว - ห้ามใช้คำสั่ง {m.Value.ToUpperInvariant()}");
        }

        // ตรวจคำสั่ง + เปิด Transaction ที่จะ Rollback ตอน Dispose เสมอ
        public static IDisposable Begin(SqlConnection conn, SqlCommand cmd)
        {
            Check(cmd.CommandText);
            var tx = conn.BeginTransaction(IsolationLevel.ReadUncommitted);
            cmd.Transaction = tx;
            return new RollbackOnDispose(tx);
        }

        private sealed class RollbackOnDispose : IDisposable
        {
            private readonly SqlTransaction _tx;
            public RollbackOnDispose(SqlTransaction tx) => _tx = tx;
            public void Dispose()
            {
                try { if (_tx.Connection != null) _tx.Rollback(); } catch { /* connection ปิดแล้ว = ไม่มีอะไรค้าง */ }
                _tx.Dispose();
            }
        }
    }
}
