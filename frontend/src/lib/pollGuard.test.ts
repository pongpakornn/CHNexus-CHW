import { describe, expect, it } from "vitest";
import { pollGuard } from "@/lib/pollGuard";

describe("pollGuard (pure state machine, no timers needed)", () => {
  it("runs when idle; blocks while a request is in flight", () => {
    const g = pollGuard();
    expect(g.shouldRun()).toBe(true);
    g.begin();
    expect(g.shouldRun()).toBe(false);
    g.ok();
    expect(g.shouldRun()).toBe(true);
  });
  it("first failure of an outage reports true, later ones false", () => {
    const g = pollGuard();
    g.begin();
    expect(g.fail()).toBe(true);
    g.begin();
    expect(g.fail()).toBe(false);
  });
  it("backs off: skips 1 tick after 1st fail, 2 after 2nd", () => {
    const g = pollGuard();
    g.begin();
    g.fail();
    expect(g.shouldRun()).toBe(false);
    expect(g.shouldRun()).toBe(true);
    g.begin();
    g.fail();
    expect(g.shouldRun()).toBe(false);
    expect(g.shouldRun()).toBe(false);
    expect(g.shouldRun()).toBe(true);
  });
  it("backoff is capped at 2 skipped ticks (uncommitted pollGuard.ts edit; was 8 at HEAD)", () => {
    const g = pollGuard();
    for (let i = 0; i < 20; i++) {
      g.begin();
      g.fail();
    }
    let skipped = 0;
    while (!g.shouldRun()) skipped++;
    expect(skipped).toBe(2);
  });
  it("success resets backoff and re-arms the single error notice", () => {
    const g = pollGuard();
    g.begin();
    g.fail();
    g.begin();
    g.fail();
    g.ok();
    expect(g.shouldRun()).toBe(true);
    g.begin();
    expect(g.fail()).toBe(true);
  });
  it("fail releases the busy flag (after the skip ticks)", () => {
    const g = pollGuard();
    g.begin();
    g.fail();
    g.shouldRun();
    expect(g.shouldRun()).toBe(true);
  });
  it("guards are independent instances", () => {
    const a = pollGuard();
    const b = pollGuard();
    a.begin();
    expect(b.shouldRun()).toBe(true);
  });
});
