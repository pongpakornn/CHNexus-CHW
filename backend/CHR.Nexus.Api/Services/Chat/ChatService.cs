using Microsoft.Data.SqlClient;
using Nexus.Core;

namespace CHR.Nexus.Api.Web;

// 💬 แชทระหว่างผู้ใช้ (Nexus.ChatMessages) - ทุกคำสั่งกรองด้วย UserID ของผู้ใช้เอง = เห็นเฉพาะแชทของตัวเอง
public sealed class ChatService
{
    public sealed record ChatUser(string UserId, string Name, string Department, bool Online);
    public sealed record Conversation(string UserId, string Name, string Department, bool Online, string Last, bool LastMine, DateTime At, int Unread);
    public sealed record Attach(string Name, long Size, string Kind);
    public sealed record Reaction(string Emoji, string UserId, string Name);
    public sealed record ChatMsg(int MessageId, string From, string To, string Body, DateTime CreatedAt, DateTime? ReadAt, DateTime? EditedAt, bool Deleted, Attach Attach, List<Reaction> Reactions);
    public sealed record FeedItem(string Kind, int Id, string From, string FromName, string Body, int? ThreadId, string Topic);
    public sealed record StoredFile(string Path, string Name, string Kind);

    // ข้อความที่ฉันยังเห็น (ลบแชททั้งหมด = ซ่อนเฉพาะฝั่งของคนที่กดลบ)
    private const string Visible = "((FromUserID = @me AND HiddenForFrom = 0) OR (ToUserID = @me AND HiddenForTo = 0))";
    private static readonly string Preview = string.Format(ChatFiles.PreviewSql, "m");

    // อีโมจิที่กดตอบได้ (แบบ IG)
    public static readonly string[] Emojis = { "❤️", "😂", "😮", "😢", "😡", "👍" };

    private static SqlConnection Open()
    {
        var c = new SqlConnection(GlobalConfig.ConnStr);
        c.Open();
        return c;
    }

    /// <summary>รายชื่อผู้ใช้ที่แชทด้วยได้ (ไม่รวมตัวเอง และบัญชีที่ถูกล็อก)</summary>
    public List<ChatUser> Users(string me)
    {
        using var c = Open();
        using var cmd = new SqlCommand(@"
            SELECT UserID, ISNULL(NULLIF(FullName, ''), UserID), ISNULL(Department, ''), ISNULL(IsOnline, 0)
            FROM Nexus.Users WHERE UserID <> @me AND ISNULL(IsLocked, 0) = 0
            ORDER BY ISNULL(NULLIF(FullName, ''), UserID)", c);
        cmd.Parameters.AddWithValue("@me", me);
        using var r = cmd.ExecuteReader();
        var list = new List<ChatUser>();
        while (r.Read()) list.Add(new ChatUser(r.GetString(0), r.GetString(1), r.GetString(2), r.GetBoolean(3)));
        return list;
    }

    /// <summary>ห้องแชทของฉัน: คู่สนทนาแต่ละคน + ข้อความล่าสุด + จำนวนที่ยังไม่อ่าน</summary>
    public List<Conversation> Conversations(string me)
    {
        using var c = Open();
        using var cmd = new SqlCommand(@"
            WITH mine AS (
                SELECT m.MessageID, " + Preview + @" AS Body, m.CreatedAt, m.FromUserID,
                       CASE WHEN m.FromUserID = @me THEN m.ToUserID ELSE m.FromUserID END AS Partner,
                       CASE WHEN m.ToUserID = @me AND m.ReadAt IS NULL AND m.DeletedAt IS NULL THEN 1 ELSE 0 END AS IsUnread
                FROM Nexus.ChatMessages m WHERE " + Visible.Replace("FromUserID", "m.FromUserID").Replace("ToUserID", "m.ToUserID").Replace("Hidden", "m.Hidden") + @"
            ), ranked AS (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY Partner ORDER BY MessageID DESC) AS rn,
                       SUM(IsUnread) OVER (PARTITION BY Partner) AS UnreadCount
                FROM mine
            )
            SELECT r.Partner, ISNULL(NULLIF(u.FullName, ''), r.Partner), ISNULL(u.Department, ''), ISNULL(u.IsOnline, 0),
                   r.Body, CASE WHEN r.FromUserID = @me THEN 1 ELSE 0 END, r.CreatedAt, r.UnreadCount
            FROM ranked r LEFT JOIN Nexus.Users u ON u.UserID = r.Partner
            WHERE r.rn = 1 ORDER BY r.MessageID DESC", c);
        cmd.Parameters.AddWithValue("@me", me);
        using var r = cmd.ExecuteReader();
        var list = new List<Conversation>();
        while (r.Read())
            list.Add(new Conversation(r.GetString(0), r.GetString(1), r.GetString(2), r.GetBoolean(3), r.GetString(4), r.GetInt32(5) == 1, r.GetDateTime(6), r.GetInt32(7)));
        return list;
    }

    /// <summary>ข้อความระหว่างฉันกับอีกคน (ล่าสุด 300 ข้อความ) + ไฟล์แนบ + อีโมจิ + ทำเครื่องหมายว่าอ่านแล้ว</summary>
    public List<ChatMsg> With(string me, string other)
    {
        using var c = Open();
        using (var mark = new SqlCommand("UPDATE Nexus.ChatMessages SET ReadAt = SYSDATETIME() WHERE ToUserID = @me AND FromUserID = @o AND ReadAt IS NULL", c))
        {
            mark.Parameters.AddWithValue("@me", me);
            mark.Parameters.AddWithValue("@o", other);
            mark.ExecuteNonQuery();
        }
        var list = new List<ChatMsg>();
        using (var cmd = new SqlCommand(@"
            SELECT * FROM (
                SELECT TOP 300 MessageID, FromUserID, ToUserID, CASE WHEN DeletedAt IS NULL THEN Body ELSE N'' END AS Body, CreatedAt, ReadAt, EditedAt,
                       CASE WHEN DeletedAt IS NULL THEN 0 ELSE 1 END AS IsDeleted, AttachName, AttachSize, AttachKind
                FROM Nexus.ChatMessages
                WHERE ((FromUserID = @me AND ToUserID = @o) OR (FromUserID = @o AND ToUserID = @me)) AND " + Visible + @"
                ORDER BY MessageID DESC) x
            ORDER BY MessageID", c))
        {
            cmd.Parameters.AddWithValue("@me", me);
            cmd.Parameters.AddWithValue("@o", other);
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                bool deleted = r.GetInt32(7) == 1;
                var at = deleted || r.IsDBNull(8) ? null : new Attach(r.GetString(8), r.IsDBNull(9) ? 0 : r.GetInt64(9), r.IsDBNull(10) ? "FILE" : r.GetString(10));
                list.Add(new ChatMsg(r.GetInt32(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetDateTime(4),
                    r.IsDBNull(5) ? null : r.GetDateTime(5), r.IsDBNull(6) ? null : r.GetDateTime(6), deleted, at, new List<Reaction>()));
            }
        }
        var reacts = LoadReactions(c, "DM", list.Select(m => m.MessageId));
        foreach (var m in list) if (reacts.TryGetValue(m.MessageId, out var rs)) m.Reactions.AddRange(rs);
        return list;
    }

    /// <summary>อีโมจิของหลายข้อความ (ใช้ร่วมกับแชทแจ้ง Admin)</summary>
    public static Dictionary<int, List<Reaction>> LoadReactions(SqlConnection c, string kind, IEnumerable<int> ids)
    {
        var map = new Dictionary<int, List<Reaction>>();
        var idList = ids.ToList();
        if (idList.Count == 0) return map;
        using var cmd = new SqlCommand($@"
            SELECT r.MessageID, r.Emoji, r.UserID, ISNULL(NULLIF(u.FullName, ''), r.UserID)
            FROM Nexus.ChatReactions r LEFT JOIN Nexus.Users u ON u.UserID = r.UserID
            WHERE r.Kind = @k AND r.MessageID IN ({string.Join(",", idList)}) ORDER BY r.CreatedAt", c);
        cmd.Parameters.AddWithValue("@k", kind);
        using var rd = cmd.ExecuteReader();
        while (rd.Read())
        {
            int id = rd.GetInt32(0);
            if (!map.TryGetValue(id, out var l)) map[id] = l = new List<Reaction>();
            l.Add(new Reaction(rd.GetString(1), rd.GetString(2), rd.GetString(3)));
        }
        return map;
    }

    /// <summary>กดอีโมจิ (กดอันเดิมซ้ำ = ยกเลิก · กดอันใหม่ = เปลี่ยน)</summary>
    public static void SetReaction(string kind, int messageId, string userId, string emoji)
    {
        using var c = Open();
        using var cmd = new SqlCommand(@"
            IF EXISTS (SELECT 1 FROM Nexus.ChatReactions WHERE Kind = @k AND MessageID = @id AND UserID = @u AND Emoji = @e)
                DELETE FROM Nexus.ChatReactions WHERE Kind = @k AND MessageID = @id AND UserID = @u;
            ELSE IF EXISTS (SELECT 1 FROM Nexus.ChatReactions WHERE Kind = @k AND MessageID = @id AND UserID = @u)
                UPDATE Nexus.ChatReactions SET Emoji = @e, CreatedAt = SYSDATETIME() WHERE Kind = @k AND MessageID = @id AND UserID = @u;
            ELSE
                INSERT INTO Nexus.ChatReactions (Kind, MessageID, UserID, Emoji) VALUES (@k, @id, @u, @e);", c);
        cmd.Parameters.AddWithValue("@k", kind);
        cmd.Parameters.AddWithValue("@id", messageId);
        cmd.Parameters.AddWithValue("@u", userId);
        cmd.Parameters.AddWithValue("@e", emoji);
        cmd.ExecuteNonQuery();
    }

    /// <summary>ข้อความนี้ฉันเห็นได้ไหม (เป็นผู้ส่งหรือผู้รับ และยังไม่ถูกลบ)</summary>
    public bool CanSee(string me, int messageId)
    {
        using var c = Open();
        using var cmd = new SqlCommand("SELECT COUNT(1) FROM Nexus.ChatMessages WHERE MessageID = @id AND DeletedAt IS NULL AND " + Visible, c);
        cmd.Parameters.AddWithValue("@id", messageId);
        cmd.Parameters.AddWithValue("@me", me);
        return (int)cmd.ExecuteScalar() > 0;
    }

    /// <summary>ไฟล์แนบของข้อความ (เฉพาะผู้ส่ง / ผู้รับ)</summary>
    public StoredFile GetFile(string me, int messageId)
    {
        using var c = Open();
        using var cmd = new SqlCommand("SELECT AttachPath, AttachName, AttachKind FROM Nexus.ChatMessages WHERE MessageID = @id AND DeletedAt IS NULL AND AttachPath IS NOT NULL AND " + Visible, c);
        cmd.Parameters.AddWithValue("@id", messageId);
        cmd.Parameters.AddWithValue("@me", me);
        using var r = cmd.ExecuteReader();
        return r.Read() ? new StoredFile(r.GetString(0), r.GetString(1), r.IsDBNull(2) ? "FILE" : r.GetString(2)) : null;
    }

    /// <summary>แก้ไขข้อความ (เฉพาะที่ฉันส่งและยังไม่ถูกลบ)</summary>
    public bool Edit(string me, int messageId, string body)
    {
        using var c = Open();
        using var cmd = new SqlCommand("UPDATE Nexus.ChatMessages SET Body = @b, EditedAt = SYSDATETIME() WHERE MessageID = @id AND FromUserID = @me AND DeletedAt IS NULL", c);
        cmd.Parameters.AddWithValue("@b", body);
        cmd.Parameters.AddWithValue("@id", messageId);
        cmd.Parameters.AddWithValue("@me", me);
        return cmd.ExecuteNonQuery() > 0;
    }

    /// <summary>ลบข้อความ (เฉพาะที่ฉันส่ง) = ทั้งสองฝั่งเห็นเป็น "ข้อความถูกลบ"</summary>
    public bool Delete(string me, int messageId)
    {
        using var c = Open();
        using var cmd = new SqlCommand("UPDATE Nexus.ChatMessages SET Body = N'', DeletedAt = SYSDATETIME() WHERE MessageID = @id AND FromUserID = @me AND DeletedAt IS NULL", c);
        cmd.Parameters.AddWithValue("@id", messageId);
        cmd.Parameters.AddWithValue("@me", me);
        return cmd.ExecuteNonQuery() > 0;
    }

    /// <summary>ลบแชททั้งหมดกับคนนี้ = ซ่อนจากฝั่งฉันเท่านั้น (อีกฝั่งยังเห็นแชทของเขา)</summary>
    public int Clear(string me, string other)
    {
        using var c = Open();
        using var cmd = new SqlCommand(@"
            UPDATE Nexus.ChatMessages SET HiddenForFrom = 1 WHERE FromUserID = @me AND ToUserID = @o AND HiddenForFrom = 0;
            DECLARE @n INT = @@ROWCOUNT;
            UPDATE Nexus.ChatMessages SET HiddenForTo = 1, ReadAt = ISNULL(ReadAt, SYSDATETIME()) WHERE ToUserID = @me AND FromUserID = @o AND HiddenForTo = 0;
            SELECT @n + @@ROWCOUNT;", c);
        cmd.Parameters.AddWithValue("@me", me);
        cmd.Parameters.AddWithValue("@o", other);
        return (int)cmd.ExecuteScalar();
    }

    public bool UserExists(string userId)
    {
        using var c = Open();
        using var cmd = new SqlCommand("SELECT COUNT(1) FROM Nexus.Users WHERE UserID = @u AND ISNULL(IsLocked, 0) = 0", c);
        cmd.Parameters.AddWithValue("@u", userId);
        return (int)cmd.ExecuteScalar() > 0;
    }

    /// <summary>ส่งข้อความ (แนบไฟล์ได้)</summary>
    public void Send(string from, string to, string body, ChatFiles.Saved file = null)
    {
        using var c = Open();
        using var cmd = new SqlCommand(@"
            INSERT INTO Nexus.ChatMessages (FromUserID, ToUserID, Body, AttachName, AttachPath, AttachSize, AttachKind)
            VALUES (@f, @t, @b, @an, @ap, @as, @ak)", c);
        cmd.Parameters.AddWithValue("@f", from);
        cmd.Parameters.AddWithValue("@t", to);
        cmd.Parameters.AddWithValue("@b", body ?? "");
        cmd.Parameters.AddWithValue("@an", (object)file?.Name ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ap", (object)file?.Path ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@as", (object)file?.Size ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ak", (object)file?.Kind ?? DBNull.Value);
        cmd.ExecuteNonQuery();
    }

    /// <summary>
    /// ข้อความใหม่สำหรับ Toast (นับจากเลข ID ล่าสุดที่หน้าเว็บเห็น):
    ///   แชท = ข้อความที่ส่งถึงฉัน · แจ้ง Admin: Admin = ข้อความจากผู้ใช้ทุกเรื่อง / ผู้ใช้ = Admin ตอบในเรื่องของฉัน
    /// </summary>
    public (int DmMax, int SupMax, List<FeedItem> Items) Feed(string me, bool admin, int? dmAfter, int? supAfter, bool hasChat, bool hasSupport)
    {
        using var c = Open();
        var items = new List<FeedItem>();
        int dmMax = 0, supMax = 0;
        if (hasChat)
        {
            using (var mx = new SqlCommand("SELECT ISNULL(MAX(MessageID), 0) FROM Nexus.ChatMessages", c)) dmMax = (int)mx.ExecuteScalar();
            if (dmAfter.HasValue)
            {
                using var cmd = new SqlCommand(@"
                    SELECT TOP 10 m.MessageID, m.FromUserID, ISNULL(NULLIF(u.FullName, ''), m.FromUserID), " + Preview + @"
                    FROM Nexus.ChatMessages m LEFT JOIN Nexus.Users u ON u.UserID = m.FromUserID
                    WHERE m.ToUserID = @me AND m.MessageID > @after AND m.DeletedAt IS NULL ORDER BY m.MessageID", c);
                cmd.Parameters.AddWithValue("@me", me);
                cmd.Parameters.AddWithValue("@after", dmAfter.Value);
                using var r = cmd.ExecuteReader();
                while (r.Read()) items.Add(new FeedItem("dm", r.GetInt32(0), r.GetString(1), r.GetString(2), r.GetString(3), null, null));
            }
        }
        if (hasSupport)
        {
            using (var mx = new SqlCommand("SELECT ISNULL(MAX(MessageID), 0) FROM Nexus.SupportMessages", c)) supMax = (int)mx.ExecuteScalar();
            if (supAfter.HasValue)
            {
                using var cmd = new SqlCommand(@"
                    SELECT TOP 10 m.MessageID, m.SenderUserID, ISNULL(NULLIF(u.FullName, ''), m.SenderUserID), " + Preview + @", t.ThreadID, t.Topic
                    FROM Nexus.SupportMessages m
                    JOIN Nexus.SupportThreads t ON t.ThreadID = m.ThreadID
                    LEFT JOIN Nexus.Users u ON u.UserID = m.SenderUserID
                    WHERE m.MessageID > @after AND m.SenderUserID <> @me AND m.DeletedAt IS NULL
                      AND ((@admin = 1 AND m.IsAdmin = 0) OR (t.UserID = @me AND m.IsAdmin = 1))
                    ORDER BY m.MessageID", c);
                cmd.Parameters.AddWithValue("@me", me);
                cmd.Parameters.AddWithValue("@admin", admin);
                cmd.Parameters.AddWithValue("@after", supAfter.Value);
                using var r = cmd.ExecuteReader();
                while (r.Read()) items.Add(new FeedItem("support", r.GetInt32(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetInt32(4), r.GetString(5)));
            }
        }
        return (dmMax, supMax, items);
    }
}
