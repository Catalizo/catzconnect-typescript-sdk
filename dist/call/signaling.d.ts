import type { CallErrorEvent, CallPlatform, ClientMessage, HelloMessage, ServerMessage } from "./types";
/** 4008: rate limit / server overload — reconnect, but back off harder. */
export declare const OVERLOAD_CLOSE_CODE = 4008;
export declare function isAuthCloseCode(code: unknown): boolean;
export declare function isAuthErrorCode(code: unknown): boolean;
/** The `exp` (unix seconds) inside a `ct1.<payload>.<mac>` user token, or null. */
export declare function tokenExpiry(token: string): number | null;
/** Full-jitter exponential backoff: a delay in [d/2, d] where d = min(max, base·2^attempt). */
export declare function backoffDelay(attempt: number, random: () => number, base?: number, max?: number): number;
export interface SignalingHandlers {
    /** Every server frame except `ping` (answered here) and `hello` (see onOpen). */
    onMessage(msg: ServerMessage): void;
    /** A socket said hello. `reconnect` is false for the first one. Queued frames are flushed right after this returns. */
    onOpen(hello: HelloMessage, reconnect: boolean): void;
    /** The socket dropped and a reconnect is scheduled (`attempt` counts from 1). */
    onDown(attempt: number): void;
    /** No way to carry on (no usable token). The socket is closed for good. */
    onFatal(err: CallErrorEvent): void;
}
/**
 * One logical signaling connection over as many WebSockets as it takes:
 * reconnects with exponential backoff and jitter, fetches a fresh token when
 * the old one expires or is refused, answers pings, detects a dead socket
 * after 45 s of silence, and queues frames while it is down.
 */
export declare class Signaling {
    private url;
    private getToken;
    private p;
    private h;
    private ws;
    private token;
    private tokenStale;
    private attempt;
    private failuresBeforeHello;
    private everOpened;
    private open;
    private closed;
    private queue;
    private lastRx;
    private retryTimer;
    private watchdog;
    private firstConnect;
    constructor(url: string, token: string | undefined, getToken: (() => Promise<string>) | undefined, p: CallPlatform, h: SignalingHandlers);
    get isOpen(): boolean;
    /** Opens the first socket; resolves on the server's `hello`. Retries for up to 20 s. */
    connect(): Promise<HelloMessage>;
    /** Sends now when open; otherwise queues (unless `queue` is false, for stats and pongs). */
    send(msg: ClientMessage, queue?: boolean): boolean;
    /** Drops queued frames that `drop` matches (e.g. signals for a call being rejoined). */
    dropQueued(drop: (m: ClientMessage) => boolean): void;
    /** Skip the backoff and reconnect now (the network came back). */
    reconnectNow(): void;
    /** The server refused the token (an `error` frame): fetch a new one before the next attempt. */
    markTokenStale(): void;
    close(): void;
    private fatal;
    private ensureToken;
    private openSocket;
    private sendRaw;
    private flush;
    private startWatchdog;
    private scheduleReconnect;
}
