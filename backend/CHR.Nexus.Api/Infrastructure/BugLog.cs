using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.SqlClient;
using Nexus.Core;

namespace CHR.Nexus.Api.Web;

// 🐞 BUG LOG (Nexus.BugLogs - database/nexus/10_BugLog.sql): ข้อผิดพลาดของระบบทั้ง API และหน้าเว็บ
//   บันทึกเบื้องหลัง (ไม่ให้ผู้ใช้รอ) · ข้อความเดิมซ้ำ = นับ Hits แถวเดิม · ยิงซ้ำถี่ภายใน 10 วินาที = ข้าม (กันฐานข้อมูลโดนถล่ม)
//   ยังไม่รัน Script = ปิดตัวเองเงียบๆ ระบบหลักทำงานต่อได้ · เก็บ 90 วัน
public static class BugLog
{
    private static bool _off;
    private static DateTime _lastPrune = DateTime.MinValue;
    private static readonly ConcurrentDictionary<string, DateTime> Recent = new();
    private static readonly SemaphoreSlim Slots = new(4);
    private static int _pending;
    private const int MaxPending = 500;

    public static bool Ready => !_off;

    public static void Write(string source, string severity, string message, string detail = null, string path = null, string method = null,
                             int? status = null, string userId = null, string client = null)
    {
        if (_off || string.IsNullOrWhiteSpace(message)) return;
        message = Cut(message.Trim(), 1000);
        string hash = Hash($"{source}|{message}|{StripQuery(path)}");
        var now = DateTime.UtcNow;
        if (Recent.TryGetValue(hash, out var at) && now - at < TimeSpan.FromSeconds(10)) return;
        Recent[hash] = now;
        if (Recent.Count > 2000) foreach (var k in Recent.Where(x => now - x.Value > TimeSpan.FromMinutes(1)).Select(x => x.Key).ToList()) Recent.TryRemove(k, out _);

        // ฐานข้อมูลสะดุด = งานเขียน Log ไม่ทับถมจนกิน Connection Pool: เขียนพร้อมกันไม่เกิน 4 · คิวรอเกิน 500 = ทิ้ง (Log วินิจฉัยเท่านั้น)
        if (Interlocked.Increment(ref _pending) > MaxPending) { Interlocked.Decrement(ref _pending); return; }
        Task.Run(async () =>
        {
            await Slots.WaitAsync();
            try
            {
                using var conn = new SqlConnection(GlobalConfig.ConnStr);
                conn.Open();
                using (var cmd = new SqlCommand(@"
                    UPDATE TOP (1) Nexus.BugLogs SET Hits = Hits + 1, LastAt = SYSDATETIME(), IsRead = 0, Detail = ISNULL(@detail, Detail),
                                                    UserID = ISNULL(@user, UserID), Client = ISNULL(@client, Client), StatusCode = ISNULL(@status, StatusCode)
                     WHERE Hash = @hash AND LastAt >= DATEADD(DAY, -7, SYSDATETIME());
                    IF @@ROWCOUNT = 0
                        INSERT INTO Nexus.BugLogs (Source, Severity, Message, Detail, Path, Method, StatusCode, UserID, Client, Hash)
                        VALUES (@src, @sev, @msg, @detail, @path, @method, @status, @user, @client, @hash);", conn))
                {
                    cmd.Parameters.AddWithValue("@src", Cut(source, 10));
                    cmd.Parameters.AddWithValue("@sev", Cut(severity, 10));
                    cmd.Parameters.AddWithValue("@msg", message);
                    cmd.Parameters.AddWithValue("@detail", (object)Cut(detail, 8000) ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@path", (object)Cut(path, 400) ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@method", (object)Cut(method, 10) ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@status", (object)status ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@user", (object)Cut(userId, 50) ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@client", (object)Cut(client, 200) ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@hash", hash);
                    cmd.CommandTimeout = 10;
                    cmd.ExecuteNonQuery();
                }
                // ลบของเก่ากว่า 90 วัน วันละครั้ง
                if (DateTime.UtcNow - _lastPrune > TimeSpan.FromDays(1))
                {
                    _lastPrune = DateTime.UtcNow;
                    using var del = new SqlCommand("DELETE TOP (5000) FROM Nexus.BugLogs WHERE LastAt < DATEADD(DAY, -90, SYSDATETIME())", conn) { CommandTimeout = 30 };
                    del.ExecuteNonQuery();
                }
            }
            catch (SqlException ex) when (ex.Number == 208) { _off = true; }   // ยังไม่มีตาราง (ยังไม่รัน 10_BugLog.sql)
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine("BugLog: " + ex.Message); }
            finally { Slots.Release(); Interlocked.Decrement(ref _pending); }
        });
    }

    public static void Write(Exception ex, HttpContext ctx, string userId, int status = 500) =>
        Write("API", "ERROR", $"{ex.GetType().Name}: {ex.Message}", ex.ToString(), ctx?.Request.Path + ctx?.Request.QueryString, ctx?.Request.Method, status, userId, ClientContext.Machine);

    private static string StripQuery(string p) => p == null ? "" : p.Split('?')[0];
    private static string Cut(string s, int n) => s == null ? null : s.Length > n ? s[..n] : s;
    private static string Hash(string s) => Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(s)));
}

// 🛡 ดัก Exception ที่หลุดจาก Controller: บันทึก BUG LOG + ตอบ 500 เป็นข้อความไทย (หน้าเว็บไม่ค้าง / ไม่เห็น Stack trace)
public sealed class BugLogMiddleware
{
    private readonly RequestDelegate _next;
    public BugLogMiddleware(RequestDelegate next) => _next = next;

    public async Task Invoke(HttpContext ctx)
    {
        try
        {
            await _next(ctx);
        }
        catch (OperationCanceledException) when (ctx.RequestAborted.IsCancellationRequested)
        {
            // ผู้ใช้ปิดหน้า / เปลี่ยนหน้าระหว่างโหลด - ไม่ใช่ Bug
        }
        catch (BadHttpRequestException ex)
        {
            // คำขอไม่ครบ (เน็ตหลุด / ปิดหน้าระหว่างส่งไฟล์) หรือใหญ่เกินกำหนด = ฝั่งผู้ใช้ ไม่ใช่ Bug ของระบบ
            if (ctx.Response.HasStarted) return;
            ctx.Response.Clear();
            ctx.Response.StatusCode = ex.StatusCode;
            await ctx.Response.WriteAsJsonAsync(new { message = ex.StatusCode == 413 ? "ไฟล์ / ข้อมูลใหญ่เกินกำหนด" : "ส่งข้อมูลไม่ครบ (การเชื่อมต่อหลุด) กรุณาลองใหม่อีกครั้ง" });
        }
        catch (Exception ex)
        {
            string uid = ctx.User?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? ctx.User?.Identity?.Name;
            BugLog.Write(ex, ctx, uid);
            if (ctx.Response.HasStarted) throw;
            ctx.Response.Clear();
            ctx.Response.StatusCode = 500;
            await ctx.Response.WriteAsJsonAsync(new { message = "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง\n(บันทึกลง BUG LOG ให้ Admin แล้ว)" });
        }
    }
}
