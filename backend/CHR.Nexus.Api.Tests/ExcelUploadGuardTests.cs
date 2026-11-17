using System.IO.Compression;
using CHR.Nexus.Api.Web;
using Xunit;

namespace CHR.Nexus.Api.Tests;

public class ExcelUploadGuardTests
{
    private static MemoryStream Zip(int entries, int bytesEach)
    {
        var ms = new MemoryStream();
        using (var z = new ZipArchive(ms, ZipArchiveMode.Create, true))
            for (int i = 0; i < entries; i++) { using var w = z.CreateEntry("e" + i).Open(); w.Write(new byte[bytesEach]); }
        ms.Position = 0;
        return ms;
    }

    [Fact] public void Small_zip_ok() => ExcelUploadGuard.ValidateZip(Zip(3, 100));
    [Fact] public void Not_a_zip_rejected() => Assert.Throws<InvalidOperationException>(() => ExcelUploadGuard.ValidateZip(new MemoryStream(new byte[100])));
    [Fact] public void Too_many_entries_rejected() => Assert.Throws<InvalidOperationException>(() => ExcelUploadGuard.ValidateZip(Zip(ExcelUploadGuard.MaxEntries + 1, 1)));
    [Fact] public void Huge_uncompressed_rejected() => Assert.Throws<InvalidOperationException>(() => ExcelUploadGuard.ValidateZip(Zip(1, 201 * 1024 * 1024)));
}
