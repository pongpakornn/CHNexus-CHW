using Nexus.Services;
using Xunit;

namespace CHR.Nexus.Api.Tests;

public class WorkOrderFollowExcelTests
{
    [Fact]
    public void TemplateRoundTrip_ReadsBackOnlyFilledDataCells()
    {
        var month = new DateTime(2026, 11, 1);
        var cells = new Dictionary<string, Dictionary<string, decimal>> { ["ORDER"] = new() { ["3"] = 120m }, ["DEL"] = new() { ["5"] = 40m } };
        var items = new List<WorkOrderFollowExcel.TplItem> { new(7, "PN-1", "Part one", 20, cells) };
        var bytes = WorkOrderFollowExcel.Template(9, "HMC Honda", "WO-1", month, items);
        string path = Path.Combine(Path.GetTempPath(), $"wof_{Guid.NewGuid():N}.xlsx");
        try
        {
            File.WriteAllBytes(path, bytes);
            var p = WorkOrderFollowExcel.Read(path);
            Assert.Equal(9, p.PlanId);
            Assert.Equal(month, p.Month);
            Assert.Empty(p.Errors);
            Assert.Equal(2, p.Cells.Count);                                   // ST. formula row and blank cells are never imported
            Assert.Contains(p.Cells, c => c.ItemId == 7 && c.RowKey == "ORDER" && c.Day == 3 && c.Qty == 120m);
            Assert.Contains(p.Cells, c => c.RowKey == "DEL" && c.Day == 5 && c.Qty == 40m);
        }
        finally { File.Delete(path); }
    }

    [Theory]
    [InlineData("AB-12 3", "AB123")]
    [InlineData(" a_b.c ", "abc")]
    public void NormQ_IgnoresSeparators(string input, string expected) => Assert.Equal(expected, WorkOrderFollowExcel.NormQ(input));
}
