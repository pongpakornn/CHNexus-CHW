using System.Globalization;
using Nexus.Helpers;
using Xunit;

namespace CHR.Nexus.Api.Tests;

public class PackingCardBarcodeParserTests
{
    // Format: TicketNo | MaterialCode | WorkOrder | LotNo | JobName | Qty
    private const string Valid = "T001 | MAT-123 | WO9 | LOT7 | Job A | 250";

    [Fact]
    public void Valid_card_returns_code_and_qty()
    {
        Assert.True(PackingCardBarcodeParser.TryParse(Valid, out var code, out var qty));
        Assert.Equal("MAT-123", code);
        Assert.Equal(250m, qty);
    }

    [Fact]
    public void Segments_are_trimmed()
    {
        Assert.True(PackingCardBarcodeParser.TryParse("T |   MAT-1   | W | L | J |   12  ", out var code, out var qty));
        Assert.Equal("MAT-1", code);
        Assert.Equal(12m, qty);
    }

    [Fact]
    public void Decimal_qty_is_parsed()
    {
        Assert.True(PackingCardBarcodeParser.TryParse("T | M | W | L | J | 12.5", out _, out var qty));
        Assert.Equal(12.5m, qty);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\r\n")]
    public void Empty_or_blank_is_rejected(string raw)
    {
        Assert.False(PackingCardBarcodeParser.TryParse(raw, out var code, out var qty));
        Assert.Null(code);
        Assert.Equal(0m, qty);
    }

    [Theory]
    [InlineData("MAT-123")]
    [InlineData("T | M | W | L | J")]
    [InlineData("T | M | W | L | J | 1 | extra")]
    [InlineData("T|M|W|L|J|1")]
    public void Wrong_segment_count_or_separator_is_rejected(string raw)
    {
        Assert.False(PackingCardBarcodeParser.TryParse(raw, out _, out _));
    }

    [Fact]
    public void Empty_material_code_is_rejected()
    {
        Assert.False(PackingCardBarcodeParser.TryParse("T |   | W | L | J | 5", out var code, out _));
        Assert.Equal("", code);
    }

    [Theory]
    [InlineData("T | M | W | L | J | abc")]
    [InlineData("T | M | W | L | J |  ")]
    public void Non_numeric_qty_is_rejected(string raw)
    {
        Assert.False(PackingCardBarcodeParser.TryParse(raw, out _, out var qty));
        Assert.Equal(0m, qty);
    }

    [Fact]
    public void Trailing_scanner_newline_after_qty_is_tolerated()
    {
        // The last segment is Trim()med, so CR/LF from the scanner does not break parsing.
        Assert.True(PackingCardBarcodeParser.TryParse(Valid + "\r\n", out var code, out var qty));
        Assert.Equal("MAT-123", code);
        Assert.Equal(250m, qty);
    }

    [Fact]
    public void Thai_layout_text_is_not_converted_by_the_parser()
    {
        // The parser does not use ThaiKeyboard: Thai glyphs in the code are kept as-is.
        Assert.True(PackingCardBarcodeParser.TryParse("T | ๅ/-ภ | W | L | J | 5", out var code, out var qty));
        Assert.Equal("ๅ/-ภ", code);
        Assert.Equal(5m, qty);
    }

    [Fact]
    public void Qty_parse_uses_CurrentCulture_en_US_and_th_TH()
    {
        // SUSPECT: decimal.TryParse(string, out) uses CurrentCulture (not Invariant like Qty.TryParse),
        // so results on a comma-decimal machine culture would differ. Pinned here for en-US / th-TH only.
        var old = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("en-US");
            Assert.True(PackingCardBarcodeParser.TryParse("T | M | W | L | J | 1,234", out _, out var q1));
            Assert.Equal(1234m, q1);
            CultureInfo.CurrentCulture = new CultureInfo("th-TH");
            Assert.True(PackingCardBarcodeParser.TryParse("T | M | W | L | J | 12.5", out _, out var q2));
            Assert.Equal(12.5m, q2);
        }
        finally { CultureInfo.CurrentCulture = old; }
    }
}
