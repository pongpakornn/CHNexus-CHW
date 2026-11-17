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

    [Fact]
    public void LockKey_IsPerUserAndIp() => Assert.NotEqual(LoginGuard.UserKey("a", "1.1.1.1"), LoginGuard.UserKey("a", "2.2.2.2"));

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
