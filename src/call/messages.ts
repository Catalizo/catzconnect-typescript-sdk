/**
 * In-call chat and app data messages: caps, rate limiting, de-duplication
 * and the peer-to-peer envelope. Pure (no browser APIs) so it is testable.
 *
 * Messages travel over a WebRTC data channel to each peer when it is open,
 * and through the signaling server (`{ t: "chat" | "data" }`) otherwise.
 * Every message has a sender-chosen `id`; receivers drop repeats of
 * (sender pid, id), so a message that went both ways is shown once.
 *
 * Ordering: messages from one sender arrive in order on one route, but the
 * route can change between two messages (relay while a data channel is
 * still opening, p2p once it is open), so a later message can overtake an
 * earlier one. When order matters, sort by `ts` (the sender's clock, the
 * same on both routes) or carry your own sequence number in `data`.
 */

/** Caps the server announces in `hello.limits` (these defaults otherwise). */
export interface MessageLimits {
  /** Characters per chat text. Default 2000. */
  chatMaxChars: number;
  /** Bytes of a data payload as compact JSON (UTF-8). Default 16384. */
  dataMaxBytes: number;
  /** Messages (chat + data) per second per participant. Default 5. */
  perSec: number;
  /** Burst allowed above the rate. Default 20. */
  burst: number;
  /**
   * Whether the server relays messages (else data channels only). Only true
   * when the server says so (`hello.limits.messages_relay: true`): a server
   * without in-call messages announces nothing, and sending through it would
   * only be refused.
   */
  relay: boolean;
}

export const DEFAULT_MESSAGE_LIMITS: Readonly<MessageLimits> = Object.freeze({
  chatMaxChars: 2000,
  dataMaxBytes: 16_384,
  perSec: 5,
  burst: 20,
  relay: false,
});

/** Labels of the data channels the initiator of a peer link opens. */
export const RELIABLE_CHANNEL = "catz-msg";
export const UNRELIABLE_CHANNEL = "catz-msg-u";

const num = (v: unknown, d: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : d;

/**
 * Reads the message caps from `hello.limits`, defaults for anything missing.
 * A missing `messages_relay` means relay off (a server from before in-call
 * messages): messages then go over data channels only.
 */
export function messageLimitsFrom(limits: Record<string, unknown> | undefined | null): MessageLimits {
  const l = limits ?? {};
  const d = DEFAULT_MESSAGE_LIMITS;
  const perSec = num(l.messages_per_sec, d.perSec, 1, 1000);
  return {
    chatMaxChars: num(l.chat_max_chars, d.chatMaxChars, 1, 100_000),
    dataMaxBytes: num(l.data_max_bytes, d.dataMaxBytes, 1, 1_000_000),
    perSec,
    burst: Math.max(perSec, num(l.messages_burst, d.burst, 1, 10_000)),
    relay: typeof l.messages_relay === "boolean" ? l.messages_relay : d.relay,
  };
}

/** A send refused before it left this client. */
export class CallMessageError extends Error {
  constructor(
    readonly code: "not_in_call" | "bad_request" | "message_too_large" | "rate_limited" | "no_route",
    message: string,
  ) {
    super(message);
    this.name = "CallMessageError";
  }
}

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

export function validMessageId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

/** A new message id (random, 22 chars of base-36 plus the time). */
export function newMessageId(random: () => number, now: number): string {
  let r = "";
  for (let i = 0; i < 12; i++) r += Math.floor(random() * 36).toString(36);
  return `${now.toString(36)}-${r}`;
}

// U+0000–U+001F and U+007F–U+009F, except tab, newline, carriage return.
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

/** Number of Unicode code points (what the server counts). */
export function charCount(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/** Returns why a chat text is refused, or null when it is fine. */
export function checkChat(text: unknown, l: MessageLimits): CallMessageError | null {
  if (typeof text !== "string" || text.trim() === "") return new CallMessageError("bad_request", "Chat text is empty");
  if (charCount(text) > l.chatMaxChars) {
    return new CallMessageError("message_too_large", `Chat text is longer than ${l.chatMaxChars} characters`);
  }
  if (CONTROL_RE.test(text)) return new CallMessageError("bad_request", "Chat text contains control characters");
  return null;
}

/** Returns why a data payload is refused, or null. `json` is its compact JSON. */
export function checkData(payload: unknown, l: MessageLimits): { error: CallMessageError | null; json: string } {
  if (payload === null || payload === undefined) {
    return { error: new CallMessageError("bad_request", "Data payload is empty"), json: "" };
  }
  let json: string | undefined;
  try {
    json = JSON.stringify(payload);
  } catch {
    json = undefined;
  }
  if (typeof json !== "string") return { error: new CallMessageError("bad_request", "Data payload is not JSON"), json: "" };
  if (utf8Length(json) > l.dataMaxBytes) {
    return { error: new CallMessageError("message_too_large", `Data payload is larger than ${l.dataMaxBytes} bytes`), json };
  }
  return { error: null, json };
}

/** Token bucket: `perSec` per second, up to `burst`. */
export class RateBucket {
  private tokens: number;
  private at: number | null = null;
  constructor(private l: Pick<MessageLimits, "perSec" | "burst">) {
    this.tokens = l.burst;
  }
  take(now: number): boolean {
    if (this.at !== null) this.tokens = Math.min(this.l.burst, this.tokens + ((now - this.at) / 1000) * this.l.perSec);
    this.at = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

/** Remembers the last `max` keys; `seen(k)` is true for a repeat. */
export class Dedup {
  private keys = new Set<string>();
  constructor(private max = 1024) {}
  seen(key: string): boolean {
    if (this.keys.has(key)) return true;
    this.keys.add(key);
    if (this.keys.size > this.max) {
      const first = this.keys.values().next().value;
      if (first !== undefined) this.keys.delete(first);
    }
    return false;
  }
  clear(): void {
    this.keys.clear();
  }
}

/** What goes over a data channel (JSON text). */
export interface PeerEnvelope {
  v: 1;
  k: "chat" | "data";
  id: string;
  /** Sender's clock, ms. */
  ts: number;
  /** The recipient's pid for a private message, null for everyone. */
  to: string | null;
  text?: string;
  payload?: unknown;
  /** Data only: sent on the unreliable channel. */
  reliable?: boolean;
}

export function encodeEnvelope(e: PeerEnvelope): string {
  return JSON.stringify(e);
}

/**
 * Decodes and checks a data-channel message against the caps. Null for
 * anything malformed or over a cap (dropped silently: a peer cannot be
 * told off over the channel).
 */
export function decodeEnvelope(raw: unknown, l: MessageLimits): PeerEnvelope | null {
  if (typeof raw !== "string" || raw.length > 4 * (l.dataMaxBytes + l.chatMaxChars) + 1024) return null;
  let e: any;
  try {
    e = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!e || typeof e !== "object" || e.v !== 1 || !validMessageId(e.id)) return null;
  const ts = typeof e.ts === "number" && Number.isFinite(e.ts) ? e.ts : 0;
  const to = typeof e.to === "string" ? e.to : null;
  if (e.k === "chat") {
    if (checkChat(e.text, l)) return null;
    return { v: 1, k: "chat", id: e.id, ts, to, text: e.text };
  }
  if (e.k === "data") {
    if (checkData(e.payload, l).error) return null;
    return { v: 1, k: "data", id: e.id, ts, to, payload: e.payload, reliable: e.reliable !== false };
  }
  return null;
}

/**
 * How a message goes out: `p2p` when every target has an open data channel
 * (and the app did not ask for server delivery), else `relay` through the
 * signaling server (when it relays). `none` when neither can carry it.
 */
export function chooseRoute(
  targets: Array<{ open: boolean }>,
  o: { forceServer: boolean; serverRelay: boolean },
): "p2p" | "relay" | "none" {
  if (!o.forceServer && targets.length > 0 && targets.every((t) => t.open)) return "p2p";
  if (o.serverRelay) return "relay";
  // No relay: what is open goes peer-to-peer; nothing open, nowhere to go.
  return !o.forceServer && targets.some((t) => t.open) ? "p2p" : "none";
}

/**
 * True for the refusal a server without in-call messages sends for a
 * `chat` / `data` frame (`bad_request`, `Unknown message type "chat"`). It
 * answers a message, not a join or resume, and must not be treated as one.
 */
export function isUnsupportedMessageError(code: unknown, message: unknown): boolean {
  return code === "bad_request" && typeof message === "string" && /^Unknown message type "(chat|data)"$/.test(message.trim());
}
