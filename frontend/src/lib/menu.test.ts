import { describe, expect, it } from "vitest";
import { allowed, ROOT_MENU, SETUP_GROUPS } from "./menu";

const setupHrefs = (can: Record<string, boolean>) =>
  allowed(ROOT_MENU, can).flatMap((m) => m.children ?? []).flatMap((c) => c.children ?? []).map((i) => i.href);

describe("SETUP menu gate (level1)", () => {
  const all = SETUP_GROUPS.flatMap((g) => g.items.map(([slug]) => `/admin/setup/${slug}`));

  it("without level1 no SETUP item or SETUP group is shown, even with userMgmt", () => {
    const menu = allowed(ROOT_MENU, { userMgmt: true, level1: false });
    expect(setupHrefs({ userMgmt: true })).toEqual([]);
    expect(JSON.stringify(menu)).not.toContain("SYSTEM CONFIGURATION");
    expect(menu.flatMap((m) => m.children ?? []).map((c) => c.label)).toEqual(["USER ACCOUNTS", "ACCESS CONTROL"]);
  });

  it("with level1 every SETUP item is shown", () => {
    expect(setupHrefs({ userMgmt: true, level1: true })).toEqual(all);
  });

  it("level1 alone (no userMgmt) still shows SETUP but not USER ACCOUNTS / ACCESS CONTROL", () => {
    const kids = allowed(ROOT_MENU, { level1: true }).flatMap((m) => m.children ?? []).map((c) => c.label);
    expect(kids).not.toContain("USER ACCOUNTS");
    expect(setupHrefs({ level1: true })).toEqual(all);
  });

  it("neither flag hides the whole User Management group", () => {
    expect(allowed(ROOT_MENU, {}).some((m) => m.label === "User Management")).toBe(false);
  });
});
