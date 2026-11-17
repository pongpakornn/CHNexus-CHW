using CHR.Nexus.Api.Web;
using Xunit;

namespace CHR.Nexus.Api.Tests;

public class SecurityTests
{
    [Theory]
    [InlineData("1.2.3.4, 10.0.0.9", "10.0.0.9")]
    [InlineData("10.0.0.9", "10.0.0.9")]
    [InlineData("", null)]
    public void LastForwarded_TakesLastEntry(string xff, string want) => Assert.Equal(want, ClientIp.LastForwarded(xff));

    [Theory]
    [InlineData(1, 15)] [InlineData(2, 30)] [InlineData(3, 60)] [InlineData(4, 120)] [InlineData(8, 1440)] [InlineData(30, 1440)]
    public void LockMinutes_DoublesAndCapsAt24h(int n, int want) => Assert.Equal(want, LoginGuard.LockMinutes(n));

    [Fact]
    public void FiveFails_FromDifferentMachines_LockOnceAndNotifyOnce()
    {
        var hits = new List<(int fails, int count, int min)>();
        Action<string, string, int, int, int> keep = LoginGuard.OnLocked;
        LoginGuard.OnLocked = (u, ip, f, c, m) => { if (u == "t-lock") hits.Add((f, c, m)); };
        try
        {
            for (int i = 0; i < 5; i++) { Assert.Null(LoginGuard.Blocked("t-lock", "9.9.9." + i)); LoginGuard.Fail("t-lock", "9.9.9." + i); }
            Assert.Contains("15 นาที", LoginGuard.Blocked("t-lock", "1.1.1.1"));   // another machine is locked too
            Assert.Single(hits);
            Assert.Equal((5, 1, 15), hits[0]);
            Assert.Contains(LoginGuard.Active(), a => a.UserId == "t-lock" && a.LockCount == 1);
        }
        finally { LoginGuard.OnLocked = keep; LoginGuard.Reset("t-lock"); }
    }

    [Fact]
    public void Reset_ClearsLockAndEscalation()
    {
        for (int i = 0; i < 5; i++) LoginGuard.Fail("t-reset", "8.8.8.8");
        Assert.NotNull(LoginGuard.Blocked("t-reset", "7.7.7.7"));
        Assert.True(LoginGuard.Reset("t-reset"));
        Assert.Null(LoginGuard.Blocked("t-reset", "7.7.7.7"));
        Assert.DoesNotContain(LoginGuard.Active(), a => a.UserId == "t-reset");
        Assert.False(LoginGuard.Reset("t-reset"));
    }

    [Fact]
    public void Success_ResetsFailCount()
    {
        for (int i = 0; i < 4; i++) LoginGuard.Fail("t-ok", "6.6.6.6");
        LoginGuard.Success("t-ok", "6.6.6.6");
        LoginGuard.Fail("t-ok", "6.6.6.6");   // would be the 5th without the reset
        Assert.Null(LoginGuard.Blocked("t-ok", "5.5.5.5"));
    }

    [Fact]
    public void OriginOk_Rules()
    {
        Assert.True(ClientIp.OriginOk(null, "api:5000", null, null));
        Assert.True(ClientIp.OriginOk("http://localhost:3000", "localhost:3000", null, null));
        Assert.True(ClientIp.OriginOk("https://app.x.com", "127.0.0.1:5000", "app.x.com", null));
        Assert.True(ClientIp.OriginOk("http://a:3000", "b", null, new[] { "http://a:3000/" }));
        Assert.False(ClientIp.OriginOk("https://evil.com", "app.x.com", "app.x.com", null));
    }
}
