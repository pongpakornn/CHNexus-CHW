// Stack of open overlays (Modal / confirm Dialog): Esc / Enter act on the topmost one only,
// so closing a confirm box never closes the edit window behind it.
const stack: symbol[] = [];

/** Register an overlay as the newest one. Returns the id and a function that removes it. */
export function pushOverlay(): { id: symbol; pop: () => void } {
  const id = Symbol("overlay");
  stack.push(id);
  return {
    id,
    pop: () => {
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
    },
  };
}

export const isTopOverlay = (id: symbol) => stack[stack.length - 1] === id;
