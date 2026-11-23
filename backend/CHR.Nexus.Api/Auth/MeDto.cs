using Nexus.Models;

namespace CHR.Nexus.Api.Web.Auth;

// สิทธิ์ที่หน้าเว็บใช้ซ่อน / แสดงเมนูและปุ่ม (คำนวณจาก UserSession ตัวเดียวกับ WPF) - API ตรวจสิทธิ์ซ้ำทุกครั้งเสมอ
public sealed record MeDto(
    string UserId, string UserName, int UserLevel, bool IsMasterAdmin, string Department,
    Dictionary<string, bool> Can, List<PermDto> Permissions)
{
    public static MeDto From(UserSession s) => new(
        s.UserId, s.UserName, s.UserLevel, s.IsMasterAdmin, s.Department,
        new Dictionary<string, bool>
        {
            ["dashboard"] = s.CanViewDashboard,
            ["scanner"] = s.CanViewScannerMenu,
            ["scannerEdit"] = s.CanEditScanner,
            ["scannerDelete"] = s.CanDeleteScan,
            ["scannerApprove"] = s.CanApproveScan,
            ["productControl"] = s.CanViewProductControl,
            ["productAdd"] = s.CanAddProduct,
            ["productEdit"] = s.CanEditProduct,
            ["productDelete"] = s.CanDeleteProduct,
            ["masterData"] = s.CanViewMasterData,
            ["masterAdd"] = s.CanAddMasterData,
            ["masterEdit"] = s.CanEditMasterData,
            ["masterDelete"] = s.CanDeleteMasterData,
            ["edpSubmit"] = s.CanViewEdpSubmit,
            ["edpSubmitEdit"] = s.CanEditEdpSubmit,
            ["edpPlanning"] = s.CanViewEdpPlanning,
            ["edpPlanningEdit"] = s.CanEditEdpPlanning,
            ["edpSetting"] = s.CanViewEdpSetting,
            ["edpSettingAdd"] = s.CanAddEdpSetting,
            ["edpSettingEdit"] = s.CanEditEdpSetting,
            ["edpSettingDelete"] = s.CanDeleteEdpSetting,
            ["edpGraph"] = s.CanViewEdpGraph,
            ["ppDashboard"] = s.CanViewPpDashboard,
            ["ppCapacity"] = s.CanViewPpCapacity,
            ["ppCapacityEdit"] = s.CanEditPpCapacity,
            ["mfgKanban"] = s.CanViewKanban,
            ["PC_WOF"] = s.CanViewPcWof,   // PC DIGITAL WORKSPACE > WORK ORDER FOLLOW (frontend lib/menu.ts PC_PERM)
            ["ppSetup"] = s.CanViewPpSetup,
            ["ppSetupAdd"] = s.CanAddPpSetup,
            ["ppSetupEdit"] = s.CanEditPpSetup,
            ["ppSetupDelete"] = s.CanDeletePpSetup,
            ["chemRecord"] = s.CanViewChemRecord,
            ["chemRecordAdd"] = s.CanAddChemRecord,
            ["chemRecordEdit"] = s.CanEditChemRecord,
            ["chemSetup"] = s.CanViewChemSetup,
            ["layout"] = s.CanViewLayout,
            ["layoutAdd"] = s.CanAddLayout,
            ["layoutEdit"] = s.CanEditLayout,
            ["layoutDelete"] = s.CanDeleteLayout,
            ["pickList"] = s.CanViewPackingCard,
            ["pr"] = s.CanViewPR,
            ["prSubmit"] = s.CanSubmitPR,
            ["prEdit"] = s.CanEditPR,
            ["prDelete"] = s.CanDeletePR,
            ["prApprove"] = s.CanApprovePR,
            ["maxMinCalc"] = s.CanViewMaxMinCalc,
            ["maxMinCalcEdit"] = s.CanEditMaxMinCalc,
            ["forecast"] = s.CanViewForecastOrder,
            ["forecastImport"] = s.CanImportForecastOrder,
            ["activityLog"] = s.CanViewActivityLog,
            ["userMgmt"] = s.CanViewUserMgmt,
            ["userAdd"] = s.CanAddUser,
            ["userEdit"] = s.CanEditUser,
            ["userDelete"] = s.CanDeleteUser,
            ["userPerms"] = s.CanSetPermissions,
            ["store"] = s.CanViewStore,
            ["storeAdd"] = s.CanAddStore,
            ["storeEdit"] = s.CanEditStore,
            ["storeDelete"] = s.CanDeleteStore,
            ["admin"] = s.UserLevel == 1
        },
        s.Permissions.Select(p => new PermDto(p.SystemId, p.CanView, p.CanAdd, p.CanEdit, p.CanDelete, p.CanApprove)).ToList());
}

public sealed record PermDto(string SystemId, bool View, bool Add, bool Edit, bool Delete, bool Approve);
