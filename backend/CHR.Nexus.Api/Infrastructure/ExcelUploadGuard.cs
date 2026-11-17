using System.Collections.Concurrent;
using System.IO.Compression;

namespace CHR.Nexus.Api.Web;

// Guards Excel uploads against zip bombs and parser overload (ClosedXML inflates the whole zip in memory).
public static class ExcelUploadGuard
{
    public const long MaxUncompressedBytes = 200L * 1024 * 1024;
    public const int MaxEntries = 10_000;

    /// <summary>Throws InvalidOperationException (Thai) unless the stream is a zip with sane total size / entry count.</summary>
    public static void ValidateZip(Stream s)
    {
        try
        {
            using var zip = new ZipArchive(s, ZipArchiveMode.Read, leaveOpen: true);
            if (zip.Entries.Count > MaxEntries) throw new InvalidOperationException("ไฟล์ Excel มีส่วนประกอบมากเกินไป");
            long total = 0;
            foreach (var e in zip.Entries)
            {
                total += e.Length;
                if (total > MaxUncompressedBytes) throw new InvalidOperationException("ไฟล์ Excel ขยายแล้วใหญ่เกินกำหนด (200 MB)");
            }
        }
        catch (InvalidDataException) { throw new InvalidOperationException("ไฟล์ไม่ใช่ Excel (.xlsx) ที่ถูกต้อง"); }
        finally { if (s.CanSeek) s.Position = 0; }
    }

    // max 4 imports parsing at once, server-wide. A slot is freed when the temp file is deleted, or after HoldFor
    // (preview uploads are kept for the confirm step and are never deleted right after parsing).
    private static readonly SemaphoreSlim Gate = new(4, 4);
    private static readonly ConcurrentDictionary<string, byte> Held = new();
    private static readonly TimeSpan HoldFor = TimeSpan.FromSeconds(20);   // parse of a normal file is a few seconds; a kept preview file frees its slot quickly

    public static async Task<string> AcquireAsync(string key = null)
    {
        if (!await Gate.WaitAsync(TimeSpan.FromSeconds(30)))
            throw new InvalidOperationException("ระบบกำลังนำเข้าไฟล์อื่นอยู่ กรุณาลองใหม่");
        key ??= Guid.NewGuid().ToString("N");
        Held[key] = 0;
        _ = Task.Delay(HoldFor).ContinueWith(_ => Release(key));
        return key;
    }

    public static void Release(string key)
    {
        if (!string.IsNullOrEmpty(key) && Held.TryRemove(key, out _)) Gate.Release();
    }
}
