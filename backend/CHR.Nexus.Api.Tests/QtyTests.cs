using System.Globalization;
using Nexus.Helpers;
using Xunit;

namespace CHR.Nexus.Api.Tests;

// Qty must never depend on the machine culture (a Thai server uses th-TH).
public class QtyTests
{
    public static IEnumerable<object[]> Cultures => new[] { new object[] { "en-US" }, new object[] { "th-TH" }, new object[] { "de-DE" } };

    private static void InCulture(string name, Action body)
    {
        var old = CultureInfo.CurrentCulture;
        var oldUi = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo(name);
            CultureInfo.CurrentUICulture = new CultureInfo(name);
            body();
        }
        finally
        {
            CultureInfo.CurrentCulture = old;
            CultureInfo.CurrentUICulture = oldUi;
        }
    }

    [Fact]
    public void Normalize_strips_trailing_zeros()
    {
        Assert.Equal("613", Qty.Normalize(613.000m).ToString(CultureInfo.InvariantCulture));
        Assert.Equal("12.5", Qty.Normalize(12.500m).ToString(CultureInfo.InvariantCulture));
        Assert.Equal("0", Qty.Normalize(0.000m).ToString(CultureInfo.InvariantCulture));
    }

    [Fact]
    public void Round_integer_vs_decimal_warehouse_uses_away_from_zero()
    {
        Assert.Equal(3m, Qty.Round(2.5m, false));
        Assert.Equal(-3m, Qty.Round(-2.5m, false));
        Assert.Equal(1.235m, Qty.Round(1.2345m, true));
        Assert.Equal(2m, Qty.Round(1.5m, false));
        Assert.Equal(1.5m, Qty.Round(1.5m, true));
    }

    [Theory, MemberData(nameof(Cultures))]
    public void Text_uses_invariant_separators_in_any_culture(string culture)
    {
        InCulture(culture, () =>
        {
            Assert.Equal("1,234", Qty.Text(1234m, false));
            Assert.Equal("1,235", Qty.Text(1234.5m, false));
            Assert.Equal("1,234.50", Qty.Text(1234.5m, true));
            Assert.Equal("1,234.568", Qty.Text(1234.5678m, true));
            Assert.Equal("0.00", Qty.Text(0m, true));
            Assert.Equal("1,234,567", Qty.Text(1234567m, false));
        });
    }

    [Theory, MemberData(nameof(Cultures))]
    public void Edit_has_no_thousand_separator_in_any_culture(string culture)
    {
        InCulture(culture, () =>
        {
            Assert.Equal("1234", Qty.Edit(1234m, false));
            Assert.Equal("1234.50", Qty.Edit(1234.5m, true));
            Assert.Equal("0.00", Qty.Edit(0m, true));
        });
    }

    [Theory, MemberData(nameof(Cultures))]
    public void Plain_drops_trailing_zeros_in_any_culture(string culture)
    {
        InCulture(culture, () =>
        {
            Assert.Equal("1,234.5", Qty.Plain(1234.500m));
            Assert.Equal("613", Qty.Plain(613.000m));
            Assert.Equal("0", Qty.Plain(0m));
            Assert.Equal("0.001", Qty.Plain(0.001m));
        });
    }

    [Fact]
    public void Text_object_overload_handles_null_and_DBNull()
    {
        Assert.Equal("-", Qty.Text((object)null, false));
        Assert.Equal("-", Qty.Text((object)DBNull.Value, false));
        Assert.Equal("n/a", Qty.Text((object)DBNull.Value, true, "n/a"));
        Assert.Equal("1,234.50", Qty.Text((object)1234.5m, true));
        Assert.Equal("7", Qty.Text((object)7, false));
    }

    [Theory, MemberData(nameof(Cultures))]
    public void TryParse_accepts_grouped_and_plain_numbers_in_any_culture(string culture)
    {
        InCulture(culture, () =>
        {
            Assert.True(Qty.TryParse("1,234.567", out var a));
            Assert.Equal(1234.567m, a);
            Assert.True(Qty.TryParse("1234.5", out var b));
            Assert.Equal(1234.5m, b);
            Assert.True(Qty.TryParse("  42 ", out var c));
            Assert.Equal(42m, c);
            Assert.True(Qty.TryParse("-3.5", out var d));
            Assert.Equal(-3.5m, d);
        });
    }

    [Theory, MemberData(nameof(Cultures))]
    public void TryParse_rejects_empty_null_and_garbage(string culture)
    {
        InCulture(culture, () =>
        {
            Assert.False(Qty.TryParse("", out var a));
            Assert.Equal(0m, a);
            Assert.False(Qty.TryParse(null, out _));
            Assert.False(Qty.TryParse("x", out _));
        });
    }

    [Fact]
    public void TryParse_malformed_1_2_3_depends_on_machine_culture()
    {
        // SUSPECT: Qty.TryParse falls back to CurrentCulture after the invariant attempt fails, so
        // "1.2.3" is rejected under en-US / th-TH but accepted as 123 under de-DE ('.' = group separator).
        InCulture("en-US", () => Assert.False(Qty.TryParse("1.2.3", out _)));
        InCulture("th-TH", () => Assert.False(Qty.TryParse("1.2.3", out _)));
        InCulture("de-DE", () =>
        {
            Assert.True(Qty.TryParse("1.2.3", out var v));
            Assert.Equal(123m, v);
        });
    }

    [Fact]
    public void Read_and_ReadNullable_handle_null_and_DBNull()
    {
        Assert.Equal(0m, Qty.Read(null));
        Assert.Equal(0m, Qty.Read(DBNull.Value));
        Assert.Null(Qty.ReadNullable(null));
        Assert.Null(Qty.ReadNullable(DBNull.Value));
        Assert.Equal(1.5m, Qty.ReadNullable(1.500m));
        Assert.Equal("613", Qty.Read(613.000m).ToString(CultureInfo.InvariantCulture));
        Assert.Equal(5m, Qty.Read(5));
    }

    [Theory, MemberData(nameof(Cultures))]
    public void Read_converts_with_invariant_culture(string culture)
    {
        InCulture(culture, () => Assert.Equal(1234.5m, Qty.Read("1234.5")));
    }
}
