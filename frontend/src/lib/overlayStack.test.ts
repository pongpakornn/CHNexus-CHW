import { describe, expect, it } from "vitest";
import { isTopOverlay, pushOverlay } from "@/lib/overlayStack";

describe("overlayStack", () => {
  it("last pushed overlay is the topmost", () => {
    const a = pushOverlay();
    const b = pushOverlay();
    expect(isTopOverlay(a.id)).toBe(false);
    expect(isTopOverlay(b.id)).toBe(true);
    b.pop();
    a.pop();
  });
  it("popping the top hands top back to the one below", () => {
    const a = pushOverlay();
    const b = pushOverlay();
    b.pop();
    expect(isTopOverlay(a.id)).toBe(true);
    expect(isTopOverlay(b.id)).toBe(false);
    a.pop();
  });
  it("popping a non-top overlay keeps the top unchanged", () => {
    const a = pushOverlay();
    const b = pushOverlay();
    a.pop();
    expect(isTopOverlay(b.id)).toBe(true);
    b.pop();
  });
  it("pop is idempotent and does not remove other overlays", () => {
    const a = pushOverlay();
    const b = pushOverlay();
    b.pop();
    b.pop();
    expect(isTopOverlay(a.id)).toBe(true);
    a.pop();
  });
  it("after everything is popped nothing is top", () => {
    const a = pushOverlay();
    a.pop();
    expect(isTopOverlay(a.id)).toBe(false);
    expect(isTopOverlay(Symbol("never pushed"))).toBe(false);
  });
  it("each push gets a unique id", () => {
    const a = pushOverlay();
    const b = pushOverlay();
    expect(a.id).not.toBe(b.id);
    b.pop();
    a.pop();
  });
});
