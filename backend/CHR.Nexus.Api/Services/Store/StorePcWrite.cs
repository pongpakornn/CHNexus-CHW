using Microsoft.Data.SqlClient;
using System;

namespace Nexus.Services
{
    // STORE-FG (live view of StorePC .56): a scan updates StorePC.dbo.MST_PART + TRN_SCAN exactly like the StorePC .exe
    // (StorePC/Services/ScanService.cs UpdateStock / UpdateStockOut), inside the same transaction as the CHR-Nexus scan,
    // so both databases change together or not at all. Only MST_PART (QTY_STK / QTY_STKB) and TRN_SCAN (insert) are written.
    public static class StorePcWrite
    {
        // Before the CHR-Nexus write: lock the StorePC row and copy its balance into Nexus.PartStocks
        // (the .exe may have scanned since), so the OUT balance check and both balances start from StorePC.
        // Returns StorePC PT_ID. Throws when the part is not in StorePC (scan is refused, nothing written).
        public static int Begin(SqlConnection conn, SqlTransaction trans, int stkId, int partId)
        {
            using (var cmd = new SqlCommand(@"
                DECLARE @pt INT, @n INT, @q INT, @b INT;
                SELECT @n = COUNT(*), @pt = MIN(m.PT_ID)
                FROM StorePC.dbo.MST_PART m
                JOIN Nexus.Parts p ON p.PartID = @p
                WHERE m.IS_ACTIVE = 1
                  AND ISNULL(NULLIF(LTRIM(RTRIM(m.PT_CODE)), ''), '-') = p.PartCode COLLATE DATABASE_DEFAULT
                  AND ISNULL(LTRIM(RTRIM(m.PT_ACODE)), '') = ISNULL(p.PartA, '') COLLATE DATABASE_DEFAULT;
                IF @n > 1 SET @pt = -1;   -- two active StorePC rows for one product: refuse (which one to update is unknown)
                IF @pt > 0
                BEGIN
                    SELECT @q = ISNULL(QTY_STK, 0), @b = ISNULL(QTY_STKB, 0) FROM StorePC.dbo.MST_PART WITH (UPDLOCK, ROWLOCK) WHERE PT_ID = @pt;
                    IF EXISTS (SELECT 1 FROM Nexus.PartStocks WHERE StockID = @s AND PartID = @p)
                        UPDATE Nexus.PartStocks SET Quantity = @q, BoxQuantity = @b, UpdatedDate = GETDATE() WHERE StockID = @s AND PartID = @p;
                    ELSE
                        INSERT INTO Nexus.PartStocks (StockID, PartID, Quantity, BoxQuantity) VALUES (@s, @p, @q, @b);
                END
                SELECT @pt;", conn, trans))
            {
                cmd.Parameters.AddWithValue("@s", stkId);
                cmd.Parameters.AddWithValue("@p", partId);
                object r = cmd.ExecuteScalar();
                if (r == null || r == DBNull.Value) throw new InvalidOperationException("ไม่พบสินค้านี้ในฐาน StorePC (PD CODE + PART A ไม่ตรง)");
                if (Convert.ToInt32(r) < 0) throw new InvalidOperationException("สินค้านี้มีหลายแถวในฐาน StorePC (PD CODE + PART A ซ้ำ)");
                return Convert.ToInt32(r);
            }
        }

        // After the CHR-Nexus write: same change in StorePC (+/- pieces, +/- 1 box, one TRN_SCAN row)
        public static void Apply(SqlConnection conn, SqlTransaction trans, int ptId, decimal qty, bool isOut, int box, string userId, string partACode, string refNo)
        {
            int q = (int)Math.Round(qty, MidpointRounding.AwayFromZero);   // StorePC keeps whole pieces
            using (var cmd = new SqlCommand(isOut
                ? @"UPDATE StorePC.dbo.MST_PART SET QTY_STK = QTY_STK - @q, QTY_STKB = CASE WHEN ISNULL(QTY_STKB, 0) + @box < 0 THEN 0 ELSE ISNULL(QTY_STKB, 0) + @box END WHERE PT_ID = @pt;
                    INSERT INTO StorePC.dbo.TRN_SCAN (USR_ID, TX_QTY, TX_TYPE, TX_DATE, PT_ID, PT_ACODE, REF_NO) VALUES (CASE WHEN EXISTS (SELECT 1 FROM StorePC.dbo.MST_USER WHERE USR_ID = @u) THEN @u END, @q, 'OUT', GETDATE(), @pt, @a, @ref);"
                : @"UPDATE StorePC.dbo.MST_PART SET QTY_STK = ISNULL(QTY_STK, 0) + @q, QTY_STKB = CASE WHEN ISNULL(QTY_STKB, 0) + @box < 0 THEN 0 ELSE ISNULL(QTY_STKB, 0) + @box END WHERE PT_ID = @pt;
                    INSERT INTO StorePC.dbo.TRN_SCAN (USR_ID, TX_QTY, TX_TYPE, TX_DATE, PT_ID, PT_ACODE, REF_NO) VALUES (CASE WHEN EXISTS (SELECT 1 FROM StorePC.dbo.MST_USER WHERE USR_ID = @u) THEN @u END, @q, 'IN', GETDATE(), @pt, @a, @ref);", conn, trans))
            {
                cmd.Parameters.AddWithValue("@q", q);
                cmd.Parameters.AddWithValue("@box", box);   // same box move as the CHR-Nexus row (RETURN / remainder = 0)
                cmd.Parameters.AddWithValue("@pt", ptId);
                cmd.Parameters.AddWithValue("@u", (userId ?? "").Length > 20 ? userId.Substring(0, 20) : userId ?? "");
                cmd.Parameters.AddWithValue("@a", string.IsNullOrWhiteSpace(partACode) ? DBNull.Value : partACode.Trim().Length > 100 ? partACode.Trim().Substring(0, 100) : partACode.Trim());
                // TRN_SCAN.USR_ID has FK to StorePC MST_USER: a CHR-Nexus-only user is logged as NULL with the ID kept in REF_NO
                string r = $"[{userId}] {refNo}".Trim();
                cmd.Parameters.AddWithValue("@ref", r.Length > 200 ? r.Substring(0, 200) : r);
                cmd.ExecuteNonQuery();
            }
        }
    }
}
