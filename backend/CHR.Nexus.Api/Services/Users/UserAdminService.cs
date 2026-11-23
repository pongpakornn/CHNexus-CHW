using Microsoft.Data.SqlClient;
using Nexus.Core;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Nexus.Services
{
    // 👥 ผู้ใช้งาน 1 คน (Nexus.Users) สำหรับหน้า USER MANAGEMENT
    public class UserAccount
    {
        public string UserId { get; set; }
        public string Name { get; set; }
        public string Position { get; set; }       // ตำแหน่ง (Position)
        public string Department { get; set; }     // หน่วยงาน (Department)
        public string Section { get; set; }        // แผนก (Section)
        public string Division { get; set; }       // ฝ่าย (Division)
        public int Level { get; set; } = 2;   // UserID ใหม่ = Level 2
        public bool IsOnline { get; set; }
        public bool IsLocked { get; set; }
        public bool IsMasterAdmin { get; set; }
        public DateTime? LastLogin { get; set; }
        public int PermCount { get; set; }

        public string Initials
        {
            get
            {
                // ตัวอักษรแรกของชื่อ + นามสกุล (ภาษาไทยนับสระ/วรรณยุกต์ติดกับพยัญชนะเป็นตัวเดียว)
                string s = string.IsNullOrWhiteSpace(Name) ? UserId ?? "?" : Name.Trim();
                string First(string w) => System.Globalization.StringInfo.GetNextTextElement(w, 0);
                var parts = s.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                bool latin = s.All(ch => ch < 0x0E00 || ch > 0x0E7F);
                string ini = parts.Length >= 2 ? First(parts[0]) + First(parts[1])
                           : latin ? s.Substring(0, Math.Min(2, s.Length)) : First(s);
                return ini.ToUpperInvariant();
            }
        }
        public string LevelText => Level == 1 ? "LEVEL 1 • ADMIN" : Level == 2 ? "LEVEL 2 • MANAGER" : "LEVEL 3 • STAFF";
        public string LastLoginText => LastLogin.HasValue ? "Last login " + LastLogin.Value.ToString("dd/MM/yyyy HH:mm", System.Globalization.CultureInfo.InvariantCulture) : "Never logged in";
        public string StatusText => IsLocked ? "LOCKED" : IsOnline ? "ONLINE" : "OFFLINE";
        public string SubText => string.Join("  •  ", new[] { Position, Department }.Where(x => !string.IsNullOrWhiteSpace(x)));
        public string SubText2 => string.Join("  •  ", new[] { Section, Division }.Where(x => !string.IsNullOrWhiteSpace(x)));

        // 📡 Multi-Scanner: คลังที่ Admin กำหนดให้สแกน (Update_20261015.sql) - แสดงบนการ์ดเฉพาะผู้ใช้ที่ใช้หน้าสแกนได้
        public bool HasScanner { get; set; }
        public string ScanStocks { get; set; }
        public bool ScanSetupKnown { get; set; }
        public bool ScanNotSet => HasScanner && ScanSetupKnown && string.IsNullOrWhiteSpace(ScanStocks);
        public string ScanChipText => ScanNotSet ? "📡 SCAN STOCK NOT SET" : "📡 " + ScanStocks;
        public bool ShowScanChip => HasScanner && ScanSetupKnown;
    }

    // สิทธิ์ 1 ระบบของผู้ใช้ (Nexus.Permissions 1 แถว)
    public class UserPermRow
    {
        public string SysId { get; set; }          // ค่าที่โปรแกรมตรวจสิทธิ์ (เขียนลง Nexus.Permissions.SystemID)
        public string Title { get; set; }
        public string Group { get; set; }          // SYSTEM / STOCK
        public string Hint { get; set; }           // ADD/EDIT/DEL ใช้ทำอะไรในระบบนี้
        public string GroupTitle { get; set; }     // หัวกลุ่ม (แถวแรกของกลุ่มเท่านั้น)
        public bool View { get; set; }
        public bool Add { get; set; }
        public bool Edit { get; set; }
        public bool Delete { get; set; }
        public bool Approve { get; set; }

        // 📡 แถว Multi-Scanner: รายการย่อยคลังสแกน + DISPLAY (หน้าต่าง PERMISSION ใส่ให้ / แถวอื่น = null)
        public object Scanner { get; set; }
        public bool ShowScanner => Scanner != null;
    }

    public class UserAdminService
    {
        private readonly string _cs = GlobalConfig.ConnStr;

        // ACCESS CONTROL table: every granted permission of every user (rows with at least one flag = Y)
        public sealed record AccessRow(string UserId, string SysId, bool View, bool Add, bool Edit, bool Del, bool Approve);
        public List<AccessRow> GetAccessMatrix()
        {
            using var c = new Microsoft.Data.SqlClient.SqlConnection(_cs);
            return Dapper.SqlMapper.Query<AccessRow>(c, @"SELECT UserID AS UserId, SystemID AS SysId,
                       CAST(CASE WHEN CanView = 'Y' THEN 1 ELSE 0 END AS BIT) AS [View], CAST(CASE WHEN CanAdd = 'Y' THEN 1 ELSE 0 END AS BIT) AS [Add],
                       CAST(CASE WHEN CanEdit = 'Y' THEN 1 ELSE 0 END AS BIT) AS Edit, CAST(CASE WHEN CanDelete = 'Y' THEN 1 ELSE 0 END AS BIT) AS Del,
                       CAST(CASE WHEN CanApprove = 'Y' THEN 1 ELSE 0 END AS BIT) AS Approve
                FROM Nexus.Permissions
                WHERE 'Y' IN (CanView, CanAdd, CanEdit, CanDelete, CanApprove)").ToList();
        }

        // ทุกระบบที่โปรแกรมตรวจสิทธิ์ (SystemID ต้องตรงกับที่ UserSession ใช้) - คลังอื่นเพิ่มให้อัตโนมัติจาก Nexus.Stocks
        public static readonly (string SysId, string Title, string Hint)[] Systems =
        {
            ("DASHBOARD",   "Dashboard",                  "VIEW = open the page"),
            ("StoreMaxMin", "Store(Max-Min)",            "VIEW = open + stocks (read only)  •  ADD = add stock / barcode format  •  EDIT = stock settings / barcode formats  •  DEL = delete stock"),
            ("MultiScanner", "Multi-Scanner",              "VIEW = open + scan (stocks + DISPLAY: ▸ SCAN STOCKS + DISPLAY below)  •  DEL = adjust scan  •  APPROVE = NOT DEDUCTED action (approve / register / delete)"),
            ("MasterData",  "Master Data (Customer / Supplier)", "VIEW = open  •  ADD = add  •  EDIT = edit / active-inactive  •  DEL = delete (unused codes only)"),
            ("ProductControl", "Master Data › Product Control", "VIEW = open + export QR  •  ADD = register / import  •  EDIT = edit / show-hide / image  •  DEL = delete"),
            ("EdpSubmission",  "EDP › Plan Submission",   "VIEW = open  •  EDIT = mark success / edit card / drag swap / finish shift"),
            ("EdpPlanning",    "EDP › EDP Planning",      "VIEW = open + export  •  EDIT = operator / remark / done"),
            ("EdpPlanSetting", "EDP › Plan Setting",      "VIEW = open  •  ADD = save plan / template  •  EDIT = apply template / copy plan  •  DEL = clear plan / delete template"),
            ("EdpGraph",       "EDP › Production Graph",  "VIEW = open the page"),
            ("PpDashboard",    "Production Plan › Dashboard", "VIEW = open the page"),
            ("PpCapacity",     "Production Plan › Capacity",  "VIEW = open  •  EDIT = record M/C Actual (working hour / stroke / man)"),
            ("PpSetup",        "Master Data › Production Plan STD", "VIEW = open  •  ADD = add machine / product  •  EDIT = edit STD / Plan SPH / product  •  DEL = delete"),
            ("ChemRecord",     "Chemical Control › Inspection Record", "VIEW = dashboard / control chart / export  •  ADD = record readings / corrective action / submit  •  EDIT = edit or delete others' readings / actions"),
            ("ChemSetup",      "Chemical Control › Parameter Setup", "VIEW = open  •  ADD = new parameter  •  EDIT = spec / control limits / check times  •  DEL = delete"),
            ("PC_WOF",      "PC Digital Workspace › Work Order Follow", "VIEW = open / dashboard  •  ADD = REGISTER PLAN  •  APPROVE = SETUP FLOW (editing = plan owner / editors · signing = users in SETUP FLOW)"),
            ("MFG_KANBAN",  "Manufacturing › Kanban Control", "VIEW = dashboard / open  •  ADD = set kanban / add accumulated qty / receive / production order  •  EDIT = edit kanban / set flow / target + auto  •  DEL = delete kanban / scan / order / return qty"),
            ("PackingCard", "Pick List",                  "VIEW = open the page"),
            ("MAXMINCALC",  "Max-Min Calculator",         "VIEW = open  •  EDIT = edit / import / calculate"),
            ("ForecastOrder", "Forecast / Order / Delivery", "VIEW = open + export  •  ADD = import forecast / order / delivery"),
            ("PR",          "PR Management",              "VIEW = open + approved list  •  ADD = submit  •  EDIT = edit / PR settings  •  DEL = delete  •  APPROVE = approve / reject / export"),
            ("ActivityLog", "Activity Log",               "VIEW = open the page"),
            ("UserManagement", "UserManagement",            "VIEW = open  •  ADD / EDIT / DEL users  •  APPROVE = set permissions")
        };

        public List<UserAccount> GetUsers()
        {
            var list = new List<UserAccount>();
            bool scan = Nexus.Helpers.DbSchema.HasUserScanStocks;
            string scanCols = scan ? @",
                       CASE WHEN ISNULL(u.UserLevel, 3) = 1 OR EXISTS (SELECT 1 FROM Nexus.Permissions p WHERE p.UserID = u.UserID AND p.SystemID = 'MultiScanner' AND p.CanView = 'Y') THEN 1 ELSE 0 END AS HAS_SCAN,
                       STUFF((SELECT ', ' + s.StockCode + CASE WHEN x.IsPriority = 1 THEN ' ★' ELSE '' END
                              FROM Nexus.UserScanStocks x JOIN Nexus.Stocks s ON s.StockID = x.StockID
                              WHERE x.UserID = u.UserID ORDER BY s.StockID FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, '') AS SCAN_STOCKS" : "";
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand($@"
                SELECT u.UserID, u.FullName, u.Position, u.Department, u.Section, u.Division, ISNULL(u.UserLevel, 3) AS LVL, ISNULL(u.IsOnline, 0) AS ONL,
                       ISNULL(u.IsLocked, 0) AS LCK, ISNULL(u.IsMasterAdmin, 0) AS MA, u.LastLogin,
                       (SELECT COUNT(*) FROM Nexus.Permissions p WHERE p.UserID = u.UserID AND p.CanView = 'Y') AS PERMS{scanCols}
                FROM Nexus.Users u ORDER BY ISNULL(u.UserLevel, 3), u.UserID", conn))
            {
                conn.Open();
                using (var r = cmd.ExecuteReader())
                    while (r.Read())
                        list.Add(new UserAccount
                        {
                            UserId = r["UserID"].ToString(),
                            Name = r["FullName"]?.ToString(),
                            Position = r["Position"]?.ToString(),
                            Department = r["Department"]?.ToString(),
                            Section = r["Section"]?.ToString(),
                            Division = r["Division"]?.ToString(),
                            Level = Convert.ToInt32(r["LVL"]),
                            IsOnline = Convert.ToBoolean(r["ONL"]),
                            IsLocked = Convert.ToBoolean(r["LCK"]),
                            IsMasterAdmin = Convert.ToBoolean(r["MA"]),
                            LastLogin = r["LastLogin"] == DBNull.Value ? (DateTime?)null : Convert.ToDateTime(r["LastLogin"]),
                            PermCount = Convert.ToInt32(r["PERMS"]),
                            ScanSetupKnown = scan,
                            HasScanner = scan && Convert.ToInt32(r["HAS_SCAN"]) == 1,
                            ScanStocks = scan && r["SCAN_STOCKS"] != DBNull.Value ? r["SCAN_STOCKS"].ToString() : null
                        });
            }
            return list;
        }

        public bool Exists(string userId)
        {
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand("SELECT COUNT(*) FROM Nexus.Users WHERE UserID = @u", conn))
            {
                cmd.Parameters.AddWithValue("@u", userId);
                conn.Open();
                return Convert.ToInt32(cmd.ExecuteScalar()) > 0;
            }
        }

        // เพิ่มผู้ใช้ (Trigger trg_MST_USER_GrantStockView ให้สิทธิ์ VIEW หน้า Store (Max-Min) + ทุกคลังรวมคลังหลักให้เอง)
        public void AddUser(UserAccount u, string password)
        {
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand(@"INSERT INTO Nexus.Users (UserID, Password, FullName, Position, Department, Section, Division, UserLevel, IsOnline, IsLocked, IsMasterAdmin)
                                              VALUES (@u, @p, @n, @pos, @d, @sec, @div, @l, 0, @lock, 0)", conn))
            {
                Fill(cmd, u);
                cmd.Parameters.AddWithValue("@p", password ?? "");
                conn.Open();
                cmd.ExecuteNonQuery();
                PasswordStore.SetHash(conn, null, u.UserId, password); // 🔐 เก็บแบบ Hash ด้วย
            }
        }

        // แก้ไขผู้ใช้ (password ว่าง = ไม่เปลี่ยนรหัสผ่าน)
        public void UpdateUser(UserAccount u, string newPassword)
        {
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand(@"UPDATE Nexus.Users SET FullName = @n, Position = @pos, Department = @d, Section = @sec, Division = @div, UserLevel = @l, IsLocked = @lock,
                                                     Password = CASE WHEN @p IS NULL THEN Password ELSE @p END
                                              WHERE UserID = @u", conn))
            {
                Fill(cmd, u);
                cmd.Parameters.AddWithValue("@p", string.IsNullOrEmpty(newPassword) ? (object)DBNull.Value : newPassword);
                conn.Open();
                cmd.ExecuteNonQuery();
                PasswordStore.SetHash(conn, null, u.UserId, newPassword); // 🔐 เปลี่ยนรหัส = Hash ใหม่
            }
        }

        private static void Fill(SqlCommand cmd, UserAccount u)
        {
            object V(string s) => string.IsNullOrWhiteSpace(s) ? DBNull.Value : (object)s.Trim();
            cmd.Parameters.AddWithValue("@u", u.UserId.Trim());
            cmd.Parameters.AddWithValue("@n", V(u.Name));
            cmd.Parameters.AddWithValue("@pos", V(u.Position));
            cmd.Parameters.AddWithValue("@d", V(u.Department));
            cmd.Parameters.AddWithValue("@sec", V(u.Section));
            cmd.Parameters.AddWithValue("@div", V(u.Division));
            cmd.Parameters.AddWithValue("@l", u.Level);
            cmd.Parameters.AddWithValue("@lock", u.IsLocked);
        }

        // 📥 Import ผู้ใช้ + สิทธิ์จาก Excel (อ่านทุกชีทในไฟล์ แยกชนิดจากหัวคอลัมน์)
        //   ชีทผู้ใช้  : NO / USERID / PASSWORD / FULLNAME / DIVISION / DEPARTMENT / SECTION / POSITION / USERLEVEL / ISONLINE / ISLOCKED / ISMASTERADMIN
        //               มี USERID แล้ว = อัพเดท (ช่องว่างไม่เปลี่ยน, PASSWORD ว่าง = ไม่เปลี่ยน) / ยังไม่มี = เพิ่มใหม่ (ต้องมี PASSWORD)
        //               ISONLINE ระบบจัดการเอง (ไม่นำเข้า) / ISMASTERADMIN = 1 นำเข้าได้เฉพาะผู้ Import ที่เป็น Level 1 หรือ Master Admin
        //   ชีทสิทธิ์  : NO / USERID / SYSTEMID / CANVIEW / CANADD / CANEDIT / CANDELETE / CANAPPROVE
        //               SYSTEMID = รหัสระบบ (Dashboard, StoreMaxMin, MultiScanner ...) หรือรหัสคลัง / ค่า Y N, 1 0, TRUE FALSE (ว่าง = N)
        //               แถวที่มีในไฟล์ = ตั้งสิทธิ์ตามไฟล์ / ระบบที่ไม่มีในไฟล์ คงสิทธิ์เดิม
        public class ImportRow
        {
            public int RowNumber { get; set; }
            public string Sheet { get; set; }
            public UserAccount User { get; set; } = new UserAccount();
            public string Password { get; set; }
            public bool IsNew { get; set; }
            public bool LevelGiven { get; set; }
            public bool LockGiven { get; set; }
            public bool MasterGiven { get; set; }
            public bool IsDuplicate { get; set; }
            public string Error { get; set; }
            public bool IsValid => string.IsNullOrEmpty(Error);
        }

        public class PermImportRow
        {
            public int RowNumber { get; set; }
            public string Sheet { get; set; }
            public string UserId { get; set; }
            public string SysId { get; set; }
            public bool View { get; set; }
            public bool Add { get; set; }
            public bool Edit { get; set; }
            public bool Delete { get; set; }
            public bool Approve { get; set; }
            public string Error { get; set; }
            public bool IsValid => string.IsNullOrEmpty(Error);
        }

        public class ImportFile
        {
            public List<ImportRow> Users { get; } = new List<ImportRow>();
            public List<PermImportRow> Perms { get; } = new List<PermImportRow>();
        }

        private static readonly Dictionary<string, string[]> ImportHeads = new Dictionary<string, string[]>
        {
            ["ID"] = new[] { "USERID", "USRID", "USER", "EMPID", "EMPLOYEEID", "ID", "รหัสพนักงาน", "รหัสผู้ใช้" },
            ["NAME"] = new[] { "FULLNAME", "NAME", "USERNAME", "EMPLOYEENAME", "ชื่อ", "ชื่อสกุล", "ชื่อนามสกุล" },
            ["PWD"] = new[] { "PASSWORD", "PWD", "PASS", "รหัสผ่าน" },
            ["POS"] = new[] { "POSITION", "POS", "ตำแหน่ง" },
            ["DEPT"] = new[] { "DEPARTMENT", "DEPT", "UNIT", "หน่วยงาน" },
            ["SEC"] = new[] { "SECTION", "SEC", "แผนก" },
            ["DIV"] = new[] { "DIVISION", "DIV", "ฝ่าย" },
            ["LVL"] = new[] { "USERLEVEL", "LEVEL", "LVL", "ระดับ" },
            ["LOCK"] = new[] { "ISLOCKED", "LOCKED", "LOCK", "STATUS", "สถานะ" },
            ["MASTER"] = new[] { "ISMASTERADMIN", "MASTERADMIN", "MASTER" }
        };

        private static readonly Dictionary<string, string[]> PermHeads = new Dictionary<string, string[]>
        {
            ["ID"] = new[] { "USERID", "USRID", "USER", "EMPID", "ID" },
            ["SYS"] = new[] { "SYSTEMID", "SYSID", "SYSTEM", "ระบบ" },
            ["V"] = new[] { "CANVIEW", "VIEW" },
            ["A"] = new[] { "CANADD", "ADD" },
            ["E"] = new[] { "CANEDIT", "EDIT" },
            ["D"] = new[] { "CANDELETE", "DELETE", "DEL" },
            ["P"] = new[] { "CANAPPROVE", "APPROVE", "APP" }
        };

        private static string Norm(string h) =>
            new string((h ?? "").Where(c => !char.IsWhiteSpace(c) && c != '.' && c != '(' && c != ')' && c != '_' && c != '-' && c != '/').ToArray()).ToUpperInvariant();

        // แถวหัวตาราง (10 แถวแรก) ที่มีคอลัมน์บังคับครบ -> (แถว, คอลัมน์)
        private static (int Row, Dictionary<string, int> Cols) FindHeader(ClosedXML.Excel.IXLWorksheet ws, Dictionary<string, string[]> heads, params string[] required)
        {
            foreach (var row in ws.RowsUsed().Take(10))
            {
                var cols = new Dictionary<string, int>();
                foreach (var cell in row.CellsUsed())
                {
                    string h = Norm(cell.GetString());
                    foreach (var kv in heads)
                        if (!cols.ContainsKey(kv.Key) && kv.Value.Contains(h)) { cols[kv.Key] = cell.Address.ColumnNumber; break; }
                }
                if (required.All(cols.ContainsKey)) return (row.RowNumber(), cols);
            }
            return (0, null);
        }

        // Y / N, 1 / 0, TRUE / FALSE, ✓ (ว่าง = false) - ค่าอื่น = null (ผิดรูปแบบ)
        private static bool? Flag(string v)
        {
            v = (v ?? "").Trim().ToUpperInvariant();
            if (v.Length == 0 || v == "N" || v == "NO" || v == "0" || v == "FALSE" || v == "-" || v == "✗") return false;
            if (v == "Y" || v == "YES" || v == "1" || v == "TRUE" || v == "✓" || v == "/" || v == "X") return true;
            return null;
        }

        // รหัสระบบที่ใช้ได้ + รหัสคลังทั้งหมด (ตัวพิมพ์ตามที่โปรแกรมใช้)
        private List<string> ValidSystemIds()
        {
            var ids = Systems.Select(s => s.SysId).ToList();
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand("SELECT StockCode FROM Nexus.Stocks", conn))
            {
                conn.Open();
                using (var r = cmd.ExecuteReader()) while (r.Read()) ids.Add(r.GetString(0));
            }
            return ids;
        }

        // data = the upload bytes kept in memory (the temp file holds plain-text passwords and is deleted right after the first read)
        public ImportFile ReadImport(byte[] data, bool allowMasterAdmin)
        {
            var result = new ImportFile();
            var ms = new System.IO.MemoryStream(data, false);
            var existing = new HashSet<string>(GetUsers().Select(u => u.UserId), StringComparer.OrdinalIgnoreCase);
            var seenUser = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var seenPerm = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var systemIds = ValidSystemIds();

            using (var wb = new ClosedXML.Excel.XLWorkbook(ms))
            {
                foreach (var ws in wb.Worksheets)
                {
                    // ชีทคำอธิบาย / ตัวอย่าง / รายการอ้างอิงของ Template ไม่ใช่ข้อมูลจริง
                    if (new[] { "EX", "HOW TO", "SYSTEM IDS", "OPTIONS" }.Contains(ws.Name.Trim(), StringComparer.OrdinalIgnoreCase)) continue;
                    var perm = FindHeader(ws, PermHeads, "ID", "SYS");
                    if (perm.Row > 0) { ReadPermSheet(ws, perm.Row, perm.Cols, result, systemIds, seenPerm); continue; }
                    var user = FindHeader(ws, ImportHeads, "ID", "NAME");
                    if (user.Row > 0) ReadUserSheet(ws, user.Row, user.Cols, result, existing, seenUser, allowMasterAdmin);
                }
            }
            if (result.Users.Count == 0 && result.Perms.Count == 0)
                throw new System.IO.InvalidDataException("ไม่พบหัวคอลัมน์ในไฟล์ Excel\n\nชีทผู้ใช้: USERID + FULLNAME\nชีทสิทธิ์: USERID + SYSTEMID\n(หัวคอลัมน์อยู่ใน 10 แถวแรกของชีท)");

            // ผู้ใช้ในชีทสิทธิ์ต้องมีอยู่แล้ว หรือเพิ่มใหม่จากชีทผู้ใช้ในไฟล์เดียวกัน
            var newIds = new HashSet<string>(result.Users.Where(u => u.IsValid && u.IsNew).Select(u => u.User.UserId), StringComparer.OrdinalIgnoreCase);
            foreach (var p in result.Perms.Where(p => p.IsValid))
                if (!existing.Contains(p.UserId) && !newIds.Contains(p.UserId)) p.Error = $"ไม่พบ USERID {p.UserId} ในระบบ (และไม่ได้เพิ่มในชีทผู้ใช้)";
            return result;
        }

        private void ReadUserSheet(ClosedXML.Excel.IXLWorksheet ws, int header, Dictionary<string, int> cols, ImportFile result,
                                   HashSet<string> existing, HashSet<string> seen, bool allowMasterAdmin)
        {
            string Get(int r, string k) => cols.TryGetValue(k, out int c) ? ws.Cell(r, c).GetString().Trim() : "";
            int last = ws.LastRowUsed()?.RowNumber() ?? header;
            for (int r = header + 1; r <= last; r++)
            {
                string id = Get(r, "ID"), name = Get(r, "NAME");
                if (id.Length == 0 && name.Length == 0) continue;
                var x = new ImportRow { RowNumber = r, Sheet = ws.Name, Password = Get(r, "PWD") };
                string Opt(string k) { string v = Get(r, k); return v.Length == 0 ? null : v; }
                x.User = new UserAccount { UserId = id, Name = name, Position = Opt("POS"), Department = Opt("DEPT"), Section = Opt("SEC"), Division = Opt("DIV") };

                string lv = Get(r, "LVL");
                if (lv.Length > 0)
                {
                    x.LevelGiven = true;
                    if (int.TryParse(lv.Split(' ')[0], out int l) && l >= 1 && l <= 3) x.User.Level = l;
                    else x.Error = $"USERLEVEL ต้องเป็น 1 / 2 / 3 ({lv})";
                }
                string lk = Get(r, "LOCK");
                if (lk.Length > 0)
                {
                    x.LockGiven = true;
                    string u = lk.ToUpperInvariant();
                    bool? f = u == "LOCK" || u == "LOCKED" ? true : u == "UNLOCK" || u == "ACTIVE" ? false : Flag(lk);
                    if (f.HasValue) x.User.IsLocked = f.Value; else x.Error ??= $"ISLOCKED ไม่ถูกต้อง ({lk}) - ใส่ 1 / 0";
                }
                string ma = Get(r, "MASTER");
                if (ma.Length > 0)
                {
                    bool? f = Flag(ma);
                    if (!f.HasValue) x.Error ??= $"ISMASTERADMIN ไม่ถูกต้อง ({ma}) - ใส่ 1 / 0";
                    else if (f.Value && !allowMasterAdmin) x.Error ??= "ISMASTERADMIN = 1 นำเข้าได้เฉพาะผู้ดูแลระบบ Level 1";
                    else { x.MasterGiven = allowMasterAdmin; x.User.IsMasterAdmin = f.Value; }
                }

                if (x.Error != null) { }
                else if (id.Length == 0) x.Error = "ไม่มี USERID";
                else if (id.Length > 20) x.Error = "USERID ยาวเกิน 20 ตัวอักษร";
                else if (name.Length == 0) x.Error = "ไม่มี FULLNAME";
                else if (!seen.Add(id)) { x.IsDuplicate = true; x.Error = "USERID ซ้ำกับแถวก่อนหน้าในไฟล์"; }
                else
                {
                    x.IsNew = !existing.Contains(id);
                    if (x.IsNew && string.IsNullOrEmpty(x.Password)) x.Error = "ผู้ใช้ใหม่ต้องมี PASSWORD";
                }
                result.Users.Add(x);
            }
        }

        private static void ReadPermSheet(ClosedXML.Excel.IXLWorksheet ws, int header, Dictionary<string, int> cols, ImportFile result,
                                          List<string> systemIds, HashSet<string> seen)
        {
            string Get(int r, string k) => cols.TryGetValue(k, out int c) ? ws.Cell(r, c).GetString().Trim() : "";
            int last = ws.LastRowUsed()?.RowNumber() ?? header;
            for (int r = header + 1; r <= last; r++)
            {
                string id = Get(r, "ID"), sys = Get(r, "SYS");
                if (id.Length == 0 && sys.Length == 0) continue;
                var p = new PermImportRow { RowNumber = r, Sheet = ws.Name, UserId = id };
                bool? v = Flag(Get(r, "V")), a = Flag(Get(r, "A")), e = Flag(Get(r, "E")), d = Flag(Get(r, "D")), ap = Flag(Get(r, "P"));
                string canon = systemIds.FirstOrDefault(s => string.Equals(s, sys, StringComparison.OrdinalIgnoreCase));

                if (id.Length == 0) p.Error = "ไม่มี USERID";
                else if (sys.Length == 0) p.Error = "ไม่มี SYSTEMID";
                else if (canon == null) p.Error = $"ไม่รู้จัก SYSTEMID \"{sys}\"";
                else if (v == null || a == null || e == null || d == null || ap == null) p.Error = "ค่าสิทธิ์ต้องเป็น Y / N หรือ 1 / 0";
                else if (!seen.Add(id + "|" + canon)) p.Error = "USERID + SYSTEMID ซ้ำกับแถวก่อนหน้าในไฟล์";
                p.SysId = canon ?? sys;
                p.View = v == true; p.Add = a == true; p.Edit = e == true; p.Delete = d == true; p.Approve = ap == true;
                result.Perms.Add(p);
            }
        }

        // นำเข้าทั้งไฟล์ใน Transaction เดียว: ผู้ใช้ก่อน (Trigger ให้สิทธิ์เริ่มต้นกับผู้ใช้ใหม่) แล้วค่อยตั้งสิทธิ์ตามชีทสิทธิ์
        public (int Added, int Updated, int Perms) ApplyImport(ImportFile file)
        {
            int add = 0, upd = 0, perms = 0;
            using (var conn = new SqlConnection(_cs))
            {
                conn.Open();
                using (var tr = conn.BeginTransaction())
                {
                    foreach (var x in file.Users.Where(r => r.IsValid))
                    {
                        string sql = x.IsNew
                            ? @"INSERT INTO Nexus.Users (UserID, Password, FullName, Position, Department, Section, Division, UserLevel, IsOnline, IsLocked, IsMasterAdmin)
                                VALUES (@u, @p, @n, @pos, @d, @sec, @div, @l, 0, @lock, @ma)"
                            : @"UPDATE Nexus.Users SET FullName = @n, Position = ISNULL(@pos, Position), Department = ISNULL(@d, Department),
                                       Section = ISNULL(@sec, Section), Division = ISNULL(@div, Division),
                                       UserLevel = CASE WHEN @lg = 1 THEN @l ELSE UserLevel END, IsLocked = CASE WHEN @kg = 1 THEN @lock ELSE IsLocked END,
                                       IsMasterAdmin = CASE WHEN @mg = 1 THEN @ma ELSE IsMasterAdmin END,
                                       Password = CASE WHEN @p IS NULL THEN Password ELSE @p END
                                WHERE UserID = @u";
                        using (var cmd = new SqlCommand(sql, conn, tr))
                        {
                            Fill(cmd, x.User);
                            cmd.Parameters.AddWithValue("@p", string.IsNullOrEmpty(x.Password) ? (object)DBNull.Value : x.Password);
                            cmd.Parameters.AddWithValue("@lg", x.LevelGiven ? 1 : 0);
                            cmd.Parameters.AddWithValue("@kg", x.LockGiven ? 1 : 0);
                            cmd.Parameters.AddWithValue("@mg", x.MasterGiven ? 1 : 0);
                            cmd.Parameters.AddWithValue("@ma", x.MasterGiven && x.User.IsMasterAdmin ? 1 : 0);
                            cmd.ExecuteNonQuery();
                        }
                        PasswordStore.SetHash(conn, tr, x.User.UserId, x.Password); // 🔐 Hash ของรหัสใน Excel
                        if (x.IsNew) add++; else upd++;
                    }

                    foreach (var p in file.Perms.Where(r => r.IsValid))
                    {
                        using (var cmd = new SqlCommand(@"
                            DELETE FROM Nexus.Permissions WHERE UserID = @u AND SystemID = @s COLLATE Latin1_General_CI_AS AND SystemID <> @s COLLATE Latin1_General_CS_AS;
                            IF EXISTS (SELECT 1 FROM Nexus.Permissions WHERE UserID = @u AND SystemID = @s)
                                UPDATE Nexus.Permissions SET CanView = @v, CanAdd = @a, CanEdit = @e, CanDelete = @d, CanApprove = @ap WHERE UserID = @u AND SystemID = @s;
                            ELSE
                                INSERT INTO Nexus.Permissions (UserID, SystemID, CanView, CanAdd, CanEdit, CanDelete, CanApprove) VALUES (@u, @s, @v, @a, @e, @d, @ap);", conn, tr))
                        {
                            string YN(bool b) => b ? "Y" : "N";
                            cmd.Parameters.AddWithValue("@u", p.UserId);
                            cmd.Parameters.AddWithValue("@s", p.SysId);
                            cmd.Parameters.AddWithValue("@v", YN(p.View));
                            cmd.Parameters.AddWithValue("@a", YN(p.Add));
                            cmd.Parameters.AddWithValue("@e", YN(p.Edit));
                            cmd.Parameters.AddWithValue("@d", YN(p.Delete));
                            cmd.Parameters.AddWithValue("@ap", YN(p.Approve));
                            cmd.ExecuteNonQuery();
                        }
                        perms++;
                    }
                    tr.Commit();
                }
            }
            return (add, upd, perms);
        }

        // ---------------------------------------------------------------- IMPORT REVIEW (PLAN.md shared import contract)
        //   row key = USERID (user row + that user's permission rows) · invalid / duplicate user row = "<sheet>#<row>"
        //   NEVER put a password value in a row: only a note that it will be set / changed.
        public static string Flags(bool v, bool a, bool e, bool d, bool p)
        {
            string s = (v ? "V" : "") + (a ? "A" : "") + (e ? "E" : "") + (d ? "D" : "") + (p ? "P" : "");
            return s.Length == 0 ? "-" : s;
        }

        // current permissions: user -> SystemID -> flags (missing row = "-")
        public Dictionary<string, Dictionary<string, string>> GetPermFlags()
        {
            var map = new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand("SELECT UserID, SystemID, CanView, CanAdd, CanEdit, CanDelete, CanApprove FROM Nexus.Permissions", conn))
            {
                conn.Open();
                using (var r = cmd.ExecuteReader())
                    while (r.Read())
                    {
                        bool Y(int i) => !r.IsDBNull(i) && string.Equals(r.GetValue(i).ToString(), "Y", StringComparison.OrdinalIgnoreCase);
                        string u = r.GetValue(0).ToString(), s = r.GetValue(1).ToString();
                        if (!map.TryGetValue(u, out var m)) map[u] = m = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                        m[s] = Flags(Y(2), Y(3), Y(4), Y(5), Y(6));
                    }
            }
            return map;
        }

        private static string LockText(bool locked) => locked ? "LOCKED" : "ACTIVE";

        public static (List<ImportRowDto> Rows, List<ImportErrorDto> Errors) Preview(ImportFile f, List<UserAccount> existing, Dictionary<string, Dictionary<string, string>> perms)
        {
            var known = existing.ToDictionary(u => u.UserId, StringComparer.OrdinalIgnoreCase);
            var rows = new List<ImportRowDto>();
            var errors = new List<ImportErrorDto>();
            foreach (var x in f.Users.Where(x => !x.IsValid))
            {
                string id = string.IsNullOrEmpty(x.User.UserId) ? "-" : x.User.UserId;
                errors.Add(new ImportErrorDto($"{x.Sheet} แถว {x.RowNumber}", $"{id} - {x.Error}"));
                rows.Add(new ImportRowDto($"{x.Sheet}#{x.RowNumber}", x.IsDuplicate ? ImportReview.Duplicate : ImportReview.Invalid, id,
                    $"{x.Sheet} แถว {x.RowNumber}" + (string.IsNullOrEmpty(x.User.Name) ? "" : $" · {x.User.Name}"), new List<ImportField>(),
                    x.IsDuplicate ? "USERID ซ้ำในไฟล์ · ใช้แถวบนสุด แถวนี้ถูกข้าม" : x.Error, null));
            }
            foreach (var p in f.Perms.Where(p => !p.IsValid))
                errors.Add(new ImportErrorDto($"{p.Sheet} แถว {p.RowNumber}", $"{(string.IsNullOrEmpty(p.UserId) ? "-" : p.UserId)} {p.SysId} - {p.Error}"));

            var users = f.Users.Where(x => x.IsValid).ToList();
            var validPerms = f.Perms.Where(p => p.IsValid).ToList();
            var ids = users.Select(x => x.User.UserId).Concat(validPerms.Select(p => p.UserId)).Distinct(StringComparer.OrdinalIgnoreCase);
            foreach (string id in ids)
            {
                var x = users.FirstOrDefault(u => string.Equals(u.User.UserId, id, StringComparison.OrdinalIgnoreCase));
                known.TryGetValue(id, out var ex);
                bool isNew = x?.IsNew == true;
                var fields = new List<ImportField>();
                void Add(string name, string old, string nw, bool edit = false) => fields.Add(new ImportField(name, isNew ? null : old ?? "", nw ?? "", edit));
                if (x != null)
                {
                    var u = x.User;
                    Add("NAME", ex?.Name, u.Name, true);
                    Add("LEVEL", ex?.Level.ToString(), (x.LevelGiven || isNew ? u.Level : ex?.Level ?? u.Level).ToString(), true);
                    if (x.LockGiven || isNew) Add("LOCK", ex == null ? null : LockText(ex.IsLocked), LockText(u.IsLocked));
                    if (x.MasterGiven) Add("MASTER ADMIN", ex == null ? null : ex.IsMasterAdmin ? "1" : "0", u.IsMasterAdmin ? "1" : "0");
                    if (u.Position != null) Add("POSITION", ex?.Position, u.Position);
                    if (u.Department != null) Add("DEPARTMENT", ex?.Department, u.Department);
                    if (u.Section != null) Add("SECTION", ex?.Section, u.Section);
                    if (u.Division != null) Add("DIVISION", ex?.Division, u.Division);
                }
                perms.TryGetValue(id, out var cur);
                var changes = validPerms.Where(p => string.Equals(p.UserId, id, StringComparison.OrdinalIgnoreCase))
                    .Select(p => (p.SysId, Old: cur != null && cur.TryGetValue(p.SysId, out var o) ? o : "-", New: Flags(p.View, p.Add, p.Edit, p.Delete, p.Approve)))
                    .Where(c => c.Old != c.New).ToList();
                if (changes.Count > 0) fields.Add(new ImportField("PERMISSIONS", null, $"{changes.Count:N0} changes"));
                bool pwd = x != null && !string.IsNullOrEmpty(x.Password);
                string status = isNew ? ImportReview.New
                              : changes.Count > 0 || pwd || fields.Any(fl => fl.Old != null && fl.Old != fl.New) ? ImportReview.Changed : ImportReview.Same;
                string sub = string.Join(" · ", new[]
                {
                    x != null ? $"{x.Sheet} แถว {x.RowNumber}" : "PERMISSIONS",
                    x?.User.Name ?? ex?.Name,
                    changes.Count > 0 ? "PERMISSIONS: " + string.Join(", ", changes.Take(10).Select(c => $"{c.SysId} {c.Old}→{c.New}")) + (changes.Count > 10 ? $" ... +{changes.Count - 10}" : "") : null
                }.Where(s => !string.IsNullOrEmpty(s)));
                rows.Add(new ImportRowDto(x?.User.UserId ?? id, status, x?.User.UserId ?? ex?.UserId ?? id, sub, fields,
                    pwd ? (isNew ? "ตั้งรหัสผ่าน" : "เปลี่ยนรหัสผ่าน") : null, null));
            }
            return (rows, errors);
        }

        // apply-side review choices: exclude = whole user (user row + permission rows) · edits = NAME / LEVEL of a valid user row
        public static void ApplyReview(ImportFile f, ImportApplyRequest req)
        {
            var skip = new HashSet<string>(req?.Exclude ?? new List<string>(), StringComparer.OrdinalIgnoreCase);
            foreach (var x in f.Users.Where(x => x.IsValid && skip.Contains(x.User.UserId))) x.Error = "ไม่ใช้ (เลือกในหน้าตรวจก่อนนำเข้า)";
            foreach (var p in f.Perms.Where(p => p.IsValid && skip.Contains(p.UserId))) p.Error = "ไม่ใช้ (เลือกในหน้าตรวจก่อนนำเข้า)";
            foreach (var kv in req?.Edits ?? new Dictionary<string, Dictionary<string, string>>())
            {
                var x = f.Users.FirstOrDefault(u => u.IsValid && string.Equals(u.User.UserId, kv.Key, StringComparison.OrdinalIgnoreCase));
                if (x == null || kv.Value == null) continue;   // excluded / no longer valid: nothing to edit
                foreach (var fv in kv.Value)
                {
                    string v = (fv.Value ?? "").Trim();
                    switch ((fv.Key ?? "").ToUpperInvariant())
                    {
                        case "NAME":
                            if (v.Length == 0) throw new InvalidOperationException($"{x.User.UserId}: NAME ว่างไม่ได้");
                            if (v.Length > 200) throw new InvalidOperationException($"{x.User.UserId}: NAME ยาวเกิน 200 ตัวอักษร");
                            x.User.Name = v;
                            break;
                        case "LEVEL":
                            if (!int.TryParse(v.Split(' ')[0], out int l) || l < 1 || l > 3) throw new InvalidOperationException($"{x.User.UserId}: LEVEL ต้องเป็น 1 / 2 / 3 ({v})");
                            x.User.Level = l; x.LevelGiven = true;
                            break;
                        default: throw new InvalidOperationException($"แก้ช่อง \"{fv.Key}\" ผ่านหน้าตรวจไม่ได้");
                    }
                }
            }
        }

        // กลุ่มระบบแบบเดียวกับหน้า PERMISSION (CIMS / MASTER DATA / EDP / PRODUCTION PLAN / CHEMICAL / USER MANAGEMENT)
        private static readonly (string Group, string[] Ids)[] PermGroups =
        {
            ("CIMS", new[] { "DASHBOARD", "StoreMaxMin", "MultiScanner", "PackingCard", "MAXMINCALC", "ForecastOrder", "PR" }),
            ("MASTER DATA", new[] { "MasterData", "ProductControl" }),
            ("EDP PLANNING", new[] { "EdpGraph", "EdpSubmission", "EdpPlanning", "EdpPlanSetting" }),
            ("PRODUCTION PLAN", new[] { "PpDashboard", "PpCapacity", "PpSetup" }),
            ("CHEMICAL CONTROL", new[] { "ChemRecord", "ChemSetup" }),
            ("USER MANAGEMENT", new[] { "UserManagement", "ActivityLog" }),
        };
        private static string GroupOf(string sysId) =>
            PermGroups.FirstOrDefault(g => g.Ids.Any(i => string.Equals(i, sysId, StringComparison.OrdinalIgnoreCase))).Group ?? "OTHER";

        // 📄 แบบฟอร์ม Import ผู้ใช้ / สิทธิ์ (รูปแบบเดียวกับ Template อื่นทั้งระบบ · ตามหน้า User Management ปัจจุบัน)
        //    USERS: ตำแหน่ง -> ฝ่าย -> แผนก -> หน่วยงาน (Dropdown จาก SETUP › ADD USERID · พิมพ์ค่าอื่นได้)
        //    PERMISSIONS: SYSTEMID Dropdown · Y / N · ชีท SYSTEM IDS เรียงตามกลุ่มระบบ + คลัง · ชีท HOW TO + EX (ตัวอย่างที่กรอกแล้ว)
        public void CreateImportTemplate(string path)
        {
            using (var wb = new ClosedXML.Excel.XLWorkbook())
            {
                string[] uh = { "NO", "USERID", "PASSWORD", "FULLNAME", "POSITION", "DIVISION", "SECTION", "UNIT", "USERLEVEL", "ISLOCKED", "ISMASTERADMIN" };
                string[] ph = { "NO", "USERID", "SYSTEMID", "CANVIEW", "CANADD", "CANEDIT", "CANDELETE", "CANAPPROVE" };
                const int uLast = 101, pLast = 301;

                var u = wb.AddWorksheet("USERS");
                ImportTemplateService.Header(u, uh, new double[] { 6.4, 14, 14, 28, 20, 24, 24, 24, 12, 11, 16 });
                ImportTemplateService.Body(u, uLast, uh.Length);
                for (int r = 2; r <= uLast; r++) u.Cell(r, 1).Value = r - 1;
                u.Range(2, 2, uLast, 3).Style.NumberFormat.Format = "@";   // USERID / PASSWORD ขึ้นต้น 0 ไม่หาย
                ImportTemplateService.LeftAlign(u, uLast, 4, 5, 6, 7, 8);

                var p = wb.AddWorksheet("PERMISSIONS");
                ImportTemplateService.Header(p, ph, new double[] { 6.4, 14, 24, 11, 11, 11, 12, 13 });
                ImportTemplateService.Body(p, pLast, ph.Length);
                for (int r = 2; r <= pLast; r++) p.Cell(r, 1).Value = r - 1;
                p.Range(2, 2, pLast, 2).Style.NumberFormat.Format = "@";

                // ชีทรายการ (Dropdown อ้างถึง)
                var ids = wb.AddWorksheet("SYSTEM IDS");
                ImportTemplateService.Header(ids, new[] { "GROUP", "SYSTEMID", "SYSTEM", "VIEW / ADD / EDIT / DEL / APPROVE" }, new double[] { 20, 22, 36, 100 });
                int row = 2;
                foreach (var (grp, list) in PermGroups)
                    foreach (var id in list)
                    {
                        var sys = Systems.FirstOrDefault(x => string.Equals(x.SysId, id, StringComparison.OrdinalIgnoreCase));
                        if (sys.SysId == null) continue;
                        ids.Cell(row, 1).Value = grp; ids.Cell(row, 2).Value = sys.SysId; ids.Cell(row, 3).Value = sys.Title; ids.Cell(row, 4).Value = sys.Hint; row++;
                    }
                foreach (var sys in Systems.Where(x => GroupOf(x.SysId) == "OTHER")) { ids.Cell(row, 1).Value = "OTHER"; ids.Cell(row, 2).Value = sys.SysId; ids.Cell(row, 3).Value = sys.Title; ids.Cell(row, 4).Value = sys.Hint; row++; }
                foreach (var code in ValidSystemIds().Skip(Systems.Length))
                {
                    ids.Cell(row, 1).Value = "CIMS • STOCKS"; ids.Cell(row, 2).Value = code; ids.Cell(row, 3).Value = "Stock (สิทธิ์รายคลัง)";
                    ids.Cell(row, 4).Value = "VIEW = see the stock  •  ADD = import excel (TEMPLATE MAX-MIN / COIL)  •  EDIT = edit Max / Min / Qty  •  APPROVE (+ EDIT) = MANAGE STOCK (คลังที่นับ Coil)";
                    row++;
                }
                int idLast = Math.Max(2, row - 1);
                ImportTemplateService.Body(ids, idLast, 4);
                ImportTemplateService.LeftAlign(ids, idLast, 1, 2, 3, 4);

                // ตัวเลือก POSITION / ฝ่าย / แผนก / หน่วยงาน (SETUP › ADD USERID)
                var opts = Nexus.Helpers.DbSchema.HasUserOrg ? new UserOrgService().All() : new List<UserOrgService.Opt>();
                var o = wb.AddWorksheet("OPTIONS");
                string[] oh = { "POSITION", "DIVISION (ฝ่าย)", "SECTION (แผนก)", "UNIT (หน่วยงาน)" };
                ImportTemplateService.Header(o, oh, new double[] { 26, 28, 28, 28 });
                int oLast = 1;
                string[] kinds = { "POSITION", "DIVISION", "SECTION", "UNIT" };
                for (int k = 0; k < kinds.Length; k++)
                {
                    var names = opts.Where(x => x.Kind == kinds[k]).Select(x => x.Name).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                    for (int i = 0; i < names.Count; i++) o.Cell(i + 2, k + 1).Value = names[i];
                    oLast = Math.Max(oLast, names.Count + 1);
                    if (names.Count > 0)
                    {
                        var dv = u.Range(2, 5 + k, uLast, 5 + k).CreateDataValidation();
                        dv.List(o.Range(2, k + 1, names.Count + 1, k + 1), true);
                        dv.ErrorStyle = ClosedXML.Excel.XLErrorStyle.Information;   // พิมพ์ค่าอื่นได้ (แจ้งเตือนเฉย ๆ)
                        dv.ShowErrorMessage = true;
                        dv.ErrorTitle = "ไม่มีในรายการ";
                        dv.ErrorMessage = "ค่านี้ไม่มีใน SETUP › ADD USERID · กด OK เพื่อใช้ค่านี้ หรือ Cancel เพื่อเลือกจากรายการ";
                    }
                }
                if (oLast >= 2) ImportTemplateService.Body(o, oLast, 4);
                ImportTemplateService.LeftAlign(o, Math.Max(2, oLast), 1, 2, 3, 4);

                var lv = u.Range(2, 9, uLast, 9).CreateDataValidation(); lv.List("\"1,2,3\"", true);
                foreach (int c in new[] { 10, 11 }) u.Range(2, c, uLast, c).CreateDataValidation().List("\"0,1\"", true);
                var sv = p.Range(2, 3, pLast, 3).CreateDataValidation();
                sv.List(ids.Range(2, 2, idLast, 2), true);
                p.Range(2, 4, pLast, 8).CreateDataValidation().List("\"Y,N\"", true);

                ImportTemplateService.Guide(wb, "CHR-Nexus - USER MANAGEMENT › IMPORT USER / PERMISSION", new[]
                {
                    ("ชีท USERS", "1 แถว = 1 ผู้ใช้ · ดูตัวอย่างที่ชีท EX"),
                    ("USERID * / FULLNAME *", "บังคับ · USERID ที่มีอยู่แล้ว = อัพเดทข้อมูล · ใหม่ = เพิ่มผู้ใช้ (ต้องมี PASSWORD) · USERID ห้ามมีช่องว่าง ยาวไม่เกิน 20"),
                    ("PASSWORD", "รหัสผ่าน · ผู้ใช้เดิมเว้นว่าง = ใช้รหัสเดิม"),
                    ("POSITION", "ตำแหน่ง · เลือกจาก Dropdown (ตั้งที่ SETUP › ADD USERID · ดูชีท OPTIONS) หรือพิมพ์เอง"),
                    ("DIVISION → SECTION → UNIT", "ฝ่าย → แผนก → หน่วยงาน · เลือกจาก Dropdown หรือพิมพ์เอง · ว่าง = ไม่ระบุ"),
                    ("USERLEVEL", "1 = ADMIN (ทุกระบบ + ตั้งค่า) · 2 = MANAGER · 3 = STAFF (2 / 3 ได้เฉพาะสิทธิ์ที่กำหนดในชีท PERMISSIONS)"),
                    ("ISLOCKED", "1 = ล็อก (เข้าระบบไม่ได้) · 0 = ใช้งานได้"),
                    ("ISMASTERADMIN", "1 = Master Admin (นำเข้าได้เฉพาะ Admin Level 1)"),
                    ("ชีท PERMISSIONS", "1 แถว = 1 ผู้ใช้ + 1 ระบบ (หรือ 1 คลัง) · ระบบที่ไม่มีในไฟล์ = คงสิทธิ์เดิม"),
                    ("SYSTEMID", "เลือกจาก Dropdown · ดูชีท SYSTEM IDS (เรียงตามกลุ่ม: CIMS · CIMS • STOCKS · MASTER DATA · EDP PLANNING · PRODUCTION PLAN · CHEMICAL CONTROL · USER MANAGEMENT)"),
                    ("CANVIEW - CANAPPROVE", "Y / N (หรือ 1 / 0) · ความหมายของแต่ละช่องดูคอลัมน์ VIEW / ADD / EDIT / DEL / APPROVE ในชีท SYSTEM IDS"),
                    ("NO", "ลำดับ · ระบบไม่ได้ใช้"),
                    ("", "กรอกในชีท USERS และ / หรือ PERMISSIONS แล้วกด IMPORT ในหน้า User Management · ระบบแสดงสรุปให้ยืนยันก่อนบันทึก · ทุกการ Import เก็บลง Activity Log"),
                });

                // 📘 EX: ตัวอย่างที่กรอกแล้ว (ไม่ถูก Import - ตัวอ่านไฟล์ข้ามชีทนี้)
                var ex = wb.AddWorksheet("EX");
                string P0(int k, string fb) => opts.Where(x => x.Kind == kinds[k]).Select(x => x.Name).FirstOrDefault() ?? fb;
                ex.Cell(1, 1).Value = "ตัวอย่างชีท USERS"; ex.Cell(1, 1).Style.Font.Bold = true;
                object[][] us =
                {
                    new object[] { 1, "EMP001", "1234", "Somchai Jaidee", P0(0, "Operator"), P0(1, "ฝ่ายผลิต"), P0(2, "แผนกผลิต 1"), P0(3, "ปั๊ม 1"), 3, 0, 0 },
                    new object[] { 2, "EMP002", "5678", "Suda Rakngan", P0(0, "Leader"), P0(1, "ฝ่ายผลิต"), P0(2, "แผนกผลิต 1"), P0(3, "ปั๊ม 1"), 2, 0, 0 },
                };
                for (int c = 0; c < uh.Length; c++) ex.Cell(2, c + 1).Value = uh[c];
                for (int r = 0; r < us.Length; r++) for (int c = 0; c < us[r].Length; c++) ex.Cell(3 + r, c + 1).Value = ClosedXML.Excel.XLCellValue.FromObject(us[r][c]);
                StyleEx(ex.Range(2, 1, 2 + us.Length, uh.Length));
                ex.Cell(7, 1).Value = "ตัวอย่างชีท PERMISSIONS (EMP001 สแกน + ดูคลัง STOCK-MAT · EMP002 ส่งยอด EDP)"; ex.Cell(7, 1).Style.Font.Bold = true;
                object[][] ps =
                {
                    new object[] { 1, "EMP001", "MultiScanner", "Y", "N", "N", "N", "N" },
                    new object[] { 2, "EMP001", "STOCK-MAT", "Y", "N", "N", "N", "N" },
                    new object[] { 3, "EMP002", "EdpSubmission", "Y", "N", "Y", "N", "N" },
                    new object[] { 4, "EMP002", "EdpPlanning", "Y", "N", "Y", "N", "N" },
                };
                for (int c = 0; c < ph.Length; c++) ex.Cell(8, c + 1).Value = ph[c];
                for (int r = 0; r < ps.Length; r++) for (int c = 0; c < ps[r].Length; c++) ex.Cell(9 + r, c + 1).Value = ClosedXML.Excel.XLCellValue.FromObject(ps[r][c]);
                StyleEx(ex.Range(8, 1, 8 + ps.Length, ph.Length));
                for (int c = 1; c <= uh.Length; c++) ex.Column(c).Width = c == 4 ? 24 : c >= 5 && c <= 8 ? 20 : 13;

                wb.Worksheet(1).SetTabActive();
                wb.SaveAs(path);
            }
        }

        private static void StyleEx(ClosedXML.Excel.IXLRange r)
        {
            var h = r.FirstRow();
            h.Style.Fill.BackgroundColor = ClosedXML.Excel.XLColor.FromHtml("#002060"); h.Style.Font.FontColor = ClosedXML.Excel.XLColor.White; h.Style.Font.Bold = true;
            r.Style.Border.OutsideBorder = ClosedXML.Excel.XLBorderStyleValues.Thin; r.Style.Border.InsideBorder = ClosedXML.Excel.XLBorderStyleValues.Thin;
        }

        // ลบผู้ใช้: มีประวัติในระบบ (สแกน / PR / Log) -> ลบไม่ได้ คืนข้อความบอกเหตุผล (แนะนำให้ LOCK แทน)
        public string DeleteUser(string userId)
        {
            using (var conn = new SqlConnection(_cs))
            {
                conn.Open();
                using (var cmd = new SqlCommand(@"SELECT (SELECT COUNT(*) FROM Nexus.ScanTransactions WHERE UserID = @u),
                                                         (SELECT COUNT(*) FROM Nexus.PRHeaders WHERE UserID = @u),
                                                         (SELECT COUNT(*) FROM Nexus.SystemLogs WHERE UserID = @u)", conn))
                {
                    cmd.Parameters.AddWithValue("@u", userId);
                    using (var r = cmd.ExecuteReader())
                    {
                        r.Read();
                        int scans = r.GetInt32(0), prs = r.GetInt32(1), logs = r.GetInt32(2);
                        if (scans + prs > 0)
                            return $"ผู้ใช้ {userId} มีประวัติในระบบ (สแกน {scans:N0} รายการ / PR {prs:N0} รายการ) จึงลบไม่ได้\nแนะนำให้ EDIT แล้วติ๊ก LOCKED เพื่อปิดการใช้งานแทน";
                        // มีแค่ Log การใช้งาน -> ลบได้ (Log ยังเก็บไว้ แต่ไม่ผูกกับผู้ใช้แล้ว)
                    }
                }
                using (var tr = conn.BeginTransaction())
                {
                    // คลังสแกน / DISPLAY ของผู้ใช้ลบไปด้วย (ตารางที่ยังไม่มีในฐานนั้นข้าม)
                    string extra = (Nexus.Helpers.DbSchema.HasUserScanStocks ? "DELETE FROM Nexus.UserScanStocks WHERE UserID = @u;\n" : "") +
                                   (Nexus.Helpers.DbSchema.HasUserScanDisplays ? "DELETE FROM Nexus.UserScanDisplays WHERE UserID = @u;\n" : "");
                    using (var cmd = new SqlCommand(@"UPDATE Nexus.SystemLogs SET UserID = NULL WHERE UserID = @u;
                                                      DELETE FROM Nexus.Permissions WHERE UserID = @u;
                                                      " + extra + @"
                                                      DELETE FROM Nexus.Users WHERE UserID = @u;", conn, tr))
                    {
                        cmd.Parameters.AddWithValue("@u", userId);
                        cmd.ExecuteNonQuery();
                    }
                    tr.Commit();
                }
                return null;
            }
        }

        // สิทธิ์ของผู้ใช้ทุกระบบ + ทุกคลัง (ไม่มีแถว = ไม่มีสิทธิ์) - เทียบ SystemID แบบไม่สนตัวพิมพ์ (ข้อมูลเก่าเช่น Dashboard / MaxMinCalc)
        public List<UserPermRow> GetPermissions(string userId)
        {
            var have = new Dictionary<string, (bool v, bool a, bool e, bool d, bool ap)>(StringComparer.OrdinalIgnoreCase);
            var stocks = new List<(string Code, string Name, bool Coil)>();
            using (var conn = new SqlConnection(_cs))
            {
                conn.Open();
                using (var cmd = new SqlCommand("SELECT SystemID, CanView, CanAdd, CanEdit, CanDelete, CanApprove FROM Nexus.Permissions WHERE UserID = @u", conn))
                {
                    cmd.Parameters.AddWithValue("@u", userId);
                    using (var r = cmd.ExecuteReader())
                        while (r.Read())
                        {
                            bool Y(int i) => string.Equals(r[i]?.ToString(), "Y", StringComparison.OrdinalIgnoreCase);
                            have[r.GetString(0)] = (Y(1), Y(2), Y(3), Y(4), Y(5));
                        }
                }
                using (var cmd = new SqlCommand($"SELECT StockCode, StockName, {(Nexus.Helpers.DbSchema.HasCountCoil ? "ISNULL(CountCoil, 0)" : "CAST(0 AS BIT)")} FROM Nexus.Stocks ORDER BY SortNo, StockCode", conn))
                using (var r = cmd.ExecuteReader())
                    while (r.Read()) stocks.Add((r.GetString(0), r["StockName"]?.ToString(), Convert.ToBoolean(r[2])));
            }

            UserPermRow Row(string id, string title, string group, string hint)
            {
                have.TryGetValue(id, out var p);
                return new UserPermRow { SysId = id, Title = title, Group = group, Hint = hint, View = p.v, Add = p.a, Edit = p.e, Delete = p.d, Approve = p.ap };
            }
            var list = Systems.Select(s => Row(s.SysId, s.Title, "SYSTEM", s.Hint)).ToList();
            // คลังที่นับ Coil (Material): APPROVE (+ EDIT) = ปุ่ม MANAGE STOCK (เพิ่ม Master Coil / แก้ไข / โอนย้าย / ปรับปรุงยอด / ประวัติ)
            list.AddRange(stocks.Select(s => Row(s.Code, $"{s.Code}  •  {s.Name}", "STOCK",
                "VIEW = see the stock (remark only)  •  ADD = import excel  •  EDIT = edit Max / Min / Qty / Stock box / pcs" +
                (s.Coil ? "  •  APPROVE (+ EDIT) = 🧲 MANAGE STOCK button (add master coil / edit / transfer / adjust / history)" : ""))));
            if (list.Count > 0) list[0].GroupTitle = "SYSTEMS";
            var firstStock = list.FirstOrDefault(r => r.Group == "STOCK");
            if (firstStock != null) firstStock.GroupTitle = "STOCKS";
            return list;
        }

        // บันทึกสิทธิ์ทั้งหมดของผู้ใช้ (แถวเดิมที่ SystemID ต่างกันแค่ตัวพิมพ์ ถูกแทนด้วยค่าที่โปรแกรมใช้)
        public void SavePermissions(string userId, IEnumerable<UserPermRow> rows)
        {
            using (var conn = new SqlConnection(_cs))
            {
                conn.Open();
                using (var tr = conn.BeginTransaction())
                {
                    foreach (var p in rows)
                    {
                        using (var cmd = new SqlCommand(@"
                            DELETE FROM Nexus.Permissions WHERE UserID = @u AND SystemID = @s COLLATE Latin1_General_CI_AS AND SystemID <> @s COLLATE Latin1_General_CS_AS;
                            IF EXISTS (SELECT 1 FROM Nexus.Permissions WHERE UserID = @u AND SystemID = @s)
                                UPDATE Nexus.Permissions SET CanView = @v, CanAdd = @a, CanEdit = @e, CanDelete = @d, CanApprove = @ap WHERE UserID = @u AND SystemID = @s;
                            ELSE
                                INSERT INTO Nexus.Permissions (UserID, SystemID, CanView, CanAdd, CanEdit, CanDelete, CanApprove) VALUES (@u, @s, @v, @a, @e, @d, @ap);", conn, tr))
                        {
                            string YN(bool b) => b ? "Y" : "N";
                            cmd.Parameters.AddWithValue("@u", userId);
                            cmd.Parameters.AddWithValue("@s", p.SysId);
                            cmd.Parameters.AddWithValue("@v", YN(p.View));
                            cmd.Parameters.AddWithValue("@a", YN(p.Add));
                            cmd.Parameters.AddWithValue("@e", YN(p.Edit));
                            cmd.Parameters.AddWithValue("@d", YN(p.Delete));
                            cmd.Parameters.AddWithValue("@ap", YN(p.Approve));
                            cmd.ExecuteNonQuery();
                        }
                    }
                    tr.Commit();
                }
            }
        }
    }
}
