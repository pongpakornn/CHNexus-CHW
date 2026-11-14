// Guard for a timer-driven poll: no overlapping requests, quiet retry with backoff while the server is
// unreachable, and only ONE error notice per outage (re-armed after the next success).
export function pollGuard() {
  let busy = false;
  let skip = 0;
  let fails = 0;
  let warned = false;
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
      fails++;
      skip = Math.min(fails, 8); // skip 1, 2, 3 ... 8 ticks before the next quiet retry
      const first = !warned;
      warned = true;
      return first;
    },
  };
}
