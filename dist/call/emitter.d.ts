/** A small typed event emitter. Listener errors are caught so one bad handler cannot break the call. */
export declare class Emitter<E extends {
    [K in keyof E]: unknown;
}> {
    private handlers;
    /** Subscribe; returns a function that unsubscribes. */
    on<K extends keyof E>(event: K, fn: (payload: E[K]) => void): () => void;
    /** Subscribe for one event only. */
    once<K extends keyof E>(event: K, fn: (payload: E[K]) => void): () => void;
    off<K extends keyof E>(event: K, fn: (payload: E[K]) => void): void;
    protected emit<K extends keyof E>(event: K, payload: E[K]): void;
}
