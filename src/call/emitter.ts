/** A small typed event emitter. Listener errors are caught so one bad handler cannot break the call. */
export class Emitter<E extends { [K in keyof E]: unknown }> {
  private handlers = new Map<keyof E, Set<(payload: any) => void>>();

  /** Subscribe; returns a function that unsubscribes. */
  on<K extends keyof E>(event: K, fn: (payload: E[K]) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(fn);
    return () => this.off(event, fn);
  }

  /** Subscribe for one event only. */
  once<K extends keyof E>(event: K, fn: (payload: E[K]) => void): () => void {
    const off = this.on(event, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof E>(event: K, fn: (payload: E[K]) => void): void {
    this.handlers.get(event)?.delete(fn);
  }

  protected emit<K extends keyof E>(event: K, payload: E[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        // A listener threw; keep the call running.
        if (typeof console !== "undefined") console.error(`[catzconnect/call] '${String(event)}' listener failed`, err);
      }
    }
  }
}
