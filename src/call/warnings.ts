/**
 * Call warnings: the server's `warning` / `warning_cleared` frames and the
 * client's own checks (network, CPU, outgoing video). Everything in this
 * file is pure (no browser APIs) so it can be unit tested.
 */

/** Known warning codes. Other codes may arrive from newer servers and are passed through unchanged. */
export const CallWarningCodes = {
  /** Server: a peer-to-peer call has many participants; quality may drop. */
  LargeCall: "large_call",
  /** Server: the TURN relay is near capacity. */
  RelayBusy: "relay_busy",
  /** Server: the relay is down or refused this participant; the call may not connect behind strict firewalls. */
  RelayUnavailable: "relay_unavailable",
  /** Client: weak uplink (estimated bandwidth below what the peers need, loss > 8 % or RTT > 600 ms for ≥ 6 s). */
  PoorNetwork: "poor_network",
  /** Client: the encoder is limited by CPU for ≥ 6 s. */
  DeviceOverloaded: "device_overloaded",
  /** Client (info): the SDK lowered outgoing video bitrate/resolution. */
  VideoReduced: "video_reduced",
  /** Client: the SDK stopped sending video to keep audio working. */
  VideoPaused: "video_paused",
} as const;

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
export const DEFAULT_WARNING_MESSAGES: Readonly<Record<KnownCallWarningCode, string>> = {
  large_call: "Call quality may drop — many people are in this call",
  relay_busy: "The call relay is busy; the call may not connect on some networks",
  relay_unavailable: "Calls aren't available on this network right now",
  poor_network: "Your connection is weak",
  device_overloaded: "Your device is overloaded; video quality was lowered",
  video_reduced: "Video quality was lowered to fit your connection",
  video_paused: "Your video is paused to keep audio clear",
};

/** The default English text for a code ("Call warning: <code>" for an unknown one). */
export function defaultWarningMessage(code: string): string {
  return (DEFAULT_WARNING_MESSAGES as Record<string, string>)[code] ?? `Call warning: ${code}`;
}

/** `info` for informational codes (`video_reduced`), `warning` for everything else. */
export function warningSeverity(code: string): "info" | "warning" {
  return code === CallWarningCodes.VideoReduced ? "info" : "warning";
}

/**
 * Reads a server `warning` frame (`{t:"warning", call_id, code, participants?, message?}`).
 * Null when it is not one or has no code. `fallbackCallId` is used when `call_id` is missing.
 */
export function parseWarning(msg: unknown, now: number, fallbackCallId?: string | null): CallWarning | null {
  const m = msg as Record<string, unknown> | null;
  if (!m || typeof m !== "object" || m.t !== "warning") return null;
  const code = typeof m.code === "string" ? m.code.trim() : "";
  if (!code) return null;
  const callId = typeof m.call_id === "string" && m.call_id ? m.call_id : fallbackCallId ?? "";
  if (!callId) return null;
  const n = typeof m.participants === "number" ? m.participants : typeof m.participants === "string" ? Number(m.participants) : NaN;
  const message = typeof m.message === "string" && m.message.trim() ? m.message : defaultWarningMessage(code);
  return {
    code,
    message,
    callId,
    ...(Number.isFinite(n) && n >= 0 ? { participants: Math.round(n) } : {}),
    source: "server",
    severity: warningSeverity(code),
    at: now,
  };
}

/** Reads a server `warning_cleared` frame. Null when it is not one or has no code. */
export function parseWarningCleared(msg: unknown, now: number, fallbackCallId?: string | null): CallWarningCleared | null {
  const m = msg as Record<string, unknown> | null;
  if (!m || typeof m !== "object" || m.t !== "warning_cleared") return null;
  const code = typeof m.code === "string" ? m.code.trim() : "";
  if (!code) return null;
  const callId = typeof m.call_id === "string" && m.call_id ? m.call_id : fallbackCallId ?? "";
  if (!callId) return null;
  return { code, callId, source: "server", at: now };
}

// ── Hysteresis ──────────────────────────────────────────────────────────

/**
 * A condition that turns on only after it was bad for `enterMs` and off
 * only after it was good for `exitMs`. `update` returns `"enter"` / `"exit"`
 * exactly once per transition, otherwise null — so warnings are not spammed.
 */
export class SustainedFlag {
  active = false;
  private since: number | null = null;

  constructor(
    readonly enterMs = 6_000,
    readonly exitMs = 6_000,
  ) {}

  update(bad: boolean, now: number): "enter" | "exit" | null {
    const wantChange = this.active ? !bad : bad;
    if (!wantChange) {
      this.since = null;
      return null;
    }
    if (this.since === null) this.since = now;
    if (now - this.since < (this.active ? this.exitMs : this.enterMs)) return null;
    this.since = null;
    this.active = !this.active;
    return this.active ? "enter" : "exit";
  }

  reset(): void {
    this.active = false;
    this.since = null;
  }
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

export const DEFAULT_NETWORK_THRESHOLDS: NetworkThresholds = {
  lossEnterPct: 8,
  lossExitPct: 4,
  rttEnterMs: 600,
  rttExitMs: 400,
  bitrateExitFactor: 1.2,
};

/** Audio needs about this much per peer (Opus plus overhead). */
export const AUDIO_KBPS_PER_PEER = 40;
/** The least video bitrate per peer worth sending. */
export const MIN_VIDEO_KBPS = 150;
/** The most video bitrate per peer the SDK allows in a multi-peer call. */
export const MAX_VIDEO_KBPS = 1_500;

/** The uplink (kbps) the current peers need: audio for each, plus minimal video when sending video. */
export function requiredKbps(peers: number, sendingVideo: boolean): number {
  return Math.max(0, peers) * (AUDIO_KBPS_PER_PEER + (sendingVideo ? MIN_VIDEO_KBPS : 0));
}

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
export function networkBad(m: NetworkMetrics, active: boolean, t: NetworkThresholds = DEFAULT_NETWORK_THRESHOLDS): boolean {
  const loss = m.lossPct;
  const rtt = m.rttMs;
  const avail = m.availableKbps;
  if (!active) {
    if (loss !== null && loss > t.lossEnterPct) return true;
    if (rtt !== null && rtt > t.rttEnterMs) return true;
    if (avail !== null && m.neededKbps > 0 && avail < m.neededKbps) return true;
    return false;
  }
  const lossOk = loss === null || loss < t.lossExitPct;
  const rttOk = rtt === null || rtt < t.rttExitMs;
  const bwOk = avail === null || m.neededKbps <= 0 || avail >= m.neededKbps * t.bitrateExitFactor;
  return !(lossOk && rttOk && bwOk);
}

// ── Outgoing video budget ───────────────────────────────────────────────

/** Steps of the outgoing video per peer, best first. */
export const VIDEO_LEVELS: ReadonlyArray<{ maxKbps: number; scaleResolutionDownBy: number }> = [
  { maxKbps: 1_500, scaleResolutionDownBy: 1 },
  { maxKbps: 1_000, scaleResolutionDownBy: 1 },
  { maxKbps: 600, scaleResolutionDownBy: 1.5 },
  { maxKbps: 300, scaleResolutionDownBy: 2 },
  { maxKbps: 150, scaleResolutionDownBy: 3 },
];
/** Level index meaning "video paused". */
export const VIDEO_PAUSED = VIDEO_LEVELS.length;

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
export function levelFor(perPeerKbps: number): number {
  if (!(perPeerKbps >= MIN_VIDEO_KBPS)) return VIDEO_PAUSED;
  for (let i = 0; i < VIDEO_LEVELS.length; i++) if (perPeerKbps >= VIDEO_LEVELS[i].maxKbps) return i;
  return VIDEO_LEVELS.length - 1;
}

/** Splits the available outgoing bitrate across the peers: clamp(available / peers, 150 kbps, 1.5 Mbps). */
export function videoBudget(availableKbps: number, peers: number): VideoBudget {
  const perPeerKbps = availableKbps / Math.max(1, peers);
  const level = levelFor(perPeerKbps);
  const maxBitrateKbps = Math.round(Math.min(MAX_VIDEO_KBPS, Math.max(MIN_VIDEO_KBPS, perPeerKbps)));
  const scaleResolutionDownBy = level === VIDEO_PAUSED ? VIDEO_LEVELS[VIDEO_LEVELS.length - 1].scaleResolutionDownBy : VIDEO_LEVELS[level].scaleResolutionDownBy;
  return { perPeerKbps, maxBitrateKbps, scaleResolutionDownBy, paused: level === VIDEO_PAUSED, level };
}

/** What the senders should be set to. `maxBitrateKbps: null` leaves the browser's own limit. */
export interface VideoTarget {
  level: number;
  maxBitrateKbps: number | null;
  scaleResolutionDownBy: number;
  active: boolean;
}

export function videoTarget(level: number, peers: number): VideoTarget {
  if (level >= VIDEO_PAUSED) {
    const last = VIDEO_LEVELS[VIDEO_LEVELS.length - 1];
    return { level: VIDEO_PAUSED, maxBitrateKbps: last.maxKbps, scaleResolutionDownBy: last.scaleResolutionDownBy, active: false };
  }
  const l = VIDEO_LEVELS[Math.max(0, level)];
  // A 1:1 call on a good link keeps the browser's own limits.
  if (level <= 0 && peers <= 1) return { level: 0, maxBitrateKbps: null, scaleResolutionDownBy: 1, active: true };
  return { level: Math.max(0, level), maxBitrateKbps: l.maxKbps, scaleResolutionDownBy: l.scaleResolutionDownBy, active: true };
}

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

export const DEFAULT_ADAPT_OPTIONS: AdaptOptions = {
  warmupMs: 10_000,
  downAfterMs: 4_000,
  upAfterMs: 10_000,
  retryMs: 15_000,
  maxRetryMs: 60_000,
};

/** A level is kept while the per-peer budget stays above this share of its cap. */
const STAY_FACTOR = 0.75;
/** A capped sender whose budget reaches this share of its cap may try the next level up. */
const UP_FACTOR = 0.85;
/** A step down this soon after a step up counts as a failed probe. */
const PROBE_WINDOW_MS = 30_000;
const MAX_UP_DELAY_MS = 160_000;

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
export class VideoAdapter {
  level = 0;
  private firstAt: number | null = null;
  private downSince: number | null = null;
  private upSince: number | null = null;
  private pausedAt = 0;
  private retryDelay: number;
  private upDelay: number;
  private lastUpAt: number | null = null;
  private readonly o: AdaptOptions;

  constructor(options: Partial<AdaptOptions> = {}) {
    this.o = { ...DEFAULT_ADAPT_OPTIONS, ...options };
    this.retryDelay = this.o.retryMs;
    this.upDelay = this.o.upAfterMs;
  }

  get paused(): boolean {
    return this.level >= VIDEO_PAUSED;
  }

  /** True when video is below the best level (or paused). */
  get reduced(): boolean {
    return this.level > 0;
  }

  reset(): void {
    this.level = 0;
    this.firstAt = this.downSince = this.upSince = this.lastUpAt = null;
    this.pausedAt = 0;
    this.retryDelay = this.o.retryMs;
    this.upDelay = this.o.upAfterMs;
  }

  /** The level the budget asks for, with hysteresis around the current one. */
  private wanted(per: number, peers: number): number {
    if (per < MIN_VIDEO_KBPS) return VIDEO_PAUSED;
    if (peers <= 1) return 0;
    const raw = levelFor(per);
    if (raw > this.level && this.level < VIDEO_PAUSED && per >= VIDEO_LEVELS[this.level].maxKbps * STAY_FACTOR) {
      return this.level;
    }
    return raw;
  }

  /** One sample. Returns the changes to announce (in order), possibly none. */
  update(s: AdaptInput): AdaptChange[] {
    const out: AdaptChange[] = [];
    if (this.firstAt === null) this.firstAt = s.now;
    if (s.now - this.firstAt < this.o.warmupMs || s.availableKbps === null || s.peers <= 0) {
      this.downSince = this.upSince = null;
      return out;
    }
    if (this.lastUpAt !== null && s.now - this.lastUpAt >= PROBE_WINDOW_MS) {
      // The last step up held: the next one may come quickly again.
      this.lastUpAt = null;
      this.upDelay = this.o.upAfterMs;
    }
    const per = s.availableKbps / s.peers;
    const want = this.wanted(per, s.peers);
    const lossLow = s.lossPct === null || s.lossPct < 3;
    const rttLow = s.rttMs === null || s.rttMs < 400;
    const before = this.level;

    if (this.paused) {
      if (s.now - this.pausedAt >= this.retryDelay && lossLow && rttLow) {
        // Retry at the lowest level (1 peer: the browser's own limits).
        this.level = s.peers <= 1 ? 0 : VIDEO_LEVELS.length - 1;
        this.retryDelay = Math.min(this.o.maxRetryMs, this.retryDelay * 2);
        this.downSince = this.upSince = null;
      }
    } else if (want > this.level) {
      this.upSince = null;
      if (this.downSince === null) this.downSince = s.now;
      if (s.now - this.downSince >= this.o.downAfterMs) {
        this.level = want;
        this.downSince = null;
        if (this.paused) this.pausedAt = s.now;
        if (this.lastUpAt !== null && s.now - this.lastUpAt < PROBE_WINDOW_MS) {
          this.upDelay = Math.min(MAX_UP_DELAY_MS, this.upDelay * 2);
        }
        this.lastUpAt = null;
      }
    } else {
      this.downSince = null;
      let up = false;
      if (this.level > 0) {
        if (s.peers <= 1) up = true; // 1 peer: no stepping, back to the browser's limits
        else up = (want < this.level || per >= VIDEO_LEVELS[this.level].maxKbps * UP_FACTOR) && lossLow;
      }
      if (!up) this.upSince = null;
      else {
        if (this.upSince === null) this.upSince = s.now;
        if (s.now - this.upSince >= (s.peers <= 1 ? this.o.downAfterMs : this.upDelay)) {
          this.level = s.peers <= 1 ? 0 : this.level - 1;
          this.upSince = null;
          this.lastUpAt = s.now;
          if (this.level === 0) this.retryDelay = this.o.retryMs;
        }
      }
    }

    const after = this.level;
    if (before === after) return out;
    const wasPaused = before >= VIDEO_PAUSED;
    const isPaused = after >= VIDEO_PAUSED;
    if (!wasPaused && isPaused) {
      if (before === 0) out.push("reduced");
      out.push("paused");
    } else if (wasPaused && !isPaused) {
      out.push("resumed");
      if (after === 0) out.push("restored");
    } else if (before === 0 && after > 0) out.push("reduced");
    else if (before > 0 && after === 0) out.push("restored");
    return out;
  }
}
