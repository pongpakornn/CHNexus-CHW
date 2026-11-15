using Nexus.Models;
using Nexus.Services;
using Xunit;

namespace CHR.Nexus.Api.Tests;

public class ForecastImportServiceTests
{
    private static readonly DateTime Jan = new(2026, 1, 1);

    private static CalcImportRow Row(int n, string partA, decimal f, decimal o, decimal d, string error = null, DateTime? month = null) =>
        new() { RowNumber = n, Customer = "CUST", PartA = partA, Part = partA, Month = month ?? Jan, Forecast = f, Order = o, Delivery = d, Error = error };

    private static ForecastImportService.State St(params CalcImportRow[] rows) => new("FORECAST / ORDER", rows.ToList(), true, "Jan 2026", "2026-01");
    private static string StatusOf(List<ImportRowDto> rows, string key) => rows.Single(r => r.Key == key).Status;
    private static readonly ImportApplyRequest NoEdits = new("x", null, null, null);

    [Fact]
    public void Classify_NewChangedSame()
    {
        Assert.Equal("NEW", ForecastImportService.Classify(null, new(1, 2, 3)));
        Assert.Equal("SAME", ForecastImportService.Classify(new(1, 2, 3), new(1, 2, 3)));
        Assert.Equal("CHANGED", ForecastImportService.Classify(new(1, 2, 3), new(1, 2, 4)));
    }

    [Fact]
    public void BuildRows_StatusAndOldNewFields()
    {
        var items = ForecastImportService.Index(new() { Row(2, "A1", 10, 0, 0), Row(3, "A2", 5, 5, 5), Row(4, "A3", 1, 1, 1) });
        var old = new Dictionary<string, ForecastImportService.Fc> { ["CUST|A2|2026-01"] = new(5, 5, 5), ["CUST|A3|2026-01"] = new(1, 1, 0) };
        var rows = ForecastImportService.BuildRows(items, old, new());
        Assert.Equal("NEW", StatusOf(rows, "A1|2026-01"));
        Assert.Equal("SAME", StatusOf(rows, "A2|2026-01"));
        var changed = rows.Single(r => r.Key == "A3|2026-01");
        Assert.Equal("CHANGED", changed.Status);
        var d = changed.Fields.Single(f => f.Name == "D");
        Assert.Equal(("0", "1"), (d.Old, d.New));
        Assert.All(changed.Fields, f => Assert.True(f.Edit));
    }

    [Fact]
    public void RepeatedKey_IsSummedIntoOneRowWithNote()
    {
        var rows = new List<CalcImportRow> { Row(2, "a1", 1, 2, 3), Row(5, "A1", 9, 9, 9) };
        var items = ForecastImportService.Index(rows);
        Assert.Single(items);
        Assert.Equal(2, items[0].Count);
        var dto = ForecastImportService.BuildRows(items, new(), new()).Single();
        Assert.Equal("NEW", dto.Status);
        Assert.Equal("10", dto.Fields.Single(f => f.Name == "F").New);
        Assert.Contains("รวม 2 แถวในไฟล์", dto.Note);
        var plan = ForecastImportService.MakeRows(St(rows.ToArray()), NoEdits);
        Assert.Single(plan.Rows);
        Assert.Equal(10, plan.Rows[0].Forecast);
    }

    [Fact]
    public void UnknownPartA_IsSimilarWithSuggestion_OrInvalidWithout()
    {
        var err = MaxMinCalcService.PartANotFound + " a-1 ในระบบ";
        var items = ForecastImportService.Index(new() { Row(2, "a-1", 1, 0, 0, err), Row(3, "zzz", 1, 0, 0, err), Row(4, "", 1, 0, 0, "ไม่มี PART A") });
        var sim = new Dictionary<string, List<ImportSuggest>> { ["A-1"] = new() { new("A1", "A1 · CUST") } };
        var rows = ForecastImportService.BuildRows(items, new(), sim);
        Assert.Equal("SIMILAR", StatusOf(rows, "A-1|2026-01"));
        Assert.Equal("A1", rows.Single(r => r.Status == "SIMILAR").Suggest[0].Key);
        Assert.Equal("INVALID", StatusOf(rows, "ZZZ|2026-01"));
        Assert.Equal("INVALID", StatusOf(rows, "ROW4"));
        Assert.Equal(2, ForecastImportService.Errors(rows, items).Count);   // zzz + row 4
    }

    [Fact]
    public void MakeRows_ExcludeEditsAndMap()
    {
        var err = MaxMinCalcService.PartANotFound + " a-1 ในระบบ";
        var st = St(Row(2, "A1", 1, 2, 3), Row(3, "A2", 4, 5, 6), Row(4, "a-1", 7, 8, 9, err), Row(5, "zzz", 1, 1, 1, "ไม่มี"));
        var req = new ImportApplyRequest("x", new() { "A2|2026-01" }, new() { ["A1|2026-01"] = new() { ["F"] = "99", ["D"] = "" } }, new() { ["A-1|2026-01"] = "A9" });
        var (rows, mapped, skipped) = ForecastImportService.MakeRows(st, req);
        Assert.Equal(new[] { "A1", "A9" }, rows.Select(r => r.Part));
        Assert.Equal(99, rows[0].Forecast);
        Assert.Equal(0, rows[0].Delivery);   // blank edit = 0
        Assert.Single(mapped);
        Assert.Equal(2, skipped);   // excluded A2 + invalid row
    }

    [Fact]
    public void MakeRows_RejectsNegativeOrTextEdit_AndMapClash()
    {
        var st = St(Row(2, "A1", 1, 2, 3));
        Assert.Throws<InvalidOperationException>(() => ForecastImportService.MakeRows(st, new("x", null, new() { ["A1|2026-01"] = new() { ["O"] = "-1" } }, null)));
        Assert.Throws<InvalidOperationException>(() => ForecastImportService.MakeRows(st, new("x", null, new() { ["A1|2026-01"] = new() { ["O"] = "abc" } }, null)));
        var err = MaxMinCalcService.PartANotFound + " x";
        var clash = St(Row(2, "A1", 1, 2, 3), Row(3, "a-1", 1, 1, 1, err));
        Assert.Throws<InvalidOperationException>(() => ForecastImportService.MakeRows(clash, new("x", null, null, new() { ["A-1|2026-01"] = "A1" })));
    }
}
