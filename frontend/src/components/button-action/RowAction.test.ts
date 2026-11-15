import { describe, expect, it, vi } from "vitest";
import { RowAction } from "./RowAction";

// RowAction is a plain function component: call it and inspect the returned <button> element.
const btn = (p: Parameters<typeof RowAction>[0]) => RowAction(p) as unknown as { props: Record<string, unknown> };

describe("RowAction", () => {
  it("inactive: normal kind class, no pressed state", () => {
    const { props } = btn({ kind: "view", onClick: () => {} });
    expect(props.className).toContain("ra-view");
    expect(props["aria-label"]).toBe("VIEW");
  });

  it("active: becomes the red cancel X and clicking calls onClick", () => {
    const onClick = vi.fn();
    const stop = vi.fn();
    const { props } = btn({ kind: "edit", active: true, onClick });
    expect(props.className).toContain("ra-cancel");
    expect(props.className).not.toContain("ra-edit");
    expect(props["aria-label"]).toBe("CANCEL");
    expect(props["aria-pressed"]).toBe(true);
    (props.onClick as (e: { stopPropagation: () => void }) => void)({ stopPropagation: stop });
    expect(onClick).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalled();
  });
});
