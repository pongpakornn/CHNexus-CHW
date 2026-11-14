// Guard for a timer-driven poll: no overlapping requests, quiet retry with backoff while the server is
// unreachable, and only ONE error notice per outage (re-armed after the next success).
export function pollGuard() {
  let busy = false;
  let skip = 0;
  let fails = 0;
  let warned = false;
  // back in the window / tab: retry at the next tick (chat recovers within seconds once the server is back).
  // Listeners are added only on the first failure (so a throw-away instance costs nothing) and live as long as the page.
  let armed = false;
  const arm = () => {
    if (armed || typeof window === "undefined") return;
    armed = true;
    const wake = () => {
      if (document.visibilityState === "visible") skip = 0;
    };
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
  };
  return {
    /** Timer tick: true = go ahead. */
    shouldRun() {
      if (busy) return false;
      if (skip > 0) {
        skip--;
        return false;
      }
      return true;
    },
    begin() {
      busy = true;
    },
    ok() {
      busy = false;
      fails = 0;
      skip = 0;
      warned = false;
    },
    /** Returns true only for the first failure of an outage (show the notice then). */
    fail() {
      busy = false;
      arm();
      fails++;
      skip = Math.min(fails, 2); // skip 1, then 2 ticks between quiet retries
      const first = !warned;
      warned = true;
      return first;
    },
  };
}
