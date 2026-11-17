using ClosedXML.Excel;
using Nexus.Services;
using Xunit;
using Coil = Nexus.Services.PentaStockImportService.Coil;

namespace CHR.Nexus.Api.Tests;

public class PentaStockImportServiceTests
{
    private static IXLWorksheet Sheet(string[] heads, params object[][] rows)
    {
        var ws = new XLWorkbook().AddWorksheet("s");
        for (int c = 0; c < heads.Length; c++) ws.Cell(1, c + 1).Value = heads[c];
        for (int r = 0; r < rows.Length; r++)
            for (int c = 0; c < rows[r].Length; c++)
                if (rows[r][c] != null) ws.Cell(r + 2, c + 1).Value = XLCellValue.FromObject(rows[r][c]);
        return ws;
    }

    private static Coil K(string no, string mother, int stk, decimal wt, string status = "IN") => new(no, mother, stk, "S" + stk, status, "P1", wt);

    private static (Coil, string) M(PentaStockImportService.Src s, int stk, params Coil[] coils) =>
        PentaStockImportService.Match(s, stk, coils.ToDictionary(c => c.CoilNo.ToUpperInvariant()),
            coils.Where(c => c.MotherCoil != "").ToLookup(c => c.MotherCoil.ToUpperInvariant()));

    private static PentaStockImportService.Src Src(string coil, string mat, decimal? wt = 10, string err = null, bool sup = false) =>
        new(mat ?? coil, 2, coil, mat, null, null, null, null, wt, null, null, null, err, sup);

    [Fact]
    public void Parse_HeadersAnyOrder_BlankSkipped_NonNumericError()
    {
        var ws = Sheet(new[] { "remain_wt", "MAT_NO", "COIL_NO" },
            new object[] { 100.5, "M1", "C1" }, new object[] { null, null, null }, new object[] { "abc", "M2", "C2" });
        var r = PentaStockImportService.Parse(ws);
        Assert.Equal(2, r.Count);
        Assert.Equal(100.5m, r[0].Wt);
        Assert.Equal("M1", r[0].Key);
        Assert.Contains("REMAIN_WT", r[1].Error);
        Assert.Equal("ROW4", r[1].Key);
    }

    [Theory]
    [InlineData("COIL_NO"), InlineData("MAT_NO"), InlineData("REMAIN_WT")]
    public void Parse_MissingRequiredColumn_Throws(string drop)
    {
        var heads = new[] { "COIL_NO", "MAT_NO", "REMAIN_WT" }.Where(h => h != drop).ToArray();
        var ws = Sheet(heads, heads.Select(_ => (object)"1").ToArray());
        var ex = Assert.Throws<InvalidOperationException>(() => PentaStockImportService.Parse(ws));
        Assert.Contains(drop, ex.Message);
    }

    [Fact]
    public void Parse_DuplicateMatNo_BottomRowWins()
    {
        var ws = Sheet(new[] { "COIL_NO", "MAT_NO", "REMAIN_WT" },
            new object[] { "C1", "m1", 5 }, new object[] { "C1", "M1", 7 });
        var r = PentaStockImportService.Parse(ws);
        Assert.True(r[0].Superseded);
        Assert.Equal("M1#2", r[0].Key);
        Assert.False(r[1].Superseded);
        Assert.Equal("M1", r[1].Key);
    }

    [Fact]
    public void Match_MatNoBeatsCoilNo()
    {
        var (c, how) = M(Src("B", "A"), 1, K("A", "", 1, 1), K("B", "", 1, 1));
        Assert.Equal("A", c.CoilNo);
        Assert.Equal("MAT_NO = NUMBER COIL", how);
    }

    [Fact]
    public void Match_CoilNoThenMother_PrefersGivenStock()
    {
        var (c, how) = M(Src("B", "zz"), 1, K("b", "", 1, 1));
        Assert.Equal("COIL_NO = COIL", how);
        var (m, how2) = M(Src("MOM", "zz"), 2, K("X1", "MOM", 1, 1), K("X2", "MOM", 2, 1));
        Assert.Equal("X2", m.CoilNo);
        Assert.Equal("COIL_NO = MASTER COIL", how2);
        Assert.Null(M(Src("NO", "NO"), 1, K("X1", "MOM", 1, 1)).Item1);
    }

    [Fact]
    public void Preview_Statuses()
    {
        var rows = new List<PentaStockImportService.Src>
        {
            Src("N", "N"), Src("S", "S", 100.4m), Src("C", "C", 90m),
            Src("E", "E", 1, "bad"), Src("D", "D", 1, null, true)
        };
        var coils = new List<Coil> { K("S", "", 1, 100), K("C", "", 1, 100) };
        var p = PentaStockImportService.Preview(rows, 1, coils);
        Assert.Equal(new[] { "NEW", "SAME", "CHANGED", "INVALID", "DUPLICATE" }, p.Select(x => x.Status));
        var w = p[2].Fields.First(f => f.Name == "WEIGHT (KG)");
        Assert.Equal("100", w.Old);
        Assert.Equal("90", w.New);
    }
}
