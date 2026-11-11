using ClosedXML.Excel;

namespace Nexus.Services;

// 🧪 CHEMICAL CONTROL · Export Excel ใบบันทึกผลการตรวจวัดประจำเดือน (1 ไฟล์ = 1 พารามิเตอร์)
//   ชีท RECORD : หัวเอกสาร (ชื่อ · มาตรฐาน · ขีดจำกัด · เลขที่แบบฟอร์ม) + ตารางรายวัน (กะกลางวัน / กลางคืน ทุกครั้ง) + สรุปสถิติ + ช่องลงนาม
//   ชีท CORRECTIVE ACTION : บันทึกการแก้ไขและปรับค่าน้ำยา
public static class ChemExcel
{
    public static byte[] Build(ChemParam p, int year, int month, List<ChemReading> rs, List<ChemAction> acts, ChemSheet sheet, List<ChemSign> signs, List<MinFlowSlot> flow, Dictionary<string, string> names)
    {
        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("RECORD");
        var dayT = ChemControlService.Times(p.DayTimes);
        var nightT = p.Shifts == "D" ? new List<string>() : ChemControlService.Times(p.NightTimes);
        int nd = DateTime.DaysInMonth(year, month);
        string fmt = p.Decimals <= 0 ? "0" : "0." + new string('0', p.Decimals);
        int cols = 1 + dayT.Count + nightT.Count + 1;
        var navy = XLColor.FromHtml("#312E81");
        var dark = XLColor.FromHtml("#3F3F46");

        ws.Cell(1, 1).Value = "CH RADIATORS CO., LTD. · CHEMICAL CONTROL";
        ws.Cell(1, 1).Style.Font.SetBold().Font.SetFontSize(10).Font.SetFontColor(XLColor.FromHtml("#6B7280"));
        ws.Cell(2, 1).Value = $"บันทึกผลการตรวจวัดค่าน้ำยาเคมี · {p.Name}";
        ws.Cell(2, 1).Style.Font.SetBold().Font.SetFontSize(15).Font.SetFontColor(navy);
        ws.Cell(3, 1).Value = $"{p.NameTh} · {p.Process} · {p.Line}";
        ws.Cell(4, 1).Value = $"ประจำเดือน {new DateTime(year, month, 1):MMMM yyyy}   ·   เลขที่แบบฟอร์ม {p.FormNo}   ·   รหัส {p.Code}";
        string spec = p.SpecMin != null && p.SpecMax != null ? $"{p.SpecMin:0.####} – {p.SpecMax:0.####}" : p.SpecMax != null ? $"≤ {p.SpecMax:0.####}" : $"≥ {p.SpecMin:0.####}";
        ws.Cell(5, 1).Value = $"มาตรฐาน (Spec) {spec} {p.Unit}   ·   UCL {p.Ucl?.ToString("0.####") ?? "-"}   ·   LCL {p.Lcl?.ToString("0.####") ?? "-"}   ·   Target {p.Target?.ToString("0.####") ?? "-"}   ·   วิธีตรวจวัด: {p.Method}";
        ws.Range(5, 1, 5, Math.Max(cols, 8)).Style.Font.SetFontSize(10);

        int r0 = 7;
        ws.Cell(r0, 1).Value = "DATE";
        int c = 2;
        foreach (var t in dayT) ws.Cell(r0, c++).Value = $"DAY {t}";
        foreach (var t in nightT) ws.Cell(r0, c++).Value = $"NIGHT {t}";
        ws.Cell(r0, c).Value = "INSPECTOR";
        var head = ws.Range(r0, 1, r0, cols);
        head.Style.Fill.SetBackgroundColor(dark).Font.SetFontColor(XLColor.White).Font.SetBold().Alignment.SetHorizontal(XLAlignmentHorizontalValues.Center);

        var map = rs.ToDictionary(x => (x.Date.Day, x.Shift, x.Slot));
        var vals = new List<decimal>();
        for (int d = 1; d <= nd; d++)
        {
            int r = r0 + d;
            var date = new DateTime(year, month, d);
            ws.Cell(r, 1).Value = date.ToString("dd/MM/yyyy ddd");
            c = 2;
            var who = new HashSet<string>();
            void Put(string sh, int slot)
            {
                if (map.TryGetValue((d, sh, slot), out var x))
                {
                    var cell = ws.Cell(r, c);
                    cell.Value = x.Value;
                    cell.Style.NumberFormat.Format = fmt;
                    vals.Add(x.Value);
                    bool outSpec = (p.SpecMin != null && x.Value < p.SpecMin) || (p.SpecMax != null && x.Value > p.SpecMax);
                    bool outCtl = (p.Lcl != null && x.Value < p.Lcl) || (p.Ucl != null && x.Value > p.Ucl);
                    if (outSpec) cell.Style.Fill.SetBackgroundColor(XLColor.FromHtml("#FEE2E2")).Font.SetFontColor(XLColor.FromHtml("#B91C1C")).Font.SetBold();
                    else if (outCtl) cell.Style.Fill.SetBackgroundColor(XLColor.FromHtml("#FEF3C7")).Font.SetFontColor(XLColor.FromHtml("#92400E"));
                    if (!string.IsNullOrWhiteSpace(x.Inspector)) who.Add(x.Inspector);
                }
                c++;
            }
            for (int i = 1; i <= dayT.Count; i++) Put("D", i);
            for (int i = 1; i <= nightT.Count; i++) Put("N", i);
            ws.Cell(r, c).Value = string.Join(", ", who);
            if (date.DayOfWeek == DayOfWeek.Sunday) ws.Range(r, 1, r, cols).Style.Fill.SetBackgroundColor(XLColor.FromHtml("#FFF7ED"));
        }
        var body = ws.Range(r0, 1, r0 + nd, cols);
        body.Style.Border.SetOutsideBorder(XLBorderStyleValues.Thin).Border.SetInsideBorder(XLBorderStyleValues.Hair);
        ws.Range(r0 + 1, 2, r0 + nd, cols - 1).Style.Alignment.SetHorizontal(XLAlignmentHorizontalValues.Center);

        // สรุปสถิติ
        int rs0 = r0 + nd + 2;
        double mean = vals.Count > 0 ? (double)vals.Average() : 0;
        double sd = vals.Count > 1 ? Math.Sqrt(vals.Sum(v => Math.Pow((double)v - mean, 2)) / (vals.Count - 1)) : 0;
        double? cpk = null;
        if (sd > 0)
        {
            var a = new List<double>();
            if (p.SpecMax != null) a.Add(((double)p.SpecMax - mean) / (3 * sd));
            if (p.SpecMin != null) a.Add((mean - (double)p.SpecMin) / (3 * sd));
            cpk = a.Count > 0 ? a.Min() : null;
        }
        int outN = vals.Count(v => (p.SpecMin != null && v < p.SpecMin) || (p.SpecMax != null && v > p.SpecMax));
        var stats = new (string, object)[]
        {
            ("จำนวนครั้งที่ตรวจวัด (n)", vals.Count), ("ค่าเฉลี่ย (Mean)", Math.Round(mean, 4)), ("ส่วนเบี่ยงเบนมาตรฐาน (σ)", Math.Round(sd, 4)),
            ("ค่าต่ำสุด", vals.Count > 0 ? vals.Min() : 0), ("ค่าสูงสุด", vals.Count > 0 ? vals.Max() : 0), ("Cpk", cpk == null ? "-" : Math.Round(cpk.Value, 2)), ("นอกข้อกำหนด (ครั้ง)", outN)
        };
        ws.Cell(rs0, 1).Value = "สรุปผล (SUMMARY)";
        ws.Cell(rs0, 1).Style.Font.SetBold().Font.SetFontColor(navy);
        for (int i = 0; i < stats.Length; i++)
        {
            ws.Cell(rs0 + 1 + i, 1).Value = stats[i].Item1;
            ws.Cell(rs0 + 1 + i, 2).Value = XLCellValue.FromObject(stats[i].Item2);
            ws.Cell(rs0 + 1 + i, 2).Style.Font.SetBold();
        }

        // ช่องลงนาม
        int rg = rs0 + stats.Length + 3;
        ws.Cell(rg - 1, 1).Value = $"สถานะเอกสาร: {(sheet?.Status ?? "DRAFT")}";
        ws.Cell(rg - 1, 1).Style.Font.SetBold();
        int col = 1;
        foreach (var f in flow.Where(x => x.Active))
        {
            var sg = signs.FirstOrDefault(x => x.Slot == f.Slot);
            ws.Cell(rg, col).Value = ChemControlService.SlotName(f.Slot);
            ws.Cell(rg, col).Style.Fill.SetBackgroundColor(dark).Font.SetFontColor(XLColor.White).Font.SetBold();
            ws.Cell(rg + 1, col).Value = sg == null ? "(รอลงนาม)" : (string.IsNullOrWhiteSpace(sg.UserName) ? sg.UserId : sg.UserName);
            ws.Cell(rg + 2, col).Value = sg == null ? "" : sg.SignedAt.ToString("dd/MM/yyyy HH:mm");
            ws.Range(rg, col, rg + 2, col).Style.Border.SetOutsideBorder(XLBorderStyleValues.Thin);
            col++;
        }
        ws.Columns(1, Math.Max(cols, 6)).AdjustToContents(r0, r0 + nd + 20);
        ws.Column(1).Width = Math.Max(ws.Column(1).Width, 22);
        ws.SheetView.FreezeRows(r0);
        ws.PageSetup.SetPageOrientation(XLPageOrientation.Portrait).SetPaperSize(XLPaperSize.A4Paper);
        ws.PageSetup.FitToPages(1, 0);

        // ชีทบันทึกการแก้ไข
        var wa = wb.AddWorksheet("CORRECTIVE ACTION");
        string[] h = { "NO.", "DATE", "CHECK TIME", "PROBLEM", "VALUE BEFORE", "VALUE AFTER", "CORRECTION (CHEMICAL ADDED)", "ADJUST TIME", "RESPONSIBLE" };
        for (int i = 0; i < h.Length; i++) wa.Cell(1, i + 1).Value = h[i];
        wa.Range(1, 1, 1, h.Length).Style.Fill.SetBackgroundColor(dark).Font.SetFontColor(XLColor.White).Font.SetBold();
        for (int i = 0; i < acts.Count; i++)
        {
            var a = acts[i];
            int r = i + 2;
            wa.Cell(r, 1).Value = i + 1;
            wa.Cell(r, 2).Value = a.Date;
            wa.Cell(r, 2).Style.DateFormat.Format = "dd/MM/yyyy";
            wa.Cell(r, 3).Value = a.CheckTime;
            wa.Cell(r, 4).Value = a.Problem;
            if (a.Before != null) wa.Cell(r, 5).Value = a.Before.Value;
            if (a.After != null) wa.Cell(r, 6).Value = a.After.Value;
            wa.Cell(r, 7).Value = a.Correction;
            wa.Cell(r, 8).Value = a.AdjustTime;
            wa.Cell(r, 9).Value = a.Responsible;
        }
        wa.Range(1, 1, Math.Max(2, acts.Count + 1), h.Length).Style.Border.SetOutsideBorder(XLBorderStyleValues.Thin).Border.SetInsideBorder(XLBorderStyleValues.Hair);
        wa.Columns().AdjustToContents();

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }
}
