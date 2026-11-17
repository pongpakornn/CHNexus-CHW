using Nexus.Services;
using Xunit;

namespace CHR.Nexus.Api.Tests;

public class WorkOrderFollowRulesTests
{
    [Theory]
    [InlineData("DEL", 1, 31, 31, true)]
    [InlineData("PROD_N", 29, 5, 28, false)]   // day beyond Feb
    [InlineData("XX", 1, 1, 31, false)]
    [InlineData("OR", 0, 1, 31, false)]
    [InlineData("WO", 5, -1, 31, false)]       // negative qty
    public void CheckCell(string row, int day, decimal qty, int days, bool ok) =>
        Assert.Equal(ok, WorkOrderFollowRules.CheckCell(row, day, qty, days) == null);

    [Fact]
    public void NullQtyClearsAndIsValid() => Assert.Null(WorkOrderFollowRules.CheckCell("PL", 3, null, 30));

    [Fact]
    public void BoxesAndPack()
    {
        Assert.Equal(2.5m, WorkOrderFollowRules.Boxes(500, 200));
        Assert.Null(WorkOrderFollowRules.Boxes(500, 0));
        Assert.Null(WorkOrderFollowRules.Boxes(null, 200));
        Assert.Equal(1200, WorkOrderFollowRules.ParsePack("1,200"));
        Assert.Null(WorkOrderFollowRules.ParsePack("abc"));
        Assert.Equal(6m, WorkOrderFollowRules.Total(new[] { 1m, 2m, 3m }));
    }

    [Fact]
    public void Month()
    {
        Assert.True(WorkOrderFollowRules.TryMonth("2026-11", out var m));
        Assert.Equal(new DateTime(2026, 11, 1), m);
        Assert.False(WorkOrderFollowRules.TryMonth("2026-13", out _));
    }
}
