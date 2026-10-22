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
export declare const DEFAULT_MESSAGE_LIMITS: Readonly<MessageLimits>;
/** Labels of the data channels the initiator of a peer link opens. */
export declare const RELIABLE_CHANNEL = "catz-msg";
export declare const UNRELIABLE_CHANNEL = "catz-msg-u";
/**
 * Reads the message caps from `hello.limits`, defaults for anything missing.
 * A missing `messages_relay` means relay off (a server from before in-call
 * messages): messages then go over data channels only.
 */
export declare function messageLimitsFrom(limits: Record<string, unknown> | undefined | null): MessageLimits;
/** A send refused before it left this client. */
export declare class CallMessageError extends Error {
    readonly code: "not_in_call" | "bad_request" | "message_too_large" | "rate_limited" | "no_route";
    constructor(code: "not_in_call" | "bad_request" | "message_too_large" | "rate_limited" | "no_route", message: string);
}
export declare function validMessageId(id: unknown): id is string;
/** A new message id (random, 22 chars of base-36 plus the time). */
export declare function newMessageId(random: () => number, now: number): string;
/** Number of Unicode code points (what the server counts). */
export declare function charCount(s: string): number;
export declare function utf8Length(s: string): number;
/** Returns why a chat text is refused, or null when it is fine. */
export declare function checkChat(text: unknown, l: MessageLimits): CallMessageError | null;
/** Returns why a data payload is refused, or null. `json` is its compact JSON. */
export declare function checkData(payload: unknown, l: MessageLimits): {
    error: CallMessageError | null;
    json: string;
};
/** Token bucket: `perSec` per second, up to `burst`. */
export declare class RateBucket {
    private l;
    private tokens;
    private at;
    constructor(l: Pick<MessageLimits, "perSec" | "burst">);
    take(now: number): boolean;
}
/** Remembers the last `max` keys; `seen(k)` is true for a repeat. */
export declare class Dedup {
    private max;
    private keys;
    constructor(max?: number);
    seen(key: string): boolean;
    clear(): void;
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
export declare function encodeEnvelope(e: PeerEnvelope): string;
/**
 * Decodes and checks a data-channel message against the caps. Null for
 * anything malformed or over a cap (dropped silently: a peer cannot be
 * told off over the channel).
 */
export declare function decodeEnvelope(raw: unknown, l: MessageLimits): PeerEnvelope | null;
/**
 * How a message goes out: `p2p` when every target has an open data channel
 * (and the app did not ask for server delivery), else `relay` through the
 * signaling server (when it relays). `none` when neither can carry it.
 */
export declare function chooseRoute(targets: Array<{
    open: boolean;
}>, o: {
    forceServer: boolean;
    serverRelay: boolean;
}): "p2p" | "relay" | "none";
/**
 * True for the refusal a server without in-call messages sends for a
 * `chat` / `data` frame (`bad_request`, `Unknown message type "chat"`). It
 * answers a message, not a join or resume, and must not be treated as one.
 */
export declare function isUnsupportedMessageError(code: unknown, message: unknown): boolean;
