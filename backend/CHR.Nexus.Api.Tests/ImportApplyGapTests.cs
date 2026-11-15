using ClosedXML.Excel;
using Nexus.Models;
using Nexus.Services;
using Xunit;
using F = Nexus.Services.UserAdminService;

namespace CHR.Nexus.Api.Tests;

// Gap-fill for the import review apply paths (pure functions, no DB).
public class ImportApplyGapTests
{
    // ---------- Partner
    private static readonly PartnerImportService Svc = new(PartnerService.Customers);
    private static List<PartnerRow> Ex() => new()
    {
        new() { Id = 1, Code = "ABC-1", Name = "Alpha", IsActive = true },
        new() { Id = 2, Code = "XYZ", Name = "Xray", IsActive = false },
    };
    private static List<PartnerImportService.Src> Src(params (string c, string n)[] rows)
    {
        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("S");
        ws.Cell(1, 1).Value = "CODE"; ws.Cell(1, 2).Value = "NAME";
        for (int i = 0; i < rows.Length; i++) { ws.Cell(i + 2, 1).Value = rows[i].c; ws.Cell(i + 2, 2).Value = rows[i].n; }
        return Svc.Parse(ws).Rows;
    }

    [Fact]
    public void Partner_StaleMapTarget_Rejected()
    {
        var src = Src(("abc 1", "Alpha Co"));
        Assert.Throws<InvalidOperationException>(() => Svc.MakePlan(new("C", src), Ex(), new("x", null, null, new() { ["ABC 1"] = "GONE" })));
    }

    [Fact]
    public void Partner_BlankNameKeepsOld_NoUpdateNoInsert_AndNeverDeletesFileAbsentRows()
    {
        var plan = Svc.MakePlan(new("C", Src(("ABC-1", ""))), Ex(), new("x", null, null, null));
        Assert.Empty(plan.Updates); Assert.Empty(plan.Inserts); Assert.Equal(1, plan.Same);
        // XYZ (inactive, absent from file) is untouched: plan only mentions rows in the file
        Assert.DoesNotContain(plan.Updates, u => u.Id == 2);
    }

    [Fact]
    public void Partner_BlankNameEdit_KeepsOld_AndExcludeSkips()
    {
        var src = Src(("ABC-1", "New name"), ("XYZ", "Other"));
        var plan = Svc.MakePlan(new("C", src), Ex(), new("x", new() { "XYZ" }, new() { ["ABC-1"] = new() { ["NAME"] = "" } }, null));
        Assert.Empty(plan.Updates); Assert.Equal(1, plan.Skipped);
    }

    [Fact]
    public void Partner_UpdateTupleHasNoStatus_OnlyIdCodeName()
    {
        var plan = Svc.MakePlan(new("C", Src(("XYZ", "Renamed"))), Ex(), new("x", null, null, null));
        Assert.Equal((2, "XYZ", "Renamed"), plan.Updates.Single());   // inactive row stays inactive: no status in plan
    }

    // ---------- Forecast
    private static CalcImportRow R(int n, string pa, decimal f = 1, string err = null) =>
        new() { RowNumber = n, Customer = "C", PartA = pa, Part = pa, Month = new(2026, 1, 1), Forecast = f, Error = err };

    [Fact]
    public void Forecast_RepeatedKeyThenEdit_SummedValueOverwrittenByEdit()
    {
        var st = new ForecastImportService.State("T", new() { R(2, "A1", 1), R(3, "a1", 2) }, true, "", "");
        var (rows, _, _) = ForecastImportService.MakeRows(st, new("x", null, new() { ["A1|2026-01"] = new() { ["F"] = "7.5" } }, null));
        Assert.Equal(7.5m, rows.Single().Forecast);
    }

    [Fact]
    public void Forecast_BlankMapAndTooLargeEdit()
    {
        var err = MaxMinCalcService.PartANotFound + " x";
        var st = new ForecastImportService.State("T", new() { R(2, "a-1", 1, err) }, true, "", "");
        var (rows, mapped, skipped) = ForecastImportService.MakeRows(st, new("x", null, null, new() { ["A-1|2026-01"] = " " }));
        Assert.Empty(rows); Assert.Empty(mapped); Assert.Equal(1, skipped);   // blank map = keep unresolved = skipped
        var ok = new ForecastImportService.State("T", new() { R(2, "A1") }, true, "", "");
        Assert.Throws<InvalidOperationException>(() => ForecastImportService.MakeRows(ok, new("x", null, new() { ["A1|2026-01"] = new() { ["F"] = "1e15" } }, null)));
    }

    // ---------- PCS
    private static Dictionary<int, (PpMachine, PpPart)> Cur() => new()
    {
        [1] = (new PpMachine { Code = "M1" }, new PpPart { PartA = "A1", Pcs = 100, PcsFrom = "ORDER" }),
        [2] = (new PpMachine { Code = "M1" }, new PpPart { PartA = "A2", Pcs = 50, PcsAuto = 80, PcsFrom = "MANUAL" }),
    };
    private static PcsImportService.State St(params PcsImportService.Row[] r) => new("D", new(2026, 1, 1), r.ToList());

    [Fact]
    public void Pcs_EditAuto_ResetsToAuto_BadEditIsInvalidWithNoWrite_ExcludedHasNoWrite()
    {
        var st = St(new(5, 2, "60", 60m, null), new(6, 1, "7", 7m, null));
        var evs = PcsImportService.Eval(st, Cur(), new("x", new() { "1" }, new() { ["2"] = new() { ["PCS"] = "AUTO" } }, null));
        Assert.Equal((2, (decimal?)null), evs.Single(e => e.Op != null).Op is { } o ? (o.ItemId, o.Pcs) : default);
        Assert.Null(evs.Single(e => e.Row.Key == "1").Op);   // excluded
        var bad = PcsImportService.Eval(st, Cur(), new("x", null, new() { ["2"] = new() { ["PCS"] = "abc" } }, null));
        var r2 = bad.Single(e => e.Row.Key == "2");
        Assert.Equal("INVALID", r2.Row.Status); Assert.Null(r2.Op);
        var neg = PcsImportService.Eval(st, Cur(), new("x", null, new() { ["2"] = new() { ["PCS"] = "-5" } }, null));
        Assert.Equal("INVALID", neg.Single(e => e.Row.Key == "2").Row.Status);
        Assert.Throws<InvalidOperationException>(() => PcsImportService.ParsePcs("100000000"));
        Assert.Equal(1234m, PcsImportService.ParsePcs("1,234"));
    }

    // ---------- Users
    private static F.ImportFile File2()
    {
        var f = new F.ImportFile();
        f.Users.Add(new F.ImportRow { RowNumber = 2, Sheet = "U", User = new() { UserId = "U1", Name = "Al", Level = 3 } });
        f.Users.Add(new F.ImportRow { RowNumber = 3, Sheet = "U", User = new() { UserId = "U2", Name = "Bo", Level = 3 } });
        return f;
    }
    private static ImportApplyRequest E(string key, string field, string val) => new("x", null, new() { [key] = new() { [field] = val } }, null);

    [Theory]
    [InlineData("LEVEL", "0")] [InlineData("LEVEL", "4")] [InlineData("LEVEL", "x")] [InlineData("NAME", "  ")]
    [InlineData("ISMASTERADMIN", "1")] [InlineData("PASSWORD", "x")] [InlineData("ISLOCKED", "0")]
    public void Users_BadOrForbiddenEditRejected(string field, string val) =>
        Assert.Throws<InvalidOperationException>(() => F.ApplyReview(File2(), E("U1", field, val)));

    [Fact]
    public void Users_LevelEditCaseInsensitiveKey_AcceptsLabelText_AndSetsLevelGivenForControllerRecheck()
    {
        var f = File2();
        F.ApplyReview(f, E("u1", "level", "1 • ADMIN"));
        Assert.Equal(1, f.Users[0].User.Level);
        Assert.True(f.Users[0].LevelGiven);   // CheckImportRules (controller) rejects Level < caller after this
    }

    [Fact]
    public void Users_EditForExcludedOrUnknownUser_IsIgnored()
    {
        var f = File2();
        F.ApplyReview(f, new("x", new() { "U1" }, new() { ["U1"] = new() { ["LEVEL"] = "9" }, ["NOPE"] = new() { ["NAME"] = "z" } }, null));
        Assert.False(f.Users[0].IsValid);
        Assert.Equal(3, f.Users[0].User.Level);
    }
}
