using Nexus.Services;
using Xunit;

namespace CHR.Nexus.Api.Tests;

public class MinReportRulesTests
{
    private static readonly DateTime T = new(2026, 11, 18, 10, 0, 0);

    [Fact] public void Seen_recently_is_continuous() => Assert.True(MinReportService.Continuous(T.AddMinutes(-5), T));
    [Fact] public void Gap_over_one_hour_breaks_the_streak() => Assert.False(MinReportService.Continuous(T.AddHours(-2), T));
}
