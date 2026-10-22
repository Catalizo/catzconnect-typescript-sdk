/**
 * Call warnings: the server's `warning` / `warning_cleared` frames and the
 * client's own checks (network, CPU, outgoing video). Everything in this
 * file is pure (no browser APIs) so it can be unit tested.
 */
/** Known warning codes. Other codes may arrive from newer servers and are passed through unchanged. */
export declare const CallWarningCodes: {
    /** Server: a peer-to-peer call has many participants; quality may drop. */
    readonly LargeCall: "large_call";
    /** Server: the TURN relay is near capacity. */
    readonly RelayBusy: "relay_busy";
    /** Server: the relay is down or refused this participant; the call may not connect behind strict firewalls. */
    readonly RelayUnavailable: "relay_unavailable";
    /** Client: weak uplink (estimated bandwidth below what the peers need, loss > 8 % or RTT > 600 ms for ≥ 6 s). */
    readonly PoorNetwork: "poor_network";
    /** Client: the encoder is limited by CPU for ≥ 6 s. */
    readonly DeviceOverloaded: "device_overloaded";
    /** Client (info): the SDK lowered outgoing video bitrate/resolution. */
    readonly VideoReduced: "video_reduced";
    /** Client: the SDK stopped sending video to keep audio working. */
    readonly VideoPaused: "video_paused";
};
export type KnownCallWarningCode = (typeof CallWarningCodes)[keyof typeof CallWarningCodes];
/** A known code, or any other string (forward compatible). */
export type CallWarningCode = KnownCallWarningCode | (string & {});
export type CallWarningSource = "server" | "client";
export interface CallWarning {
    code: CallWarningCode;
    /** English default text; localise by `code`. */
    message: string;
    callId: string;
    /** Participants in the call, when known. */
    participants?: number;
    source: CallWarningSource;
    /** `info` for `video_reduced`, otherwise `warning`. */
    severity: "info" | "warning";
    /** When it was raised (ms since the epoch). */
    at: number;
}
export interface CallWarningCleared {
    code: CallWarningCode;
    callId: string;
    source: CallWarningSource;
    at: number;
}
/** English defaults for the known codes. */
export declare const DEFAULT_WARNING_MESSAGES: Readonly<Record<KnownCallWarningCode, string>>;
/** The default English text for a code ("Call warning: <code>" for an unknown one). */
export declare function defaultWarningMessage(code: string): string;
/** `info` for informational codes (`video_reduced`), `warning` for everything else. */
export declare function warningSeverity(code: string): "info" | "warning";
/**
 * Reads a server `warning` frame (`{t:"warning", call_id, code, participants?, message?}`).
 * Null when it is not one or has no code. `fallbackCallId` is used when `call_id` is missing.
 */
export declare function parseWarning(msg: unknown, now: number, fallbackCallId?: string | null): CallWarning | null;
/** Reads a server `warning_cleared` frame. Null when it is not one or has no code. */
export declare function parseWarningCleared(msg: unknown, now: number, fallbackCallId?: string | null): CallWarningCleared | null;
/**
 * A condition that turns on only after it was bad for `enterMs` and off
 * only after it was good for `exitMs`. `update` returns `"enter"` / `"exit"`
 * exactly once per transition, otherwise null — so warnings are not spammed.
 */
export declare class SustainedFlag {
    readonly enterMs: number;
    readonly exitMs: number;
    active: boolean;
    private since;
    constructor(enterMs?: number, exitMs?: number);
    update(bad: boolean, now: number): "enter" | "exit" | null;
    reset(): void;
}
export interface NetworkThresholds {
    /** Enter when loss is above this (%). */
    lossEnterPct: number;
    /** Leave only when loss is below this (%). */
    lossExitPct: number;
    rttEnterMs: number;
    rttExitMs: number;
    /** Leave only when the available bitrate is this many times what is needed. */
    bitrateExitFactor: number;
}
export declare const DEFAULT_NETWORK_THRESHOLDS: NetworkThresholds;
/** Audio needs about this much per peer (Opus plus overhead). */
export declare const AUDIO_KBPS_PER_PEER = 40;
/** The least video bitrate per peer worth sending. */
export declare const MIN_VIDEO_KBPS = 150;
/** The most video bitrate per peer the SDK allows in a multi-peer call. */
export declare const MAX_VIDEO_KBPS = 1500;
/** The uplink (kbps) the current peers need: audio for each, plus minimal video when sending video. */
export declare function requiredKbps(peers: number, sendingVideo: boolean): number;
export interface NetworkMetrics {
    /** Estimated total outgoing bitrate (kbps), or null when the browser does not report it. */
    availableKbps: number | null;
    /** What the call needs (see `requiredKbps`). */
    neededKbps: number;
    lossPct: number | null;
    rttMs: number | null;
}
/**
 * Whether the network counts as bad this sample. While `active` (warning
 * shown) the stricter exit thresholds apply, so it does not flap.
 */
export declare function networkBad(m: NetworkMetrics, active: boolean, t?: NetworkThresholds): boolean;
/** Steps of the outgoing video per peer, best first. */
export declare const VIDEO_LEVELS: ReadonlyArray<{
    maxKbps: number;
    scaleResolutionDownBy: number;
}>;
/** Level index meaning "video paused". */
export declare const VIDEO_PAUSED: number;
export interface VideoBudget {
    /** available / peers (kbps). */
    perPeerKbps: number;
    /** clamp(perPeerKbps, 150, 1500). */
    maxBitrateKbps: number;
    /** 1 · 1.5 · 2 · 3 as the per-peer budget shrinks. */
    scaleResolutionDownBy: number;
    /** True when the per-peer budget is under 150 kbps: send no video. */
    paused: boolean;
    /** Index into VIDEO_LEVELS, or VIDEO_PAUSED. */
    level: number;
}
/** The level for a per-peer budget: the best step whose bitrate fits, or paused under 150 kbps. */
export declare function levelFor(perPeerKbps: number): number;
/** Splits the available outgoing bitrate across the peers: clamp(available / peers, 150 kbps, 1.5 Mbps). */
export declare function videoBudget(availableKbps: number, peers: number): VideoBudget;
/** What the senders should be set to. `maxBitrateKbps: null` leaves the browser's own limit. */
export interface VideoTarget {
    level: number;
    maxBitrateKbps: number | null;
    scaleResolutionDownBy: number;
    active: boolean;
}
export declare function videoTarget(level: number, peers: number): VideoTarget;
export interface AdaptInput {
    now: number;
    peers: number;
    /** Sum of the peers' available outgoing bitrate estimates (kbps); null when unknown. */
    availableKbps: number | null;
    lossPct: number | null;
    rttMs: number | null;
}
export interface AdaptOptions {
    /** No adaptation for this long after the first sample (bandwidth estimates ramp up). Default 10 s. */
    warmupMs: number;
    /** A lower budget must hold this long before stepping down. Default 4 s. */
    downAfterMs: number;
    /** A budget that fills the current cap must hold this long before stepping up one level. Default 10 s (doubles after a failed step up, up to 160 s). */
    upAfterMs: number;
    /** First retry of video after a pause; doubles up to `maxRetryMs`. Default 15 s. */
    retryMs: number;
    maxRetryMs: number;
}
export declare const DEFAULT_ADAPT_OPTIONS: AdaptOptions;
export type AdaptChange = "reduced" | "restored" | "paused" | "resumed";
/**
 * Picks the outgoing video level from bandwidth estimates.
 *
 * - 2+ peers: steps down when the per-peer budget (available / peers) stays
 *   under 75 % of the current cap; steps up one level when the budget fills
 *   the current cap (≥ 85 %) with low loss — a capped sender's estimate
 *   rarely grows far past its cap, so this is how it finds headroom again.
 *   A step up that fails within 30 s doubles the wait before the next one.
 * - 1 peer: the browser's own congestion control handles the bitrate; the
 *   adapter only pauses video.
 * - Under 150 kbps per peer: video is paused, and retried with backoff
 *   (15 s, 30 s, 60 s) once loss and RTT are low — the estimate of a
 *   sender without video cannot recover on its own.
 */
export declare class VideoAdapter {
    level: number;
    private firstAt;
    private downSince;
    private upSince;
    private pausedAt;
    private retryDelay;
    private upDelay;
    private lastUpAt;
    private readonly o;
    constructor(options?: Partial<AdaptOptions>);
    get paused(): boolean;
    /** True when video is below the best level (or paused). */
    get reduced(): boolean;
    reset(): void;
    /** The level the budget asks for, with hysteresis around the current one. */
    private wanted;
    /** One sample. Returns the changes to announce (in order), possibly none. */
    update(s: AdaptInput): AdaptChange[];
}
