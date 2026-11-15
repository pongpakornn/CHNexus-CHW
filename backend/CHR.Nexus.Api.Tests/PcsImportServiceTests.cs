using Nexus.Services;
using Xunit;

namespace CHR.Nexus.Api.Tests;

public class PcsImportServiceTests
{
    private static readonly DateTime Jan = new(2026, 1, 1);

    private static Dictionary<int, (PpMachine Machine, PpPart Part)> Cur() => new()
    {
        [1] = (new PpMachine { Id = 9, Code = "M1" }, new PpPart { Id = 1, PartA = "A1", Pcs = 100, PcsFrom = "ORDER" }),                 // AUTO 100
        [2] = (new PpMachine { Id = 9, Code = "M1" }, new PpPart { Id = 2, PartA = "A2", Pcs = 50, PcsAuto = 80, PcsFrom = "MANUAL" }),  // manual 50, AUTO 80
    };

    private static PcsImportService.State St(params PcsImportService.Row[] r) => new("PRESS1", Jan, r.ToList());
    private static PcsImportService.Row R(int line, int id, string text, decimal? v, string err = null) => new(line, id, text, v, err);
    private static ImportRowDto Of(List<PcsImportService.Ev> e, string key) => e.Single(x => x.Row.Key == key).Row;

    [Theory]
    [InlineData(false, 100, 100, null, "AUTO", "AUTO")]   // blank on AUTO row = same
    [InlineData(false, 100, 100, 100, "AUTO", "AUTO")]    // equals AUTO = same
    [InlineData(false, 100, 100, 7, "AUTO", "7")]         // set manual
    [InlineData(true, 50, 80, null, "50", "AUTO")]        // blank on manual row = back to AUTO
    [InlineData(true, 50, 80, 80, "50", "AUTO")]          // equals AUTO = back to AUTO
    [InlineData(true, 50, 80, 50, "50", "50")]            // same manual
    [InlineData(true, 50, 80, 60, "50", "60")]            // change manual
    public void Classify(bool manual, int now, int auto, int? v, string old, string @new)
    {
        var (o, n, _) = PcsImportService.Classify(manual, now, auto, v);
        Assert.Equal((old, @new), (o, n));
    }

    [Fact]
    public void Eval_StatusesInvalidDuplicateUnknown()
    {
        var evs = PcsImportService.Eval(St(R(5, 1, "", null), R(6, 2, "60", 60), R(7, 3, "5", 5), R(8, 1, "7", 7), R(9, 2, "x", null, "PCS ไม่ใช่ตัวเลข (x)")), Cur(), null);
        Assert.Equal("DUPLICATE", evs[0].Row.Status);                       // item 1 twice -> row 8 wins
        Assert.Equal("INVALID", Of(evs, "3").Status);                        // unknown ITEM ID
        Assert.Equal("CHANGED", Of(evs, "1").Status);                        // last row 7
        Assert.Equal("INVALID", Of(evs, "2").Status);                        // item 2 at row 6 (dup) and row 9 (bad number, wins)
        Assert.Contains(evs, e => e.Row.Status == "DUPLICATE" && e.Row.Key == "2#6");
    }

    [Fact]
    public void Eval_ApplyWritesChangedOnly_HonoursExcludeAndEdit()
    {
        var st = St(R(5, 1, "7", 7), R(6, 2, "", null));
        var all = PcsImportService.Eval(st, Cur(), new("x", null, null, null));
        Assert.Equal(new[] { (1, (decimal?)7), (2, (decimal?)null) }, all.Where(e => e.Op != null).Select(e => (e.Op.ItemId, e.Op.Pcs)));
        var ex = PcsImportService.Eval(st, Cur(), new("x", new() { "1" }, new() { ["2"] = new() { ["PCS"] = "55" } }, null));
        Assert.Equal(new[] { (2, (decimal?)55) }, ex.Where(e => e.Op != null).Select(e => (e.Op.ItemId, e.Op.Pcs)));
        Assert.Throws<InvalidOperationException>(() => PcsImportService.ParsePcs("-1"));
        Assert.Null(PcsImportService.ParsePcs("auto"));
    }
}
