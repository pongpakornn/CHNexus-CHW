using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.SqlClient;
using Nexus.Helpers;

namespace Nexus.Services;

// 🔐 รหัสผ่านแบบ Hash (PBKDF2-SHA256 · Salt สุ่ม 16 byte ต่อคน · 120,000 รอบ) เก็บที่ Nexus.Users.PasswordHash (22_User_Password_Hash.sql)
//   รูปแบบ: PBKDF2$120000$<salt base64>$<hash base64> · ตรวจแบบเวลาคงที่ (กันเดาจากเวลาตอบ)
//   ⚠ ช่วงเปลี่ยนผ่าน: โปรแกรม CIMS (Windows) ยังตรวจคอลัมน์ Password เดิม
//      - Password มีค่า  = ใช้ค่านั้นเป็นหลัก (CIMS เปลี่ยนรหัสแล้วเว็บตามได้) แล้วอัพเดท Hash ให้ตรงทุกครั้งที่ Login สำเร็จ
//      - Password ว่าง (NULL) = ใช้ Hash อย่างเดียว (หลัง CIMS เปลี่ยนมาใช้ Hash แล้ว ล้างคอลัมน์เดิมได้)
//   ตั้ง / เปลี่ยนรหัสผ่านจากเว็บ = เขียน Hash เสมอ (+ คอลัมน์เดิมเฉพาะช่วงที่ CIMS ยังใช้)
public static class PasswordStore
{
    private const int Iter = 120_000, SaltLen = 16, KeyLen = 32;

    public static string Hash(string password)
    {
        byte[] salt = RandomNumberGenerator.GetBytes(SaltLen);
        byte[] key = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password ?? ""), salt, Iter, HashAlgorithmName.SHA256, KeyLen);
        return $"PBKDF2${Iter}${Convert.ToBase64String(salt)}${Convert.ToBase64String(key)}";
    }

    public static bool Verify(string password, string stored)
    {
        try
        {
            var p = (stored ?? "").Split('$');
            if (p.Length != 4 || p[0] != "PBKDF2" || !int.TryParse(p[1], out int iter) || iter < 10_000) return false;
            byte[] salt = Convert.FromBase64String(p[2]), want = Convert.FromBase64String(p[3]);
            byte[] got = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password ?? ""), salt, iter, HashAlgorithmName.SHA256, want.Length);
            return CryptographicOperations.FixedTimeEquals(got, want);
        }
        catch { return false; }
    }

    private static bool SameText(string a, string b) =>
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a ?? ""), Encoding.UTF8.GetBytes(b ?? ""));

    /// <summary>รหัสผ่านถูก + บัญชีไม่ถูกล็อก (Login สำเร็จ = อัพเดท Hash ให้ตรงเสมอ)</summary>
    public static bool Check(SqlConnection conn, string userId, string password)
    {
        bool hasHash = DbSchema.HasPasswordHash;
        string plain = null, hash = null;
        using (var cmd = new SqlCommand($"SELECT Password, {(hasHash ? "PasswordHash" : "CAST(NULL AS NVARCHAR(200))")} FROM Nexus.Users WHERE UserID = @u AND ISNULL(IsLocked, 0) = 0", conn))
        {
            cmd.Parameters.AddWithValue("@u", userId ?? "");
            using var r = cmd.ExecuteReader();
            if (!r.Read()) return false;
            plain = r.IsDBNull(0) ? null : r.GetString(0);
            hash = r.IsDBNull(1) ? null : r.GetString(1);
        }
        bool ok = plain != null ? SameText(plain, password) : hash != null && Verify(password, hash);
        if (ok && hasHash && (hash == null || !Verify(password, hash))) Store(conn, userId, password, keepPlain: plain != null);
        return ok;
    }

    public static bool Check(string userId, string password)
    {
        using var c = new SqlConnection(Core.GlobalConfig.ConnStr);
        c.Open();
        return Check(c, userId, password);
    }

    /// <summary>ตั้งรหัสผ่านใหม่: Hash เสมอ · keepPlain = เขียนคอลัมน์เดิมด้วย (ให้ CIMS ยัง Login ได้)</summary>
    public static void Store(SqlConnection conn, string userId, string password, bool keepPlain = true)
    {
        string sql = DbSchema.HasPasswordHash
            ? (keepPlain ? "UPDATE Nexus.Users SET PasswordHash = @h, Password = @p WHERE UserID = @u" : "UPDATE Nexus.Users SET PasswordHash = @h WHERE UserID = @u")
            : "UPDATE Nexus.Users SET Password = @p WHERE UserID = @u";
        using var cmd = new SqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@u", userId);
        cmd.Parameters.AddWithValue("@p", password ?? "");
        if (DbSchema.HasPasswordHash) cmd.Parameters.AddWithValue("@h", Hash(password));
        cmd.ExecuteNonQuery();
    }

    /// <summary>เขียน Hash ตามรหัสผ่านที่เพิ่งตั้ง (เพิ่ม / แก้ผู้ใช้ · Import) - ใช้ Transaction เดียวกับคำสั่งเดิม</summary>
    public static void SetHash(SqlConnection conn, SqlTransaction tr, string userId, string password)
    {
        if (!DbSchema.HasPasswordHash || string.IsNullOrEmpty(password)) return;
        using var cmd = new SqlCommand("UPDATE Nexus.Users SET PasswordHash = @h WHERE UserID = @u", conn, tr);
        cmd.Parameters.AddWithValue("@u", userId);
        cmd.Parameters.AddWithValue("@h", Hash(password));
        cmd.ExecuteNonQuery();
    }

    public static void Store(string userId, string password)
    {
        using var c = new SqlConnection(Core.GlobalConfig.ConnStr);
        c.Open();
        Store(c, userId, password, KeepPlain(c, userId));
    }

    /// <summary>ผู้ใช้ที่ยังไม่มี Hash (บัญชีเดิม) -> สร้าง Hash จากรหัสผ่านเดิมให้ (ทำเบื้องหลังครั้งเดียวตอนเปิด Server)</summary>
    public static int Backfill()
    {
        if (!DbSchema.HasPasswordHash) return 0;
        using var c = new SqlConnection(Core.GlobalConfig.ConnStr);
        c.Open();
        var todo = new List<(string U, string P)>();
        using (var cmd = new SqlCommand("SELECT UserID, Password FROM Nexus.Users WHERE PasswordHash IS NULL AND Password IS NOT NULL AND Password <> ''", c))
        using (var r = cmd.ExecuteReader())
            while (r.Read()) todo.Add((r.GetString(0), r.GetString(1)));
        foreach (var (u, p) in todo)
        {
            using var up = new SqlCommand("UPDATE Nexus.Users SET PasswordHash = @h WHERE UserID = @u AND PasswordHash IS NULL", c);
            up.Parameters.AddWithValue("@u", u);
            up.Parameters.AddWithValue("@h", Hash(p));
            up.ExecuteNonQuery();
        }
        return todo.Count;
    }

    // คอลัมน์เดิมยังมีค่าอยู่ (CIMS ยังใช้) = เขียนต่อ · ถูกล้างแล้ว = Hash อย่างเดียว
    private static bool KeepPlain(SqlConnection c, string userId)
    {
        using var cmd = new SqlCommand("SELECT CASE WHEN Password IS NULL THEN 0 ELSE 1 END FROM Nexus.Users WHERE UserID = @u", c);
        cmd.Parameters.AddWithValue("@u", userId);
        return Convert.ToInt32(cmd.ExecuteScalar() ?? 1) == 1;
    }
}
