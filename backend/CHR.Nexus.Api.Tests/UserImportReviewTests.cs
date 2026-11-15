using System.Text.Json;
using Nexus.Services;
using Xunit;
using F = Nexus.Services.UserAdminService;

namespace CHR.Nexus.Api.Tests;

public class UserImportReviewTests
{
    private const string Secret = "Pa55-SECRET-xyz";

    private static List<UserAccount> Existing() => new()
    {
        new() { UserId = "U1", Name = "Alice", Level = 2 },
        new() { UserId = "U2", Name = "Bob", Level = 3 },
    };

    private static Dictionary<string, Dictionary<string, string>> Perms() =>
        new(StringComparer.OrdinalIgnoreCase) { ["U2"] = new(StringComparer.OrdinalIgnoreCase) { ["PR"] = "V" } };

    private static F.ImportFile File()
    {
        var f = new F.ImportFile();
        f.Users.Add(new F.ImportRow { RowNumber = 2, Sheet = "USERS", User = new() { UserId = "U1", Name = "Alice" } });                          // same
        f.Users.Add(new F.ImportRow { RowNumber = 3, Sheet = "USERS", User = new() { UserId = "U2", Name = "Bobby", Level = 2 }, LevelGiven = true }); // changed
        f.Users.Add(new F.ImportRow { RowNumber = 4, Sheet = "USERS", User = new() { UserId = "N1", Name = "New" }, IsNew = true, Password = Secret });
        f.Users.Add(new F.ImportRow { RowNumber = 5, Sheet = "USERS", User = new() { UserId = "U1", Name = "Again" }, IsDuplicate = true, Error = "dup" });
        f.Users.Add(new F.ImportRow { RowNumber = 6, Sheet = "USERS", User = new() { UserId = "U1", Name = "Alice" }, Password = Secret }); // invalid row with a password
        f.Users[4].Error = "bad";
        f.Perms.Add(new F.PermImportRow { RowNumber = 2, Sheet = "PERMISSIONS", UserId = "U2", SysId = "PR", View = true, Add = true });
        f.Perms.Add(new F.PermImportRow { RowNumber = 3, Sheet = "PERMISSIONS", UserId = "U1", SysId = "PR", View = false });   // "-" -> "-" = no change
        return f;
    }

    [Fact]
    public void Classifies_Same_Changed_New_Duplicate_Invalid()
    {
        var (rows, errors) = F.Preview(File(), Existing(), Perms());
        Assert.Equal("SAME", rows.Single(r => r.Key == "U1").Status);
        var u2 = rows.Single(r => r.Key == "U2");
        Assert.Equal("CHANGED", u2.Status);
        Assert.Contains(u2.Fields, f => f.Name == "LEVEL" && f.Old == "3" && f.New == "2" && f.Edit);
        Assert.Contains(u2.Fields, f => f.Name == "PERMISSIONS" && f.New == "1 changes");
        Assert.Contains("PR V→VA", u2.Sub);
        Assert.Equal("NEW", rows.Single(r => r.Key == "N1").Status);
        Assert.Equal("ตั้งรหัสผ่าน", rows.Single(r => r.Key == "N1").Note);
        Assert.Equal("DUPLICATE", rows.Single(r => r.Key == "USERS#5").Status);
        Assert.Equal("INVALID", rows.Single(r => r.Key == "USERS#6").Status);
        Assert.Equal(2, errors.Count);
    }

    [Fact]
    public void PasswordNeverAppearsInPreviewJson()
    {
        var pv = F.Preview(File(), Existing(), Perms());
        string json = JsonSerializer.Serialize(new ImportPreviewDto("id", "f.xlsx", "USER / PERMISSION", pv.Rows, pv.Errors));
        Assert.DoesNotContain(Secret, json);
    }

    [Fact]
    public void ApplyReview_ExcludesWholeUser_EditsNameLevel_RejectsOtherFields()
    {
        var f = File();
        F.ApplyReview(f, new ImportApplyRequest("id", new() { "u2" }, new() { ["N1"] = new() { ["NAME"] = " Neo ", ["LEVEL"] = "3" } }, null));
        Assert.False(f.Users[1].IsValid);
        Assert.False(f.Perms[0].IsValid);   // U2's permission row goes with the user
        Assert.Equal("Neo", f.Users[2].User.Name);
        Assert.Equal(3, f.Users[2].User.Level);
        Assert.True(f.Users[2].LevelGiven);
        Assert.Throws<InvalidOperationException>(() => F.ApplyReview(File(), new ImportApplyRequest("id", null, new() { ["N1"] = new() { ["PASSWORD"] = "x" } }, null)));
        Assert.Throws<InvalidOperationException>(() => F.ApplyReview(File(), new ImportApplyRequest("id", null, new() { ["N1"] = new() { ["LEVEL"] = "9" } }, null)));
    }
}
