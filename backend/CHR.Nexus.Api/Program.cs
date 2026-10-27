using CHR.Nexus.Api.Web;
using CHR.Nexus.Api.Web.Auth;
using Nexus.Core;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

// 👥 หลายคนใช้พร้อมกัน: งานฐานข้อมูลส่วนใหญ่เป็นแบบรอผล (sync) -> เตรียม thread ไว้ล่วงหน้า คำขอที่มาพร้อมกันไม่ต้องรอคิว
System.Threading.ThreadPool.GetMinThreads(out int minWorker, out int minIo);
System.Threading.ThreadPool.SetMinThreads(Math.Max(minWorker, 64), Math.Max(minIo, 64));

var builder = WebApplication.CreateBuilder(args);

// 🔒 ค่าจริง (Connection string / JWT key) ไม่ขึ้น GitHub:
//    dotnet user-secrets (เครื่อง Dev) หรือ appsettings.Local.json / Environment Variables (Server)
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: false);

// 🔒 แยกจากระบบที่ใช้งานจริง: เขียนได้เฉพาะฐาน CHR-Nexus / ERP 192.168.10.10 อ่านอย่างเดียว (แสดง / ปริ้น) / ห้ามแตะฐาน CIMS
string mainConn = builder.Configuration.GetConnectionString("Main");
string erpConn = builder.Configuration.GetConnectionString("Erp");
if (erpConn != null && erpConn.Contains('<')) erpConn = "";   // ค่าตัวอย่าง (<ERP-SERVER>) = ไม่เปิด ERP
var mainDb = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(mainConn ?? "");
if (!string.Equals(mainDb.InitialCatalog, "CHR-Nexus", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException($"ConnectionStrings:Main ต้องเป็นฐาน CHR-Nexus เท่านั้น (ตอนนี้: \"{mainDb.InitialCatalog}\") - ห้ามต่อฐาน CIMS / ระบบที่ใช้งานจริง");
if (!string.IsNullOrWhiteSpace(erpConn))
{
    var erpDb = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(erpConn);
    if (string.Equals(erpDb.InitialCatalog, "CIMS", StringComparison.OrdinalIgnoreCase) || string.Equals(erpDb.InitialCatalog, "CHR-Nexus", StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("ConnectionStrings:Erp ต้องเป็นฐาน ERP (CHR) - ห้ามชี้ไปฐาน CIMS / CHR-Nexus");
    // ERP = อ่านอย่างเดียว: ทุกคำสั่งผ่าน ErpReadOnly (SELECT เท่านั้น + Rollback ทุกครั้ง)
    erpDb.ApplicationIntent = Microsoft.Data.SqlClient.ApplicationIntent.ReadOnly;
    erpDb.ApplicationName = "CHR-Nexus (read-only)";
    erpConn = erpDb.ConnectionString;
}
GlobalConfig.Init(mainConn, erpConn);
Storage.Init(builder.Configuration["Storage:Root"] ?? Path.Combine(builder.Environment.ContentRootPath, "..", "..", "storage"),
             builder.Configuration.GetSection("Storage:DirectExcelRoots").Get<string[]>(),
             builder.Configuration["Storage:ImageFallback:Stock"],
             builder.Configuration["Storage:ImageFallback:Legacy"],
             builder.Configuration["Storage:ImageFallback:StorePc"]);
// 📎 ไฟล์ / รูปที่แนบในแชท
CHR.Nexus.Api.Web.ChatFiles.Init(builder.Configuration["Storage:ChatFiles"], builder.Configuration["Storage:ChatImages"]);

var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
if (string.IsNullOrWhiteSpace(jwt.Key) || jwt.Key.Length < 32)
    throw new InvalidOperationException("Jwt:Key ต้องยาวอย่างน้อย 32 ตัวอักษร (ตั้งใน user-secrets / appsettings.Local.json)");
builder.Services.AddSingleton(jwt);
builder.Services.AddSingleton<JwtTokens>();
builder.Services.AddSingleton<CHR.Nexus.Api.Web.UploadCache>();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.MapInboundClaims = false;
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = jwt.Issuer, ValidAudience = jwt.Issuer, IssuerSigningKey = JwtTokens.KeyOf(jwt),
            NameClaimType = System.Security.Claims.ClaimTypes.NameIdentifier
        };
        // Token อยู่ใน Cookie HttpOnly (JavaScript อ่านไม่ได้)
        o.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx => { ctx.Token ??= ctx.Request.Cookies[jwt.CookieName]; return Task.CompletedTask; }
        };
    });
builder.Services.AddAuthorization();
builder.Services.AddMemoryCache();
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, CurrentUser>();
builder.Services.AddControllers();
builder.Services.AddHostedService<LiveWatcher>(); // ⚡ เฝ้าคลังที่มีคนเปิดดู -> แจ้งจอทันทีที่ข้อมูลเปลี่ยน
builder.Services.AddResponseCaching();
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? new[] { "http://localhost:3000" })
    .AllowAnyHeader().AllowAnyMethod().AllowCredentials()));

var app = builder.Build();

app.UseMiddleware<ClientContextMiddleware>();
app.UseMiddleware<BugLogMiddleware>(); // 🐞 Exception ที่หลุด = บันทึก BUG LOG + ตอบข้อความไทย (ไม่ค้าง)
app.UseCors();
app.UseResponseCaching();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<LivePublishMiddleware>(); // ⚡ บันทึกสำเร็จ -> แจ้งจอที่เปิดอยู่
app.MapControllers();
app.MapGet("/api/health", () => Results.Ok(new { ok = true, time = DateTime.Now }));

app.Run();
