using Nexus.Services;
using Xunit;

namespace CHR.Nexus.Api.Tests;

public class WorkloadRefImportTests
{
    private static readonly DateTime Nov = new(2026, 11, 1);
    private static WorkloadExcelService.RefRow R(string row, decimal? pdt, decimal? dir, decimal? prod = null, DateTime? m = null) => new(m ?? Nov, row, pdt, dir, prod);
    private static string Key(string row) => "2026-11|" + row;

    [Fact]
    public void Status_NewChangedSame_AndOldNewFields()
    {
        var p = new WorkloadExcelService.Parsed("9. ManPower", Nov, new() { R("TPS", 10, 2), R("QA", 5, 1), R("QC", 7, 1) });
        var cur = new Dictionary<string, WorkloadExcelService.RefRow> { [Key("QA")] = R("QA", 5, 1), [Key("QC")] = R("QC", 6, 1) };
        var evs = WorkloadExcelService.Eval(p, cur, null);
        Assert.Equal(new[] { "NEW", "SAME", "CHANGED" }, evs.Select(e => e.Row.Status));
        var pdt = evs[2].Row.Fields.Single(f => f.Name == "PDT");
        Assert.Equal(("6", "7"), (pdt.Old, pdt.New));
        Assert.Null(evs[1].Op);   // SAME is not written
    }

    [Fact]
    public void Duplicate_LastWins_ExcludeAndEdit_InvalidEdit()
    {
        var p = new WorkloadExcelService.Parsed("S", Nov, new() { R("TPS", 1, 1), R("TPS", 2, 2), R("QA", 3, 3) });
        var evs = WorkloadExcelService.Eval(p, new(), new("x", new() { Key("QA") }, new() { [Key("TPS")] = new() { ["Direct"] = "2.5" } }, null));
        Assert.Equal("DUPLICATE", evs[0].Row.Status);
        var written = evs.Where(e => e.Op != null).Select(e => e.Op).ToList();
        Assert.Single(written);
        Assert.Equal((2m, 2.5m), (written[0].Pdt, written[0].Direct));
        var bad = WorkloadExcelService.Eval(p, new(), new("x", null, new() { [Key("QA")] = new() { ["PDT"] = "-1" } }, null));
        Assert.Equal("INVALID", bad.Single(e => e.Row.Key == Key("QA")).Row.Status);
    }
}
