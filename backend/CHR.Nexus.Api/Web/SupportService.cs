using Microsoft.Data.SqlClient;
using Nexus.Core;

namespace CHR.Nexus.Api.Web;

// 💬 แชทแจ้ง Admin: เรื่อง (Nexus.SupportThreads) + ข้อความ (Nexus.SupportMessages) ในฐาน CHR-Nexus
public sealed class SupportService
{
    public static readonly string[] Topics = { "PROBLEM", "UPDATE", "PERMISSION" };

    public sealed record SupportThread(int ThreadId, string UserId, string UserName, string Topic, string Status, string LastSender,
        DateTime CreatedAt, DateTime UpdatedAt, DateTime? UserReadAt, DateTime? AdminReadAt, string LastBody);

    public sealed record Message(int MessageId, string SenderUserId, string SenderName, bool IsAdmin, string Body, DateTime CreatedAt, DateTime? EditedAt, bool Deleted,
        ChatService.Attach Attach, List<ChatService.Reaction> Reactions);
    public sealed record StoredFile(int ThreadId, string Path, string Name, string Kind);

    private static SqlConnection Open()
    {
        var c = new SqlConnection(GlobalConfig.ConnStr);
        c.Open();
        return c;
    }

    private static readonly string PreviewM = string.Format(ChatFiles.PreviewSql, "m");

    private static readonly string ThreadSelect = @"
        SELECT t.ThreadID, t.UserID, ISNULL(u.FullName, t.UserID) AS UserName, t.Topic, t.Status, t.LastSender,
               t.CreatedAt, t.UpdatedAt, t.UserReadAt, t.AdminReadAt,
               (SELECT TOP 1 " + PreviewM + @" FROM Nexus.SupportMessages m WHERE m.ThreadID = t.ThreadID ORDER BY m.MessageID DESC) AS LastBody
        FROM Nexus.SupportThreads t
        LEFT JOIN Nexus.Users u ON u.UserID = t.UserID";

    private static SupportThread ReadThread(SqlDataReader r) => new(
        r.GetInt32(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetString(4), r.GetString(5),
        r.GetDateTime(6), r.GetDateTime(7), r.IsDBNull(8) ? null : r.GetDateTime(8), r.IsDBNull(9) ? null : r.GetDateTime(9),
        r.IsDBNull(10) ? "" : r.GetString(10));

    /// <summary>Admin = ทุกเรื่อง · ผู้ใช้ทั่วไป = เฉพาะเรื่องของตัวเอง (ล่าสุดอยู่บน)</summary>
    public List<SupportThread> Threads(string userId, bool admin)
    {
        using var c = Open();
        using var cmd = new SqlCommand(ThreadSelect + (admin ? "" : " WHERE t.UserID = @u") + " ORDER BY t.UpdatedAt DESC, t.ThreadID DESC", c);
        cmd.Parameters.AddWithValue("@u", userId);
        using var r = cmd.ExecuteReader();
        var list = new List<SupportThread>();
        while (r.Read()) list.Add(ReadThread(r));
        return list;
    }

    public SupportThread GetThread(int id)
    {
        using var c = Open();
        using var cmd = new SqlCommand(ThreadSelect + " WHERE t.ThreadID = @id", c);
        cmd.Parameters.AddWithValue("@id", id);
        using var r = cmd.ExecuteReader();
        return r.Read() ? ReadThread(r) : null;
    }

    public List<Message> Messages(int threadId)
    {
        using var c = Open();
        using var cmd = new SqlCommand(@"
            SELECT m.MessageID, m.SenderUserID, ISNULL(u.FullName, m.SenderUserID), m.IsAdmin,
                   CASE WHEN m.DeletedAt IS NULL THEN m.Body ELSE N'' END, m.CreatedAt, m.EditedAt, CASE WHEN m.DeletedAt IS NULL THEN 0 ELSE 1 END,
                   m.AttachName, m.AttachSize, m.AttachKind
            FROM Nexus.SupportMessages m LEFT JOIN Nexus.Users u ON u.UserID = m.SenderUserID
            WHERE m.ThreadID = @id ORDER BY m.MessageID", c);
        cmd.Parameters.AddWithValue("@id", threadId);
        var list = new List<Message>();
        using (var r = cmd.ExecuteReader())
            while (r.Read())
            {
                bool deleted = r.GetInt32(7) == 1;
                var at = deleted || r.IsDBNull(8) ? null : new ChatService.Attach(r.GetString(8), r.IsDBNull(9) ? 0 : r.GetInt64(9), r.IsDBNull(10) ? "FILE" : r.GetString(10));
                list.Add(new Message(r.GetInt32(0), r.GetString(1), r.GetString(2), r.GetBoolean(3), r.GetString(4), r.GetDateTime(5),
                    r.IsDBNull(6) ? null : r.GetDateTime(6), deleted, at, new List<ChatService.Reaction>()));
            }
        var reacts = ChatService.LoadReactions(c, "SUPPORT", list.Select(m => m.MessageId));
        foreach (var m in list) if (reacts.TryGetValue(m.MessageId, out var rs)) m.Reactions.AddRange(rs);
        return list;
    }

    /// <summary>ไฟล์แนบของข้อความ + เรื่องที่อยู่ (ใช้ตรวจสิทธิ์ก่อนเปิด / ดาวน์โหลด)</summary>
    public StoredFile GetFile(int messageId)
    {
        using var c = Open();
        using var cmd = new SqlCommand("SELECT ThreadID, AttachPath, AttachName, AttachKind FROM Nexus.SupportMessages WHERE MessageID = @id AND DeletedAt IS NULL AND AttachPath IS NOT NULL", c);
        cmd.Parameters.AddWithValue("@id", messageId);
        using var r = cmd.ExecuteReader();
        return r.Read() ? new StoredFile(r.GetInt32(0), r.GetString(1), r.GetString(2), r.IsDBNull(3) ? "FILE" : r.GetString(3)) : null;
    }

    /// <summary>เรื่องของข้อความ (สำหรับตรวจสิทธิ์กดอีโมจิ) - null = ไม่พบ / ถูกลบ</summary>
    public int? ThreadOf(int messageId)
    {
        using var c = Open();
        using var cmd = new SqlCommand("SELECT ThreadID FROM Nexus.SupportMessages WHERE MessageID = @id AND DeletedAt IS NULL", c);
        cmd.Parameters.AddWithValue("@id", messageId);
        var v = cmd.ExecuteScalar();
        return v == null ? null : (int)v;
    }

    /// <summary>แก้ไขข้อความ (เฉพาะผู้ส่งเอง)</summary>
    public bool EditMessage(int messageId, string userId, string body)
    {
        using var c = Open();
        using var cmd = new SqlCommand("UPDATE Nexus.SupportMessages SET Body = @b, EditedAt = SYSDATETIME() WHERE MessageID = @id AND SenderUserID = @u AND DeletedAt IS NULL", c);
        cmd.Parameters.AddWithValue("@b", body);
        cmd.Parameters.AddWithValue("@id", messageId);
        cmd.Parameters.AddWithValue("@u", userId);
        return cmd.ExecuteNonQuery() > 0;
    }

    /// <summary>ลบข้อความ (เฉพาะผู้ส่งเอง) = แสดงเป็น "ข้อความถูกลบ"</summary>
    public bool DeleteMessage(int messageId, string userId)
    {
        using var c = Open();
        using var cmd = new SqlCommand("UPDATE Nexus.SupportMessages SET Body = N'', DeletedAt = SYSDATETIME() WHERE MessageID = @id AND SenderUserID = @u AND DeletedAt IS NULL", c);
        cmd.Parameters.AddWithValue("@id", messageId);
        cmd.Parameters.AddWithValue("@u", userId);
        return cmd.ExecuteNonQuery() > 0;
    }

    /// <summary>ลบทั้งเรื่อง (ข้อความในเรื่องถูกลบตามด้วย ON DELETE CASCADE)</summary>
    public void DeleteThread(int threadId)
    {
        using var c = Open();
        using var cmd = new SqlCommand("DELETE FROM Nexus.SupportThreads WHERE ThreadID = @id", c);
        cmd.Parameters.AddWithValue("@id", threadId);
        cmd.ExecuteNonQuery();
    }

    /// <summary>เรื่องใหม่ + ข้อความแรก (Transaction เดียว)</summary>
    public int Create(string userId, string topic, string body)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        int id;
        using (var cmd = new SqlCommand(@"
            INSERT INTO Nexus.SupportThreads (UserID, Topic, LastSender, UserReadAt) VALUES (@u, @t, N'USER', SYSDATETIME());
            SELECT CAST(SCOPE_IDENTITY() AS INT);", c, tx))
        {
            cmd.Parameters.AddWithValue("@u", userId);
            cmd.Parameters.AddWithValue("@t", topic);
            id = (int)cmd.ExecuteScalar();
        }
        InsertMessage(c, tx, id, userId, false, body);
        tx.Commit();
        return id;
    }

    /// <summary>ตอบในเรื่องเดิม: อัปเดตผู้ส่งล่าสุด + เปิดเรื่องอีกครั้งถ้าเคยปิด</summary>
    public void Reply(int threadId, string userId, bool asAdmin, string body, ChatFiles.Saved file = null)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        InsertMessage(c, tx, threadId, userId, asAdmin, body, file);
        using (var cmd = new SqlCommand(@"
            UPDATE Nexus.SupportThreads
            SET LastSender = @who, UpdatedAt = SYSDATETIME(), Status = N'OPEN', ClosedBy = NULL, ClosedAt = NULL,
                UserReadAt = CASE WHEN @admin = 0 THEN SYSDATETIME() ELSE UserReadAt END,
                AdminReadAt = CASE WHEN @admin = 1 THEN SYSDATETIME() ELSE AdminReadAt END
            WHERE ThreadID = @id", c, tx))
        {
            cmd.Parameters.AddWithValue("@who", asAdmin ? "ADMIN" : "USER");
            cmd.Parameters.AddWithValue("@admin", asAdmin);
            cmd.Parameters.AddWithValue("@id", threadId);
            cmd.ExecuteNonQuery();
        }
        tx.Commit();
    }

    private static void InsertMessage(SqlConnection c, SqlTransaction tx, int threadId, string userId, bool admin, string body, ChatFiles.Saved file = null)
    {
        using var cmd = new SqlCommand(@"INSERT INTO Nexus.SupportMessages (ThreadID, SenderUserID, IsAdmin, Body, AttachName, AttachPath, AttachSize, AttachKind)
            VALUES (@id, @u, @a, @b, @an, @ap, @as, @ak)", c, tx);
        cmd.Parameters.AddWithValue("@an", (object)file?.Name ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ap", (object)file?.Path ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@as", (object)file?.Size ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ak", (object)file?.Kind ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@id", threadId);
        cmd.Parameters.AddWithValue("@u", userId);
        cmd.Parameters.AddWithValue("@a", admin);
        cmd.Parameters.AddWithValue("@b", body);
        cmd.ExecuteNonQuery();
    }

    /// <summary>เปิดอ่านแล้ว: บันทึกเวลาอ่านของฝั่งที่เปิด</summary>
    public void MarkRead(int threadId, bool asAdmin)
    {
        using var c = Open();
        using var cmd = new SqlCommand(asAdmin
            ? "UPDATE Nexus.SupportThreads SET AdminReadAt = SYSDATETIME() WHERE ThreadID = @id"
            : "UPDATE Nexus.SupportThreads SET UserReadAt = SYSDATETIME() WHERE ThreadID = @id", c);
        cmd.Parameters.AddWithValue("@id", threadId);
        cmd.ExecuteNonQuery();
    }

    public void SetStatus(int threadId, bool close, string by)
    {
        using var c = Open();
        using var cmd = new SqlCommand(close
            ? "UPDATE Nexus.SupportThreads SET Status = N'CLOSED', ClosedBy = @by, ClosedAt = SYSDATETIME() WHERE ThreadID = @id"
            : "UPDATE Nexus.SupportThreads SET Status = N'OPEN', ClosedBy = NULL, ClosedAt = NULL WHERE ThreadID = @id", c);
        cmd.Parameters.AddWithValue("@id", threadId);
        cmd.Parameters.AddWithValue("@by", by);
        cmd.ExecuteNonQuery();
    }

    /// <summary>ยังไม่อ่าน: Admin = ผู้ใช้ส่งมาแล้ว Admin ยังไม่เปิด · ผู้ใช้ = Admin ตอบแล้วผู้ใช้ยังไม่เปิด</summary>
    public static bool Unread(SupportThread t, bool asAdmin) =>
        asAdmin
            ? t.LastSender == "USER" && (t.AdminReadAt == null || t.AdminReadAt < t.UpdatedAt)
            : t.LastSender == "ADMIN" && (t.UserReadAt == null || t.UserReadAt < t.UpdatedAt);
}
