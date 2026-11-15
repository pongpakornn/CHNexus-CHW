using System.Text.RegularExpressions;

namespace Nexus.Services;

// Shared import review contract (PLAN.md "Shared import contract"): preview -> review in UI -> apply.
public sealed record ImportField(string Name, string Old, string New, bool Edit = false);
public sealed record ImportSuggest(string Key, string Label);
public sealed record ImportRowDto(string Key, string Status, string Label, string Sub, List<ImportField> Fields, string Note, List<ImportSuggest> Suggest);
public sealed record ImportErrorDto(string Cell, string Text);
public sealed record ImportPreviewDto(string Id, string File, string Title, List<ImportRowDto> Rows, List<ImportErrorDto> Errors);
// exclude = keys skipped; edits[key][field] = user-typed value; map[key] = existing key chosen for a SIMILAR row
public sealed record ImportApplyRequest(string Id, List<string> Exclude, Dictionary<string, Dictionary<string, string>> Edits, Dictionary<string, string> Map);

public static class ImportReview
{
    public const string New = "NEW", Changed = "CHANGED", Same = "SAME", Duplicate = "DUPLICATE", Similar = "SIMILAR", Invalid = "INVALID";

    // Near-match key: trim, case-insensitive, ignore space - _ .
    public static string NormKey(string s) => Regex.Replace(s ?? "", @"[\s\-_.]+", "").ToUpperInvariant();

    // old == null -> NEW; equal -> SAME; else CHANGED (blank new = keep, caller decides before calling)
    public static string Status(string old, string @new) => old == null ? New : old == @new ? Same : Changed;
}
