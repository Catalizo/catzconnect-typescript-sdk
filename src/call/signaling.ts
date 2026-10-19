import type { CallErrorEvent, CallPlatform, ClientMessage, HelloMessage, ServerMessage } from "./types";

/**
 * Close codes and error codes that mean "this token is no good any more".
 * The server closes with 4401 (token refused / API key revoked or lost the
 * Calls channel) or 4403 (forbidden, e.g. the organization was deleted).
 * 1008 is a generic policy close and is NOT an auth failure.
 */
const AUTH_CLOSE_CODES = new Set([4401, 4403]);
/** 4008: rate limit / server overload — reconnect, but back off harder. */
export const OVERLOAD_CLOSE_CODE = 4008;
const AUTH_ERROR_CODES = new Set(["unauthorized", "invalid_token", "token_expired", "token_revoked"]);

export function isAuthCloseCode(code: unknown): boolean {
  return typeof code === "number" && AUTH_CLOSE_CODES.has(code);
}

const SILENCE_MS = 45_000; // the server pings every 15 s; 45 s without a frame means the socket is dead
const MAX_BACKOFF_MS = 15_000;
const BASE_BACKOFF_MS = 500;
const MAX_QUEUE = 500;
const FIRST_CONNECT_TIMEOUT_MS = 20_000;

export function isAuthErrorCode(code: unknown): boolean {
  return typeof code === "string" && AUTH_ERROR_CODES.has(code.toLowerCase());
}

/** The `exp` (unix seconds) inside a `ct1.<payload>.<mac>` user token, or null. */
export function tokenExpiry(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "ct1") return null;
  try {
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const json = JSON.parse(new TextDecoder().decode(bytes));
    return typeof json.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
}

/** Full-jitter exponential backoff: a delay in [d/2, d] where d = min(max, base·2^attempt). */
export function backoffDelay(attempt: number, random: () => number, base = BASE_BACKOFF_MS, max = MAX_BACKOFF_MS): number {
  const d = Math.min(max, base * Math.pow(2, Math.max(0, attempt)));
  return Math.round(d / 2 + (random() * d) / 2);
}

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
export class Signaling {
  private ws: WebSocket | null = null;
  private token: string | undefined;
  private tokenStale = false;
  private attempt = 0;
  private failuresBeforeHello = 0;
  private everOpened = false;
  private open = false;
  private closed = false;
  private queue: ClientMessage[] = [];
  private lastRx = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private firstConnect: { resolve: (h: HelloMessage) => void; reject: (e: Error) => void; timer: any } | null = null;

  constructor(
    private url: string,
    token: string | undefined,
    private getToken: (() => Promise<string>) | undefined,
    private p: CallPlatform,
    private h: SignalingHandlers,
  ) {
    this.token = token;
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Opens the first socket; resolves on the server's `hello`. Retries for up to 20 s. */
  connect(): Promise<HelloMessage> {
    if (this.closed) return Promise.reject(new Error("The call client is closed"));
    return new Promise((resolve, reject) => {
      const timer = this.p.setTimeout(() => {
        if (!this.firstConnect) return;
        this.firstConnect = null;
        this.close();
        reject(new Error("Could not reach the signaling server"));
      }, FIRST_CONNECT_TIMEOUT_MS);
      this.firstConnect = { resolve, reject, timer };
      void this.openSocket();
    });
  }

  /** Sends now when open; otherwise queues (unless `queue` is false, for stats and pongs). */
  send(msg: ClientMessage, queue = true): boolean {
    if (this.open && this.ws) {
      try {
        this.ws.send(JSON.stringify(msg));
        return true;
      } catch {
        // fall through to the queue; the close handler reconnects
      }
    }
    if (queue && !this.closed) {
      this.queue.push(msg);
      if (this.queue.length > MAX_QUEUE) this.queue.shift();
    }
    return false;
  }

  /** Drops queued frames that `drop` matches (e.g. signals for a call being rejoined). */
  dropQueued(drop: (m: ClientMessage) => boolean): void {
    this.queue = this.queue.filter((m) => !drop(m));
  }

  /** Skip the backoff and reconnect now (the network came back). */
  reconnectNow(): void {
    if (this.closed || this.open || !this.retryTimer) return;
    this.p.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.openSocket();
  }

  /** The server refused the token (an `error` frame): fetch a new one before the next attempt. */
  markTokenStale(): void {
    this.tokenStale = true;
  }

  close(): void {
    this.closed = true;
    this.open = false;
    this.queue = [];
    if (this.retryTimer) this.p.clearTimeout(this.retryTimer);
    if (this.watchdog) this.p.clearInterval(this.watchdog);
    this.retryTimer = null;
    this.watchdog = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close(1000, "client closed");
      } catch {
        // already closing
      }
    }
    if (this.firstConnect) {
      this.p.clearTimeout(this.firstConnect.timer);
      this.firstConnect.reject(new Error("The call client is closed"));
      this.firstConnect = null;
    }
  }

  private fatal(code: string, message: string): void {
    const fc = this.firstConnect;
    this.firstConnect = null;
    if (fc) this.p.clearTimeout(fc.timer);
    this.close();
    if (fc) fc.reject(new Error(message));
    this.h.onFatal({ code, message });
  }

  private async ensureToken(): Promise<string | null> {
    const exp = this.token ? tokenExpiry(this.token) : null;
    const nowS = this.p.now() / 1000;
    const expiringSoon = exp !== null && exp - nowS < 30;
    const needNew = !this.token || this.tokenStale || expiringSoon || this.failuresBeforeHello >= 2;

    if (needNew && this.getToken) {
      try {
        const t = await this.getToken();
        if (typeof t !== "string" || t === "") throw new Error("getToken() returned no token");
        this.token = t;
        this.tokenStale = false;
        this.failuresBeforeHello = 0;
      } catch (err) {
        // Treated like a network failure: try again with backoff.
        this.h.onMessage({ t: "error", code: "token_fetch_failed", message: (err as Error)?.message ?? String(err) });
        return null;
      }
    } else if (!this.token) {
      this.fatal("no_token", "Pass a token or getToken to CatzCallClient");
      return null;
    } else if (this.tokenStale || (exp !== null && exp <= nowS)) {
      this.fatal("token_expired", "The call token expired or was refused; pass getToken to renew it automatically");
      return null;
    }
    return this.token ?? null;
  }

  private async openSocket(): Promise<void> {
    if (this.closed) return;
    const token = await this.ensureToken();
    if (this.closed) return;
    if (token === null) {
      this.scheduleReconnect();
      return;
    }

    let ws: WebSocket;
    try {
      const sep = this.url.includes("?") ? "&" : "?";
      ws = new this.p.WebSocket(`${this.url}${sep}token=${encodeURIComponent(token)}`);
    } catch (err) {
      this.h.onMessage({ t: "error", code: "signaling_failed", message: (err as Error)?.message ?? String(err) });
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    let saidHello = false;
    this.lastRx = this.p.now();

    ws.onmessage = (ev: MessageEvent) => {
      if (this.ws !== ws) return;
      this.lastRx = this.p.now();
      let msg: ServerMessage;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object" || typeof (msg as any).t !== "string") return;

      if (msg.t === "ping") {
        this.sendRaw(ws, { t: "pong", ts: msg.ts });
        return;
      }
      if (msg.t === "hello") {
        saidHello = true;
        const reconnect = this.everOpened;
        this.everOpened = true;
        this.open = true;
        this.attempt = 0;
        this.failuresBeforeHello = 0;
        this.startWatchdog();
        const fc = this.firstConnect;
        this.firstConnect = null;
        if (fc) this.p.clearTimeout(fc.timer);
        this.h.onOpen(msg, reconnect);
        this.flush();
        if (fc) fc.resolve(msg);
        return;
      }
      if (msg.t === "error" && isAuthErrorCode(msg.code) && !msg.call_id) {
        this.tokenStale = true;
      }
      this.h.onMessage(msg);
    };

    ws.onclose = (ev: CloseEvent) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.open = false;
      if (this.watchdog) this.p.clearInterval(this.watchdog);
      this.watchdog = null;
      if (this.closed) return;
      if (!saidHello) this.failuresBeforeHello += 1;
      if (isAuthCloseCode(ev?.code)) this.tokenStale = true;
      // Overloaded / rate limited: start the backoff a few steps in (~4–8 s).
      if (ev?.code === OVERLOAD_CLOSE_CODE) this.attempt = Math.max(this.attempt, 3);
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose follows and handles the reconnect.
    };
  }

  private sendRaw(ws: WebSocket, msg: ClientMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // closing
    }
  }

  private flush(): void {
    const q = this.queue;
    this.queue = [];
    for (const m of q) this.send(m);
  }

  private startWatchdog(): void {
    if (this.watchdog) this.p.clearInterval(this.watchdog);
    this.watchdog = this.p.setInterval(() => {
      if (!this.ws || this.p.now() - this.lastRx <= SILENCE_MS) return;
      // Silent for 45 s: treat the socket as dead and reconnect.
      const ws = this.ws;
      try {
        ws.close(4000, "no ping");
      } catch {
        // ignore
      }
      ws.onclose?.call(ws, { code: 4000 } as CloseEvent);
    }, 5_000);
  }

  private scheduleReconnect(): void {
    if (this.closed || this.retryTimer) return;
    this.attempt += 1;
    if (this.everOpened) this.h.onDown(this.attempt);
    const delay = backoffDelay(this.attempt - 1, this.p.random);
    this.retryTimer = this.p.setTimeout(() => {
      this.retryTimer = null;
      void this.openSocket();
    }, delay);
  }
}
