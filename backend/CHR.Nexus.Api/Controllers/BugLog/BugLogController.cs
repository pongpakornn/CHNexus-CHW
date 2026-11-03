using CHR.Nexus.Api.Web;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Nexus.Core;

namespace CHR.Nexus.Api.Controllers;

// 🐞 BUG LOG: ดู / อ่านแล้ว = เฉพาะ Admin Level 1 (ปุ่มกลมในหน้า ACTIVITY LOG) · หน้าเว็บของทุกคนส่ง Error ของ Browser เข้ามาได้
[Route("api/buglog")]
public sealed class BugLogController : AppController
{
    private bool IsAdmin => Me?.UserLevel == 1;

    [HttpGet("count")]
    public IActionResult Count()
    {
        if (!IsAdmin) return Ok(new { ready = false, unread = 0 });
        if (!BugLog.Ready) return Ok(new { ready = false, unread = 0 });
        try
        {
            using var conn = new SqlConnection(GlobalConfig.ConnStr);
            using var cmd = new SqlCommand("SELECT COUNT(*) FROM Nexus.BugLogs WITH (NOLOCK) WHERE IsRead = 0", conn) { CommandTimeout = 5 };
            conn.Open();
            return Ok(new { ready = true, unread = Convert.ToInt32(cmd.ExecuteScalar()) });
        }
        catch (SqlException ex) when (ex.Number == 208) { return Ok(new { ready = false, unread = 0 }); }
    }

    [HttpGet]
    public IActionResult List([FromQuery] string key, [FromQuery] string source, [FromQuery] bool unread = false, [FromQuery] int take = 200)
    {
        if (!IsAdmin) return Deny("BUG LOG ดูได้เฉพาะ Admin (Level 1)");
        var rows = new List<object>();
        try
        {
            using var conn = new SqlConnection(GlobalConfig.ConnStr);
            using var cmd = new SqlCommand(@"
                SELECT TOP (@take) BugID, Source, Severity, Message, Detail, Path, Method, StatusCode, UserID, Client, Hits, FirstAt, LastAt, IsRead
                  FROM Nexus.BugLogs WITH (NOLOCK)
                 WHERE (@src = '' OR Source = @src) AND (@unread = 0 OR IsRead = 0)
                   AND (@key = '' OR Message LIKE @like OR Path LIKE @like OR UserID LIKE @like OR Client LIKE @like)
                 ORDER BY LastAt DESC, BugID DESC", conn) { CommandTimeout = 15 };
            string k = (key ?? "").Trim();
            cmd.Parameters.AddWithValue("@take", Math.Clamp(take, 1, 1000));
            cmd.Parameters.AddWithValue("@src", (source ?? "").Trim().ToUpperInvariant());
            cmd.Parameters.AddWithValue("@unread", unread ? 1 : 0);
            cmd.Parameters.AddWithValue("@key", k);
            cmd.Parameters.AddWithValue("@like", "%" + k.Replace("[", "[[]").Replace("%", "[%]").Replace("_", "[_]") + "%");
            conn.Open();
            using var r = cmd.ExecuteReader();
            while (r.Read())
                rows.Add(new
                {
                    id = r.GetInt64(0), source = r.GetString(1), severity = r.GetString(2), message = r.GetString(3),
                    detail = r.IsDBNull(4) ? null : r.GetString(4), path = r.IsDBNull(5) ? null : r.GetString(5), method = r.IsDBNull(6) ? null : r.GetString(6),
                    status = r.IsDBNull(7) ? (int?)null : r.GetInt32(7), userId = r.IsDBNull(8) ? null : r.GetString(8), client = r.IsDBNull(9) ? null : r.GetString(9),
                    hits = r.GetInt32(10), firstAt = r.GetDateTime(11), lastAt = r.GetDateTime(12), isRead = r.GetBoolean(13)
                });
        }
        catch (SqlException ex) when (ex.Number == 208)
        {
            return Ok(new { ready = false, rows });
        }
        return Ok(new { ready = true, rows });
    }

    public sealed record ReadRequest(List<long> Ids);

    // อ่านแล้ว: ระบุ id = เฉพาะรายการนั้น / ว่าง = ทั้งหมด
    [HttpPost("read")]
    public IActionResult MarkRead([FromBody] ReadRequest req)
    {
        if (!IsAdmin) return Deny("BUG LOG ดูได้เฉพาะ Admin (Level 1)");
        var ids = (req?.Ids ?? new()).Take(1000).ToList();
        using var conn = new SqlConnection(GlobalConfig.ConnStr);
        using var cmd = new SqlCommand(ids.Count == 0
            ? "UPDATE Nexus.BugLogs SET IsRead = 1 WHERE IsRead = 0"
            : $"UPDATE Nexus.BugLogs SET IsRead = 1 WHERE BugID IN ({string.Join(",", ids.Select((_, i) => "@i" + i))})", conn);
        for (int i = 0; i < ids.Count; i++) cmd.Parameters.AddWithValue("@i" + i, ids[i]);
        conn.Open();
        int n = cmd.ExecuteNonQuery();
        return Ok(new { message = $"อ่านแล้ว {n:N0} รายการ" });
    }

    public sealed record ClientError(string Message, string Detail, string Path, string Kind);

    // หน้าเว็บส่ง Error ของ Browser (window.onerror / Promise ที่ไม่ได้ดัก / หน้าพัง) - ทุกคนที่ Login ส่งได้
    [HttpPost("client")]
    public IActionResult FromClient([FromBody] ClientError e)
    {
        if (e == null || string.IsNullOrWhiteSpace(e.Message)) return Ok();
        string ua = Request.Headers.UserAgent.ToString();
        BugLog.Write("WEB", "ERROR", (string.IsNullOrWhiteSpace(e.Kind) ? "" : $"[{e.Kind}] ") + e.Message, e.Detail, e.Path, null, null, Uid,
                     $"{ClientContext.Machine} • {(ua.Length > 120 ? ua[..120] : ua)}");
        return Ok();
    }
}
