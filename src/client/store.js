/**
 * A tiny external store for the menu and the transient toast.
 *
 * The context-menu listener lives outside React, so it needs a place to
 * publish "open this menu" and the overlay needs to subscribe to it.
 */
export function createStore() {
  let state = { menu: null, notice: null, seq: 0 };
  const listeners = new Set();
  return {
    get: () => state,
    set(next) {
      state = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
