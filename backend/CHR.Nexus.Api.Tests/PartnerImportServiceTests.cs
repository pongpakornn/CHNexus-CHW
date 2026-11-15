using ClosedXML.Excel;
using Nexus.Services;
using Xunit;

namespace CHR.Nexus.Api.Tests;

public class PartnerImportServiceTests
{
    private static readonly PartnerImportService Svc = new(PartnerService.Customers);

    private static List<PartnerRow> Existing() => new()
    {
        new() { Id = 1, Code = "ABC-1", Name = "Alpha", IsActive = true, Parts = 2 },
        new() { Id = 2, Code = "XYZ", Name = "Xray", IsActive = false },
    };

    private static List<PartnerImportService.Src> Parse(params (string code, string name)[] rows)
    {
        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("S");
        ws.Cell(1, 1).Value = "NO"; ws.Cell(1, 2).Value = "CODE"; ws.Cell(1, 3).Value = "NAME";
        for (int i = 0; i < rows.Length; i++) { ws.Cell(i + 2, 2).Value = rows[i].code; ws.Cell(i + 2, 3).Value = rows[i].name; }
        return Svc.Parse(ws).Rows;
    }

    private static string StatusOf(List<ImportRowDto> rows, string key) => rows.Single(r => r.Key == key).Status;

    [Fact]
    public void BlankNameKeepsExisting_SameNameIsSame_NewNameChanged()
    {
        var rows = Svc.Preview(Parse(("ABC-1", ""), ("XYZ", "Xray"), ("abc-1x", "")), Existing());
        Assert.Equal("SAME", StatusOf(rows, "ABC-1"));
        Assert.Equal("SAME", StatusOf(rows, "XYZ"));
        rows = Svc.Preview(Parse(("ABC-1", "Alpha 2")), Existing());
        Assert.Equal("CHANGED", StatusOf(rows, "ABC-1"));
    }

    [Fact]
    public void DuplicateCode_LastRowWins()
    {
        var src = Parse(("NEW1", "first"), ("NEW1", "second"));
        var rows = Svc.Preview(src, Existing());
        Assert.Equal("DUPLICATE", rows[0].Status);
        Assert.Equal("NEW", StatusOf(rows, "NEW1"));
        var plan = Svc.MakePlan(new("CUSTOMER", src), Existing(), new("x", null, null, null));
        Assert.Equal(new[] { ("NEW1", "second") }, plan.Inserts);
    }

    [Fact]
    public void NearMatchCode_IsSimilar_AndMapUpdatesExisting()
    {
        var src = Parse(("abc 1", "Alpha Co"));   // ABC 1 ~ ABC-1
        var rows = Svc.Preview(src, Existing());
        Assert.Equal("SIMILAR", rows[0].Status);
        Assert.Equal("ABC-1", rows[0].Suggest[0].Key);
        var plan = Svc.MakePlan(new("CUSTOMER", src), Existing(), new("x", null, null, new() { ["ABC 1"] = "ABC-1" }));
        Assert.Empty(plan.Inserts);
        Assert.Equal((1, "ABC-1", "Alpha Co"), plan.Updates.Single());
    }

    [Fact]
    public void Map_IgnoredForExactCodeRows()
    {
        var src = Parse(("ABC-1", "Alpha 2"));   // exact CODE: a map entry must not rebind it to another partner
        var plan = Svc.MakePlan(new("CUSTOMER", src), Existing(), new("x", null, null, new() { ["ABC-1"] = "XYZ" }));
        Assert.Equal((1, "ABC-1", "Alpha 2"), plan.Updates.Single());
    }

    [Fact]
    public void UnknownCode_IsNew_ExcludeAndEditHonoured_BadCodeInvalid()
    {
        var src = Parse(("BRAND-NEW", "Neu"), ("OTHER", "o"), ("bad*code", "x"));
        var rows = Svc.Preview(src, Existing());
        Assert.Equal("NEW", StatusOf(rows, "BRAND-NEW"));
        Assert.Equal("INVALID", rows.Single(r => r.Key.StartsWith("ROW")).Status);
        var plan = Svc.MakePlan(new("CUSTOMER", src), Existing(),
            new("x", new() { "OTHER" }, new() { ["BRAND-NEW"] = new() { ["NAME"] = "Edited" } }, null));
        Assert.Equal(new[] { ("BRAND-NEW", "Edited") }, plan.Inserts);
        Assert.Throws<InvalidOperationException>(() => Svc.MakePlan(new("CUSTOMER", src), Existing(),
            new("x", null, new() { ["BRAND-NEW"] = new() { ["NAME"] = new string('n', 201) } }, null)));
    }
}
