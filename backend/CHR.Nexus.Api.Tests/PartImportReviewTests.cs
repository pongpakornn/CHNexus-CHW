using Nexus.Services;
using Xunit;

namespace CHR.Nexus.Api.Tests;

public class PartImportReviewTests
{
    private static PartImportRow Row(int n, string code, string name = "N", string partA = null, string error = null) =>
        new() { RowNumber = n, Code = code, Name = name, PartA = partA, Error = error, InMain = true };

    private static readonly List<PartImportService.ExistingPart> Existing = new() { new("ABC-1", "", "Alpha"), new("OLD", "X", "Old part") };

    [Fact]
    public void Classifies_New_Similar_Duplicate_Invalid()
    {
        var first = Row(2, "NEW1");
        var dup = Row(4, "NEW1", error: "dup"); dup.DupOf = first;                 // same key later in file
        var reg = Row(5, "OLD", partA: "X", error: "registered"); reg.Exists = true;
        var rows = new List<PartImportRow> { first, Row(3, "abc 1") /* near ABC-1 */, dup, reg, Row(6, "", error: "ไม่มี PRODUCT CODE") };
        var (items, errors) = PartImportService.Preview(rows, Existing);
        string St(string k) => items.Single(r => r.Key == k).Status;
        Assert.Equal("NEW", St("R2"));
        Assert.Equal("SIMILAR", St("R3"));
        Assert.Equal("ABC-1|", items.Single(r => r.Key == "R3").Suggest.Single().Key);
        Assert.Equal("DUPLICATE", St("R4"));
        Assert.Equal("INVALID", St("R5"));
        Assert.Equal("INVALID", St("R6"));
        Assert.Equal(3, errors.Count);
        // already registered: no edit (key cannot change) · plain invalid: editable to fix
        Assert.DoesNotContain(items.Single(r => r.Key == "R5").Fields, f => f.Edit);
        Assert.Contains(items.Single(r => r.Key == "R6").Fields, f => f.Edit && f.Name == "PRODUCT NAME");
    }

    [Fact]
    public void ExtraCoilRowsFoldIntoTheirProduct()
    {
        var owner = Row(2, "C1"); owner.CoilNo = "K1"; owner.CoilWeight = 10;
        var extra = Row(3, "C1"); extra.CoilNo = "K2"; extra.CoilWeight = 5; extra.IsCoilExtra = true; extra.CoilOwner = owner;
        var (items, _) = PartImportService.Preview(new() { owner, extra }, new());
        var r = Assert.Single(items);
        Assert.StartsWith("2 ลูก · 15 KG", r.Fields.Single(f => f.Name == "COIL").New);
    }

    [Fact]
    public void StillBad_IgnoresExcludedRows()
    {
        var rows = new List<PartImportRow> { Row(2, "A", error: "bad"), Row(3, "B", error: "bad"), Row(4, "C") };
        var edits = new Dictionary<int, Dictionary<string, string>> { [2] = new(), [3] = new(), [4] = new() };
        Assert.Equal(new[] { 2 }, PartImportService.StillBad(rows, edits, new HashSet<int> { 3 }).Select(r => r.RowNumber));
    }

    [Fact]
    public void ApplyArgs_MapsKeysAndFields_RejectsUnknown()
    {
        var (edits, skip) = PartImportService.ApplyArgs(new ImportApplyRequest("x", new() { "R4" },
            new() { ["R2"] = new() { ["PRODUCT NAME"] = "Fixed", ["MAX"] = "5" } }, new() { ["R3"] = "ABC-1|", ["R7"] = "" }));
        Assert.Equal(new HashSet<int> { 3, 4 }, skip);   // mapped to existing = skip · "" = keep as new
        Assert.Equal("Fixed", edits[2]["NAME"]);
        Assert.Equal("5", edits[2]["MAX"]);
        Assert.Throws<InvalidOperationException>(() => PartImportService.ApplyArgs(new ImportApplyRequest("x", null, new() { ["R2"] = new() { ["PRODUCT CODE"] = "Z" } }, null)));
        Assert.Throws<InvalidOperationException>(() => PartImportService.ApplyArgs(new ImportApplyRequest("x", new() { "bogus" }, null, null)));
    }
}
