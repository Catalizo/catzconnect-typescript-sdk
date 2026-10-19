import { Emitter } from "./emitter";
import { getLocalMedia, getScreenTrack, nextCamera } from "./media";
import { PeerLink } from "./peer";
import { isAuthErrorCode, Signaling } from "./signaling";
import { qualityLevel } from "./stats";
import type {
  CallInfo,
  CallMode,
  CallPlatform,
  CallStatus,
  CatzCallEvents,
  CatzCallOptions,
  ClientMessage,
  HelloMessage,
  IceServerInfo,
  JoinedMessage,
  JoinResult,
  PeerInfo,
  ProviderInfo,
  ServerMessage,
} from "./types";

/** Default signaling endpoint. */
export const DEFAULT_CALL_URL = "wss://api.catzconnect.com/rtc/v1/ws";

const TERMINAL: ReadonlySet<CallStatus> = new Set(["ended", "missed", "declined", "canceled", "failed"]);
const JOIN_TIMEOUT_MS = 15_000;
const RESUME_CONFIRM_MS = 5_000;

export interface JoinOptions {
  /** Send the microphone. Default true. */
  audio?: boolean;
  /** Send the camera. Default: true for a video call (when known from `incoming`), else false. */
  video?: boolean;
  /** Use this stream instead of asking for the camera/mic. The client does not stop its tracks on leave. */
  stream?: MediaStream;
}

interface ActiveCall {
  id: string;
  info: CallInfo;
  mode: CallMode;
  pid: string | null;
  media: { audio: boolean; video: boolean };
  provider?: ProviderInfo;
  polite: Record<string, boolean>;
  /** STUN + TURN for this call's peer connections (`joined.ice_servers`, renewed by `ice_refresh`). */
  ice: IceServerInfo[] | null;
}

interface PendingJoin {
  callId: string;
  resolve: (r: JoinResult) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  silent: boolean;
}

function resolvePlatform(over: Partial<CallPlatform> | undefined): CallPlatform {
  const g: any = typeof globalThis !== "undefined" ? globalThis : {};
  const nav: any = g.navigator;
  return {
    WebSocket: g.WebSocket,
    RTCPeerConnection: g.RTCPeerConnection,
    MediaStream: g.MediaStream,
    mediaDevices: nav?.mediaDevices,
    window: typeof g.addEventListener === "function" ? g : undefined,
    connection: nav?.connection && typeof nav.connection.addEventListener === "function" ? nav.connection : undefined,
    setTimeout: g.setTimeout.bind(g),
    clearTimeout: g.clearTimeout.bind(g),
    setInterval: g.setInterval.bind(g),
    clearInterval: g.clearInterval.bind(g),
    now: () => Date.now(),
    random: Math.random,
    ...over,
  } as CallPlatform;
}

function toRtcIce(list: IceServerInfo[]): RTCIceServer[] {
  return (list ?? []).map((s) => ({
    urls: s.urls,
    ...(s.username !== undefined ? { username: s.username } : {}),
    ...(s.credential !== undefined ? { credential: s.credential } : {}),
  }));
}

function ownPid(msg: JoinedMessage): string | null {
  const m: any = msg;
  const pid = m.pid ?? m.you?.pid ?? m.self?.pid ?? m.call?.pid ?? m.participant?.pid;
  return typeof pid === "string" && pid !== "" ? pid : null;
}

/**
 * Browser client for CatzConnect calls (engine `catz`: peer-to-peer WebRTC
 * mesh through our STUN/TURN relay). Uses only browser built-ins.
 *
 * ```ts
 * const client = new CatzCallClient({ getToken: () => fetch("/api/call-token").then(r => r.text()) });
 * client.on("incoming", ({ callId }) => client.accept(callId));
 * client.on("track", ({ pid, stream }) => attach(pid, stream));
 * await client.connect();
 * await client.join(callIdFromYourBackend, { audio: true, video: true });
 * ```
 *
 * The connection is kept up without hanging up: ICE prefers a direct path
 * and falls back to the relay (UDP → TCP → TLS) by itself; a failed or
 * long-disconnected path is ICE-restarted with backoff; a dropped WebSocket
 * reconnects with backoff and resumes the call within the server's 30 s
 * grace (or rejoins after it), renewing the token through `getToken`.
 */
/**
 * Whether an existing link belongs to an earlier join of that participant:
 * the server's epoch for it changed. A link without a known epoch (opened
 * by an early offer) or a message without one (older server) is kept.
 */
export function staleLink(link: { epoch?: number }, epoch: number | undefined): boolean {
  return typeof epoch === "number" && typeof link.epoch === "number" && link.epoch !== epoch;
}

export class CatzCallClient extends Emitter<CatzCallEvents> {
  private readonly p: CallPlatform;
  private readonly opts: CatzCallOptions;
  private sig: Signaling | null = null;
  private iceServers: IceServerInfo[] = [];
  private maxParticipants = 4;
  private call: ActiveCall | null = null;
  private links = new Map<string, PeerLink>();
  private ringing = new Map<string, CallInfo>();
  private localStream: MediaStream | null = null;
  private ownsLocalStream = false;
  private screenTrack: MediaStreamTrack | null = null;
  private cameraTrack: MediaStreamTrack | null = null;
  private muted = { audio: false, video: false };
  private pendingJoin: PendingJoin | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private downAt: number | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private closedForGood = false;
  private connecting: Promise<void> | null = null;
  private readonly onNetwork = () => this.networkChanged();

  constructor(options: CatzCallOptions = {}) {
    super();
    this.opts = options;
    this.p = resolvePlatform(options.platform);
  }

  // ── state ────────────────────────────────────────────────────────────

  /** True while the signaling socket is open. */
  get connected(): boolean {
    return !!this.sig?.isOpen;
  }

  /** The call this client is in, or null. */
  get callId(): string | null {
    return this.call?.id ?? null;
  }

  /** This participant's id in the current call (when the server sent it). */
  get pid(): string | null {
    return this.call?.pid ?? null;
  }

  /** The local camera/mic stream, once acquired. */
  get localMediaStream(): MediaStream | null {
    return this.localStream;
  }

  /** Remote participants in the current call. */
  get peers(): PeerInfo[] {
    return [...this.links.entries()].map(([pid, l]) => ({ pid, user_id: l.userId }));
  }

  /** Remote stream for a participant. */
  remoteStream(pid: string): MediaStream | null {
    return this.links.get(pid)?.remoteStream ?? null;
  }

  // ── connection ───────────────────────────────────────────────────────

  /** Opens signaling and waits for the server's `hello`. Safe to call more than once. */
  connect(): Promise<void> {
    if (this.closedForGood) return Promise.reject(new Error("The call client is closed"));
    if (this.sig?.isOpen) return Promise.resolve();
    if (this.connecting) return this.connecting;
    if (typeof this.p.WebSocket !== "function") {
      return Promise.reject(new Error("WebSocket is not available in this environment"));
    }
    if (!this.opts.token && !this.opts.getToken) {
      return Promise.reject(new Error("Pass a token or getToken to CatzCallClient"));
    }

    const sig = new Signaling(this.opts.url ?? DEFAULT_CALL_URL, this.opts.token, this.opts.getToken, this.p, {
      onMessage: (m) => this.onMessage(m),
      onOpen: (h, re) => this.onOpen(h, re),
      onDown: (attempt) => this.onDown(attempt),
      onFatal: (err) => {
        this.emit("error", err);
        this.shutdown(err.code);
      },
    });
    this.sig = sig;
    this.p.window?.addEventListener("online", this.onNetwork);
    this.p.connection?.addEventListener("change", this.onNetwork);

    this.connecting = sig
      .connect()
      .then(() => undefined)
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  private send(msg: ClientMessage, queue = true): void {
    this.sig?.send(msg, queue);
  }

  /** ICE servers for the current call: the call's own (with TURN) or, before `joined`, hello's STUN. */
  private callIce(): IceServerInfo[] {
    return this.call?.ice ?? this.iceServers;
  }

  private applyIce(): void {
    const rtc = toRtcIce(this.callIce());
    for (const l of this.links.values()) l.setIceServers(rtc);
  }

  private onOpen(hello: HelloMessage, reconnect: boolean): void {
    // hello carries STUN only; a call's TURN credentials stay until `joined`/`ice_refresh` renews them.
    this.iceServers = Array.isArray(hello.ice_servers) ? hello.ice_servers : [];
    if (hello.limits?.max_participants) this.maxParticipants = hello.limits.max_participants;
    if (!this.call?.ice) this.applyIce();

    if (!reconnect) return;
    const downFor = this.downAt === null ? 0 : this.p.now() - this.downAt;
    this.downAt = null;

    const call = this.call;
    if (call) {
      const offered = [...(Array.isArray(hello.resume_all) ? hello.resume_all : []), ...(hello.resume ? [hello.resume] : [])];
      const r = offered.find((x) => x && x.call_id === call.id && typeof x.pid === "string");
      if (!call.pid && r) call.pid = r.pid;
      const grace = this.opts.resumeGraceMs ?? 30_000;
      if (call.pid && downFor <= grace) {
        // Sent before the queued frames are flushed.
        this.send({ t: "resume", call_id: call.id, pid: call.pid });
        if (this.resumeTimer) this.p.clearTimeout(this.resumeTimer);
        this.resumeTimer = this.p.setTimeout(() => (this.resumeTimer = null), RESUME_CONFIRM_MS);
      } else {
        this.rejoin("grace_expired");
      }
    }
    this.emit("reconnected", { scope: "signaling", callId: call?.id });
  }

  private onDown(attempt: number): void {
    if (this.downAt === null) this.downAt = this.p.now();
    this.emit("reconnecting", { scope: "signaling", callId: this.call?.id, attempt });
  }

  /** The grace ran out or the server refused the resume: join again with a new pid, keeping local media. */
  private rejoin(reason: string): void {
    const call = this.call;
    if (!call || call.provider) return;
    if (this.resumeTimer) this.p.clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    for (const [pid, l] of this.links) {
      l.close();
      this.emit("peer-left", { callId: call.id, pid, userId: l.userId, reason });
    }
    this.links.clear();
    this.sig?.dropQueued((m) => m.t === "signal" || m.t === "resume");
    call.pid = null;
    this.sendJoin(call.id, "join", call.media).catch((err) =>
      this.emit("error", { code: "rejoin_failed", message: err.message, callId: call.id }),
    );
  }

  private networkChanged(): void {
    this.sig?.reconnectNow();
    for (const l of this.links.values()) l.onNetworkChange();
  }

  // ── server frames ────────────────────────────────────────────────────

  private onMessage(m: ServerMessage): void {
    switch (m.t) {
      case "incoming": {
        const call = m.call;
        if (!call || typeof call.id !== "string") return;
        this.ringing.set(call.id, call);
        this.emit("incoming", {
          call,
          callId: call.id,
          from: call.from,
          mode: call.mode,
          engine: call.engine,
          metadata: call.metadata,
        });
        return;
      }
      case "joined":
        this.onJoined(m);
        return;
      case "peer_joined": {
        if (!this.call || m.call_id !== this.call.id || this.call.provider) return;
        const existing = this.links.get(m.pid);
        if (existing && staleLink(existing, m.epoch)) {
          // The participant joined again (another device: new DTLS identity).
          // The old connection can never renegotiate with it: replace it; the
          // newcomer sends a fresh offer.
          existing.close();
          this.links.delete(m.pid);
          this.createLink({ pid: m.pid, user_id: m.user_id, epoch: m.epoch }, false);
        } else if (existing) {
          existing.userId = m.user_id;
          if (typeof m.epoch === "number") existing.epoch = m.epoch;
        } else this.createLink({ pid: m.pid, user_id: m.user_id, epoch: m.epoch }, false);
        this.emit("peer-joined", { callId: m.call_id, pid: m.pid, userId: m.user_id });
        return;
      }
      case "peer_left": {
        if (!this.call || m.call_id !== this.call.id) return;
        const l = this.links.get(m.pid);
        if (l) {
          l.close();
          this.links.delete(m.pid);
        }
        this.emit("peer-left", { callId: m.call_id, pid: m.pid, userId: m.user_id, reason: m.reason });
        return;
      }
      case "signal": {
        if (!this.call || m.call_id !== this.call.id || this.call.provider) return;
        let l = this.links.get(m.from);
        // An offer can overtake peer_joined; open the link now and learn the user id later.
        if (!l) l = this.createLink({ pid: m.from, user_id: "" }, false);
        void l.handleSignal(m.data);
        return;
      }
      case "state": {
        if (TERMINAL.has(m.status)) this.ringing.delete(m.call_id);
        // Another device of this user answered/declined: stop ringing here (status unchanged).
        // "missed": this user did not answer in time while a group call goes on.
        if (m.reason === "answered_elsewhere" || m.reason === "declined_elsewhere" || m.reason === "missed") this.ringing.delete(m.call_id);
        const replaced = m.reason === "joined_elsewhere" && !TERMINAL.has(m.status);
        if (this.call && m.call_id === this.call.id && (TERMINAL.has(m.status) || replaced)) {
          // joined_elsewhere: the participant moved to another device; it stays in the call there.
          this.teardown();
        }
        if (this.pendingJoin && this.pendingJoin.callId === m.call_id && TERMINAL.has(m.status)) {
          this.failJoin(new Error(`The call is ${m.status}`));
        }
        this.emit("state", { callId: m.call_id, status: m.status, reason: m.reason });
        return;
      }
      case "ice_refresh": {
        if (!Array.isArray(m.ice_servers) || !this.call) return;
        if (m.call_id && m.call_id !== this.call.id) return; // for a call this client is not in
        this.call.ice = m.ice_servers;
        this.applyIce();
        return;
      }
      case "pong":
        return;
      case "error": {
        const callId = m.call_id ?? undefined;
        if (this.pendingJoin && !this.pendingJoin.silent && (!callId || callId === this.pendingJoin.callId)) {
          this.failJoin(Object.assign(new Error(m.message || m.code), { code: m.code }));
        } else if (this.resumeTimer && this.call && (!callId || callId === this.call.id) && !isAuthErrorCode(m.code)) {
          // The server did not take the resume (grace over, or another process): join again.
          this.rejoin(m.code || "resume_failed");
        }
        if (isAuthErrorCode(m.code)) this.sig?.markTokenStale();
        this.emit("error", { code: m.code, message: m.message, callId });
        return;
      }
    }
  }

  private onJoined(m: JoinedMessage): void {
    const call = m.call;
    if (!call || typeof call.id !== "string") return;
    const pending = this.pendingJoin && this.pendingJoin.callId === call.id ? this.pendingJoin : null;
    if (this.resumeTimer) {
      this.p.clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    if (!pending && (!this.call || this.call.id !== call.id)) return; // not ours

    this.ringing.delete(call.id);
    const mode: CallMode = call.mode === "video" ? "video" : "audio";
    const media = this.call?.id === call.id ? this.call.media : { audio: true, video: mode === "video" };
    const reqMedia = (pending as any)?.media ?? media;
    if (mode === "audio") reqMedia.video = false;

    this.call = {
      id: call.id,
      info: call,
      mode,
      pid: ownPid(m) ?? this.call?.pid ?? null,
      media: reqMedia,
      provider: m.provider,
      polite: m.polite_for ?? {},
      ice: Array.isArray(m.ice_servers) ? m.ice_servers : this.call?.id === call.id ? this.call.ice : null,
    };
    // A resume hands out fresh TURN credentials: apply them to the running connections.
    if (Array.isArray(m.ice_servers)) this.applyIce();
    const peers = Array.isArray(m.peers) ? m.peers : [];

    if (m.provider) {
      this.emit("provider", { callId: call.id, call, provider: m.provider });
      this.settleJoin(pending, { call, pid: this.call.pid, peers, provider: m.provider });
      return;
    }

    const start = async () => {
      await this.ensureLocalMedia(reqMedia);
      if (!this.call || this.call.id !== call.id) return;
      // Links opened while the camera prompt was up (a later joiner offered to us) get the tracks now.
      const local = this.localStream;
      if (local) {
        for (const l of this.links.values()) {
          for (const t of local.getTracks()) void l.replaceTrack(t.kind as "audio" | "video", t, local);
        }
      }
      // Reconcile: drop links to peers that are gone (after a resume), open the rest as offerer.
      const live = new Set(peers.map((p) => p.pid));
      for (const [pid, l] of this.links) {
        if (!live.has(pid)) {
          l.close();
          this.links.delete(pid);
        }
      }
      const limit = Math.max(1, (call.max_participants ?? this.maxParticipants) - 1);
      peers.slice(0, limit).forEach((peer) => {
        const l = this.links.get(peer.pid);
        if (l && staleLink(l, peer.epoch)) {
          // The peer rejoined from another device while we were away.
          l.close();
          this.links.delete(peer.pid);
          this.createLink(peer, true);
        } else if (l) {
          l.userId = peer.user_id;
          if (typeof peer.epoch === "number") l.epoch = peer.epoch;
        } else this.createLink(peer, true);
      });
      if (peers.length > limit) {
        this.emit("error", {
          code: "too_many_participants",
          message: `Only ${limit + 1} participants fit a peer-to-peer call`,
          callId: call.id,
        });
      }
      this.startStats();
      this.settleJoin(pending, { call, pid: this.call.pid, peers });
    };
    start().catch((err) => {
      this.emit("error", { code: "join_failed", message: err?.message ?? String(err), callId: call.id, cause: err });
      this.settleJoin(pending, { call, pid: this.call?.pid ?? null, peers });
    });
  }

  private settleJoin(pending: PendingJoin | null, r: JoinResult): void {
    if (!pending) return;
    this.p.clearTimeout(pending.timer);
    if (this.pendingJoin === pending) this.pendingJoin = null;
    pending.resolve(r);
  }

  private failJoin(err: Error): void {
    const pj = this.pendingJoin;
    if (!pj) return;
    this.pendingJoin = null;
    this.p.clearTimeout(pj.timer);
    if (this.call && this.call.id === pj.callId && this.links.size === 0) this.teardown();
    pj.reject(err);
  }

  private createLink(peer: PeerInfo, initiator: boolean): PeerLink {
    const call = this.call!;
    const callId = call.id;
    const pid = peer.pid;
    const polite =
      typeof call.polite[pid] === "boolean"
        ? call.polite[pid]
        : call.pid
          ? call.pid > pid // the lexicographically larger pid is polite
          : !initiator; // unknown own pid: the answerer is polite, the offerer is not
    const link: PeerLink = new PeerLink({
      callId,
      pid,
      userId: peer.user_id,
      polite,
      initiator,
      mode: call.mode,
      platform: this.p,
      config: {
        iceTransportPolicy: "all",
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
        ...this.opts.rtcConfig,
        iceServers: toRtcIce(this.callIce()),
      },
      local: () => this.localStream,
      send: (data) => this.send({ t: "signal", call_id: callId, to: pid, data }),
      onTrack: (stream, track) => this.emit("track", { callId, pid, userId: link.userId, stream, track }),
      onConnection: (type) => this.emit("connection", { callId, pid, userId: link.userId, type }),
      onReconnecting: (attempt) => this.emit("reconnecting", { scope: "peer", callId, pid, attempt }),
      onReconnected: () => this.emit("reconnected", { scope: "peer", callId, pid }),
      onError: (code, message, cause) => this.emit("error", { code, message, callId, pid, cause }),
    });
    if (typeof peer.epoch === "number") link.epoch = peer.epoch;
    this.links.set(pid, link);
    return link;
  }

  // ── media ────────────────────────────────────────────────────────────

  private async ensureLocalMedia(req: { audio: boolean; video: boolean }): Promise<void> {
    if (this.localStream || (!req.audio && !req.video)) return;
    try {
      this.localStream = await getLocalMedia(this.p.mediaDevices, req);
      this.ownsLocalStream = true;
    } catch (err: any) {
      // Join anyway, receive-only, and tell the app why it cannot be heard/seen.
      this.emit("error", {
        code: "media_failed",
        message: err?.message ?? "Could not open the microphone or camera",
        callId: this.call?.id,
        cause: err,
      });
      return;
    }
    for (const t of this.localStream.getTracks()) t.enabled = !this.muted[t.kind as "audio" | "video"];
    this.emit("local-stream", { stream: this.localStream, screen: false });
  }

  // ── call actions ─────────────────────────────────────────────────────

  private sendJoin(
    callId: string,
    verb: "join" | "accept",
    media: { audio: boolean; video: boolean },
    silent = false,
  ): Promise<JoinResult> {
    return new Promise<JoinResult>((resolve, reject) => {
      if (this.pendingJoin) this.failJoin(new Error("Superseded by another join"));
      const timer = this.p.setTimeout(() => this.failJoin(new Error("The server did not answer the join")), JOIN_TIMEOUT_MS);
      const pj: PendingJoin & { media?: typeof media } = { callId, resolve, reject, timer, silent, media: { ...media } };
      this.pendingJoin = pj;
      if (verb === "accept") this.send({ t: "accept", call_id: callId, media: { ...media }, platform: "web" });
      else this.send({ t: "join", call_id: callId, media: { ...media }, platform: "web" });
    });
  }

  private async prepareJoin(callId: string, o: JoinOptions): Promise<{ audio: boolean; video: boolean }> {
    if (typeof callId !== "string" || callId.trim() === "") throw new Error("Missing call id");
    if (this.call && this.call.id !== callId) throw new Error("Already in a call; leave() first");
    await this.connect();
    const known = this.ringing.get(callId);
    const media = { audio: o.audio ?? true, video: o.video ?? known?.mode === "video" };
    if (o.stream) {
      this.localStream = o.stream;
      this.ownsLocalStream = false;
      this.emit("local-stream", { stream: o.stream, screen: false });
    }
    return media;
  }

  /**
   * Joins a call: the caller after creating it on the backend, or anyone
   * invited. Resolves with the call, this participant's pid and the peers
   * already in it. For a provider-engine call it resolves with `provider`
   * (and emits `provider`) instead of opening peer connections.
   */
  async join(callId: string, options: JoinOptions = {}): Promise<JoinResult> {
    const media = await this.prepareJoin(callId, options);
    return this.sendJoin(callId, "join", media);
  }

  /** Answers an `incoming` call (an alias of join for callees). */
  async accept(callId: string, options: JoinOptions = {}): Promise<JoinResult> {
    const media = await this.prepareJoin(callId, options);
    return this.sendJoin(callId, "accept", media);
  }

  /** Declines an `incoming` call. */
  decline(callId: string): void {
    this.ringing.delete(callId);
    this.send({ t: "decline", call_id: callId });
  }

  /** The caller hangs up while it is still ringing. */
  cancel(callId?: string): void {
    const id = callId ?? this.call?.id;
    if (!id) return;
    this.send({ t: "cancel", call_id: id });
    if (this.call?.id === id) this.teardown();
  }

  /** Leaves the current call and releases the camera and microphone. */
  leave(): void {
    const call = this.call;
    if (!call) return;
    this.send({ t: "leave", call_id: call.id });
    if (this.pendingJoin?.callId === call.id) this.failJoin(new Error("Left the call"));
    this.teardown();
  }

  /** Mutes or unmutes the microphone (`audio`) or camera (`video`) without renegotiating. */
  setMuted(kind: "audio" | "video", muted: boolean): void {
    this.muted[kind] = muted;
    for (const t of this.localStream?.getTracks() ?? []) if (t.kind === kind) t.enabled = !muted;
    if (kind === "video" && this.cameraTrack) this.cameraTrack.enabled = !muted;
  }

  /** True when that kind is muted. */
  isMuted(kind: "audio" | "video"): boolean {
    return this.muted[kind];
  }

  /** Switches to the next camera (front/back on phones) with replaceTrack. */
  async switchCamera(): Promise<void> {
    const stream = this.localStream;
    const current = this.cameraTrack ?? stream?.getVideoTracks()[0] ?? null;
    if (!stream || !current) throw new Error("No camera in use");
    const next = await nextCamera(this.p.mediaDevices, current);
    next.enabled = !this.muted.video;
    if (this.screenTrack) {
      // Sharing: swap the camera that comes back after stopShare.
      this.cameraTrack = next;
    } else {
      await Promise.all([...this.links.values()].map((l) => l.replaceTrack("video", next, stream)));
    }
    stream.removeTrack(current);
    stream.addTrack(next);
    current.stop();
    this.emit("local-stream", { stream, screen: false });
  }

  /** Shares the screen in place of the camera (replaceTrack; adds a video track in an audio call). */
  async shareScreen(): Promise<void> {
    if (!this.call || this.call.provider) throw new Error("Not in a peer-to-peer call");
    if (this.screenTrack) return;
    const track = await getScreenTrack(this.p.mediaDevices);
    this.screenTrack = track;
    this.cameraTrack = this.localStream?.getVideoTracks()[0] ?? null;
    track.addEventListener?.("ended", () => void this.stopShare());
    const stream = this.localStream ?? new this.p.MediaStream();
    await Promise.all([...this.links.values()].map((l) => l.replaceTrack("video", track, stream)));
    const preview = new this.p.MediaStream([...(this.localStream?.getAudioTracks() ?? []), track]);
    this.emit("local-stream", { stream: preview, screen: true });
  }

  /** Stops sharing and puts the camera back (or sends no video if there was none). */
  async stopShare(): Promise<void> {
    const screen = this.screenTrack;
    if (!screen) return;
    this.screenTrack = null;
    const camera = this.cameraTrack;
    this.cameraTrack = null;
    await Promise.all([...this.links.values()].map((l) => l.replaceTrack("video", camera, this.localStream)));
    screen.stop();
    if (this.localStream) this.emit("local-stream", { stream: this.localStream, screen: false });
  }

  // ── stats ────────────────────────────────────────────────────────────

  private startStats(): void {
    if (this.statsTimer) return;
    this.statsTimer = this.p.setInterval(() => void this.collectStats(), this.opts.statsIntervalMs ?? 10_000);
  }

  /** Samples every peer, emits `quality`, and sends one aggregated `stats` frame. Exposed for tests. */
  async collectStats(): Promise<void> {
    const call = this.call;
    if (!call) return;
    const rows = await Promise.all(
      [...this.links.entries()].map(async ([pid, l]) => ({ pid, l, s: await l.sample() })),
    );
    const usable = rows.filter((r) => r.s && r.s.connection);
    for (const { pid, l, s } of rows) {
      if (!s) continue;
      this.emit("quality", {
        callId: call.id,
        pid,
        userId: l.userId,
        connection: s.connection,
        rttMs: s.rttMs,
        jitterMs: s.jitterMs,
        lossPct: s.lossPct,
        bitrateKbps: s.bitrateKbps,
        level: qualityLevel(s.rttMs, s.lossPct),
      });
    }
    if (usable.length === 0 || this.call !== call) return;
    const avg = (xs: Array<number | null>) => {
      const v = xs.filter((x): x is number => typeof x === "number");
      return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
    };
    const losses = usable.map((r) => r.s!.lossPct).filter((x): x is number => typeof x === "number");
    const rates = usable.map((r) => r.s!.bitrateKbps).filter((x): x is number => typeof x === "number");
    this.send(
      {
        t: "stats",
        call_id: call.id,
        connection: usable.some((r) => r.s!.connection === "relay") ? "relay" : "direct",
        rtt_ms: avg(usable.map((r) => r.s!.rttMs)),
        jitter_ms: avg(usable.map((r) => r.s!.jitterMs)),
        loss_pct: losses.length ? Math.max(...losses) : null,
        bitrate_kbps: rates.length ? rates.reduce((a, b) => a + b, 0) : null,
      },
      false,
    );
  }

  // ── teardown ─────────────────────────────────────────────────────────

  private teardown(): void {
    if (this.statsTimer) this.p.clearInterval(this.statsTimer);
    this.statsTimer = null;
    if (this.resumeTimer) this.p.clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    for (const l of this.links.values()) l.close();
    this.links.clear();
    if (this.screenTrack) this.screenTrack.stop();
    this.screenTrack = null;
    if (this.ownsLocalStream) {
      for (const t of this.localStream?.getTracks() ?? []) t.stop();
      this.cameraTrack?.stop();
    }
    this.cameraTrack = null;
    this.localStream = null;
    this.ownsLocalStream = false;
    this.muted = { audio: false, video: false };
    this.call = null;
  }

  private shutdown(reason: string): void {
    if (this.closedForGood) return;
    this.closedForGood = true;
    if (this.pendingJoin) this.failJoin(new Error("The call client is closed"));
    this.teardown();
    this.sig?.close();
    this.sig = null;
    this.p.window?.removeEventListener("online", this.onNetwork);
    this.p.connection?.removeEventListener("change", this.onNetwork);
    this.emit("closed", { reason });
  }

  /** Leaves any call, closes signaling and stops all timers. The client cannot be reused. */
  close(): void {
    if (this.call) this.send({ t: "leave", call_id: this.call.id }, false);
    this.shutdown("closed");
  }
}
