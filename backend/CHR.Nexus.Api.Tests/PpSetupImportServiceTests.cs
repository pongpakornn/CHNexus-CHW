using Nexus.Services;
using Xunit;

namespace CHR.Nexus.Api.Tests;

public class PpSetupImportServiceTests
{
    private static PpMachine M1() => new() { Id = 1, Dept = "PRESS1", Code = "PROG 200-19", Group = "GROUP 1", Sort = 3, Qty = 2, Eff = 0.85m, Man = 4, Active = true };

    private static PpSetupImportService.Raw Raw(int row, params (string k, string v)[] cells) => new(row, cells.ToDictionary(c => c.k, c => c.v, StringComparer.OrdinalIgnoreCase), null);
    private static ImportRowDto Of(List<PpSetupImportService.Ev> e, string key) => e.Single(x => x.Row.Key == key).Row;
    private static readonly ImportApplyRequest Apply = new("x", null, null, null);

    [Fact]
    public void ReadRows_RejectsFileOverRowCap()
    {
        using var wb = new ClosedXML.Excel.XLWorkbook();
        var ws = wb.AddWorksheet("MACHINES");
        ws.Cell(1, 1).Value = "DEPT"; ws.Cell(1, 2).Value = "MACHINE CODE";
        ws.Cell(PpSetupImportService.MaxRows + 1, 1).Value = "PRESS1";   // exactly at the cap = allowed
        Assert.Single(PpSetupImportService.ReadRows(ws, PpSetupImportService.MachineHeads, new[] { "DEPT", "MACHINE CODE" }, "T"));
        ws.Cell(PpSetupImportService.MaxRows + 2, 2).Value = "X";
        var ex = Assert.Throws<InvalidOperationException>(() => PpSetupImportService.ReadRows(ws, PpSetupImportService.MachineHeads, new[] { "DEPT", "MACHINE CODE" }, "T"));
        Assert.Contains("มากเกิน", ex.Message);
    }

    // ------------------------------------------------------------ machines
    [Fact]
    public void Machine_BlankKeeps_SameNotTouched_ChangedShowsOldNew_NewNeedsRequired()
    {
        var raws = new List<PpSetupImportService.Raw>
        {
            Raw(2, ("DEPT", "press1"), ("MACHINE CODE", "PROG 200-19")),                                      // all blank = keep -> SAME
            Raw(3, ("DEPT", "PRESS1"), ("MACHINE CODE", "PROG 200-19"), ("TARGET EFF (%)", "90")),           // changed
            Raw(4, ("DEPT", "PRESS1"), ("MACHINE CODE", "NEW-1"), ("GROUP", "g2"), ("Q'TY LINE", "1"), ("TARGET EFF (%)", "80"), ("STD MAN", "2")),
            Raw(5, ("DEPT", "PRESS1"), ("MACHINE CODE", "NEW-2"), ("GROUP", "g2")),                          // missing required numbers
        };
        var evs = PpSetupImportService.EvalMachines(new() { raws[0], raws[2], raws[3] }, new() { M1() }, null);
        Assert.Equal("SAME", Of(evs, "M|PRESS1|PROG 200-19").Status);
        Assert.Equal("NEW", Of(evs, "M|PRESS1|NEW-1").Status);
        Assert.Equal("INVALID", Of(evs, "M|PRESS1|NEW-2").Status);

        evs = PpSetupImportService.EvalMachines(new() { raws[1] }, new() { M1() }, null);
        var row = Of(evs, "M|PRESS1|PROG 200-19");
        Assert.Equal("CHANGED", row.Status);
        var eff = row.Fields.Single(f => f.Name == "TARGET EFF (%)");
        Assert.Equal(("85", "90"), (eff.Old, eff.New));
        Assert.Equal("GROUP 1", row.Fields.Single(f => f.Name == "GROUP").New);   // blank cell kept the old value
    }

    [Fact]
    public void Machine_ValidationIsTheScreenRule_AndNewIsAlwaysActive()
    {
        var bad = PpSetupImportService.EvalMachines(new() { Raw(2, ("DEPT", "PRESS1"), ("MACHINE CODE", "PROG 200-19"), ("TARGET EFF (%)", "200")) }, new() { M1() }, null);
        Assert.Equal("INVALID", bad[0].Row.Status);
        Assert.Null(bad[0].Op);
        var f = PpSetupImportService.BuildMachine(null, "PRESS1", "N1", new(StringComparer.OrdinalIgnoreCase) { ["GROUP"] = "g", ["Q'TY LINE"] = "1", ["TARGET EFF (%)"] = "100", ["STD MAN"] = "0", ["STATUS"] = "INACTIVE", ["STROKE"] = "pcs" }, 7);
        Assert.True(f.Active);
        Assert.True(f.ByPcs);
        Assert.Equal(1m, f.Eff);
        Assert.Equal(7, f.Sort);
    }

    [Fact]
    public void Machine_DuplicateSimilarExcludeEditMap()
    {
        var raws = new List<PpSetupImportService.Raw>
        {
            Raw(2, ("DEPT", "PRESS1"), ("MACHINE CODE", "PROG 200-19"), ("STD MAN", "5")),
            Raw(3, ("DEPT", "PRESS1"), ("MACHINE CODE", "prog 200-19"), ("STD MAN", "6")),                 // same key, bottom wins
            Raw(4, ("DEPT", "PRESS1"), ("MACHINE CODE", "PROG200_19"), ("STD MAN", "9")),                  // near match
            Raw(5, ("DEPT", "NOPE"), ("MACHINE CODE", "X")),                                                // bad dept
        };
        var evs = PpSetupImportService.EvalMachines(raws, new() { M1() }, null);
        Assert.Equal("DUPLICATE", evs[0].Row.Status);
        Assert.Equal("CHANGED", evs[1].Row.Status);
        Assert.Equal("SIMILAR", Of(evs, "M|PRESS1|PROG200_19").Status);
        Assert.Equal("PROG 200-19", Of(evs, "M|PRESS1|PROG200_19").Suggest[0].Key);
        Assert.Equal("INVALID", Of(evs, "ROW5").Status);

        var req = new ImportApplyRequest("x", null, new() { ["M|PRESS1|PROG 200-19"] = new() { ["STD MAN"] = "8" } }, new() { ["M|PRESS1|PROG200_19"] = "PROG 200-19" });
        evs = PpSetupImportService.EvalMachines(raws, new() { M1() }, req);
        var forms = evs.Where(e => e.Op != null).Select(e => (ProductionPlanService.MachineForm)e.Op).ToList();
        Assert.Equal(new[] { 8m, 9m }, forms.Select(f => f.Man));   // edit on the winning row · mapped row updates the existing machine (code kept)
        Assert.All(forms, f => Assert.Equal("PROG 200-19", f.Code));
        Assert.Equal(new[] { "M|PRESS1|PROG 200-19" }, PpSetupImportService.EvalMachines(raws, new() { M1() }, new("x", new() { "M|PRESS1|PROG200_19" }, null, null)).Where(e => e.Op != null).Select(e => e.Row.Key));
    }

    // ------------------------------------------------------------ settings
    [Fact]
    public void Settings_ShiftAndFactor()
    {
        var shifts = new List<PpShift> { new() { Id = 1, Name = "08:00-17:00", Hours = 8, Sort = 1 } };
        var settings = new Dictionary<string, decimal> { ["ManHourFactor"] = 1.023m, ["ManHourPerDay"] = 11m };
        var raws = new List<PpSetupImportService.Raw>
        {
            Raw(2, ("CODE", "C5"), ("VALUE", "9")), Raw(3, ("CODE", "P8"), ("VALUE", "1.023")), Raw(4, ("CODE", "P9"), ("VALUE", "99")), Raw(5, ("CODE", "C9"), ("VALUE", "1")),
        };
        var evs = PpSetupImportService.EvalSettings(raws, shifts, settings, null);
        Assert.Equal("CHANGED", Of(evs, "S|C5").Status);
        Assert.Equal("SAME", Of(evs, "S|P8").Status);
        Assert.Equal("INVALID", Of(evs, "S|P9").Status);   // > 24 h
        Assert.Equal("INVALID", Of(evs, "S|C9").Status);   // no such shift
    }

    // ------------------------------------------------------------ products
    private static PpSetupImportService.PartIndex Idx() => new(new[]
    {
        new PpSetupImportService.PartIndex.P(10, "A-001", "", "FG1"), new PpSetupImportService.PartIndex.P(11, "A-002", "B-002", "SUB1"),
        new PpSetupImportService.PartIndex.P(12, "A-003", "", "FG3"), new PpSetupImportService.PartIndex.P(13, "A-003", "", "FG3b"),
    }, (t, isB) => ImportReview.NormKey(t) == "A001" ? new() { new("A-001", "A-001 · name") } : new());

    private static PpPart Part(int id, int a, int? b, string proc, decimal tp) => new() { Id = id, MachineId = 1, PartAId = a, PartBId = b, Process = proc, Tp = tp, Col = 1, Ct = 10, Active = true, PartA = "A-001" };

    [Fact]
    public void Product_NewChangedSame_ByMachinePartAPartBProcess()
    {
        var raws = new List<PpSetupImportService.Raw>
        {
            Raw(2, ("DEPT", "PRESS1"), ("MACHINE CODE", "PROG 200-19"), ("PART A", "A-001"), ("PROCESS", "PI#1")),                                      // blank = keep -> SAME
            Raw(3, ("DEPT", "PRESS1"), ("MACHINE CODE", "PROG 200-19"), ("PART A", "a-002"), ("PART B", "B-002"), ("TOTAL PROCESS", "4"), ("PCS / STROKE", "2"), ("MC CT", "9")),   // NEW
            Raw(4, ("DEPT", "PRESS1"), ("MACHINE CODE", "PROG 200-19"), ("PART A", "A-001"), ("PROCESS", "PI#2"), ("TOTAL PROCESS", "3")),            // new process of same part but incomplete
        };
        var parts = new List<PpPart> { Part(100, 10, null, "PI#1", 2) };
        var evs = PpSetupImportService.EvalProducts(raws, new() { M1() }, parts, Idx(), null);
        Assert.Equal("SAME", evs[0].Row.Status);
        Assert.Equal("NEW", evs[1].Row.Status);
        Assert.Equal("INVALID", evs[2].Row.Status);   // Pcs./Stroke + CT required for a new product

        raws[0] = Raw(2, ("DEPT", "PRESS1"), ("MACHINE CODE", "PROG 200-19"), ("PART A", "A-001"), ("PROCESS", "PI#1"), ("TOTAL PROCESS", "5"));
        evs = PpSetupImportService.EvalProducts(new() { raws[0] }, new() { M1() }, parts, Idx(), Apply);
        Assert.Equal("CHANGED", evs[0].Row.Status);
        var f = (ProductionPlanService.PartForm)evs[0].Op;
        Assert.Equal((100, 5m), (f.Id, f.Tp));
    }

    [Fact]
    public void Product_UnknownOrAmbiguousPart_SimilarInvalid_AndMapResolves()
    {
        var raws = new List<PpSetupImportService.Raw>
        {
            Raw(2, ("DEPT", "PRESS1"), ("MACHINE CODE", "PROG 200-19"), ("PART A", "a001"), ("TOTAL PROCESS", "1"), ("PCS / STROKE", "1"), ("MC CT", "1")),   // NormKey A001 -> suggestion
            Raw(3, ("DEPT", "PRESS1"), ("MACHINE CODE", "PROG 200-19"), ("PART A", "A-003"), ("TOTAL PROCESS", "1"), ("PCS / STROKE", "1"), ("MC CT", "1")),  // two products share it
            Raw(4, ("DEPT", "PRESS1"), ("MACHINE CODE", "NOPE"), ("PART A", "A-001"), ("TOTAL PROCESS", "1"), ("PCS / STROKE", "1"), ("MC CT", "1")),         // no such machine
        };
        var evs = PpSetupImportService.EvalProducts(raws, new() { M1() }, new(), Idx(), null);
        Assert.Equal(new[] { "SIMILAR", "INVALID", "INVALID" }, evs.Select(e => e.Row.Status));
        Assert.Equal("A-001", evs[0].Row.Suggest[0].Key);
        var key = evs[0].Row.Key;
        var applied = PpSetupImportService.EvalProducts(raws, new() { M1() }, new(), Idx(), new("x", null, null, new() { [key] = "A-001" }));
        Assert.Equal("NEW", applied[0].Row.Status);
        Assert.Equal(10, ((ProductionPlanService.PartForm)applied[0].Op).PartAId);
    }

    [Fact]
    public void Product_DuplicateKey_BottomWins()
    {
        var cells = new[] { ("DEPT", "PRESS1"), ("MACHINE CODE", "PROG 200-19"), ("PART A", "A-001"), ("TOTAL PROCESS", "1"), ("PCS / STROKE", "1"), ("MC CT", "1") };
        var evs = PpSetupImportService.EvalProducts(new() { Raw(2, cells), Raw(3, cells) }, new() { M1() }, new(), Idx(), null);
        Assert.Equal(new[] { "DUPLICATE", "NEW" }, evs.Select(e => e.Row.Status));
    }
}
