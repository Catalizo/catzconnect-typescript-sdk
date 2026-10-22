import { RELIABLE_CHANNEL, UNRELIABLE_CHANNEL } from "./messages";
import { readStats, StatsCursor, StatsSample } from "./stats";
import type { CallMode, CallPlatform, ConnectionType, SignalData } from "./types";

const DISCONNECTED_GRACE_MS = 2_000;
const RESTART_CHECK_MS = 10_000;
const MAX_RESTART_BACKOFF_MS = 15_000;
/** A peer that should answer but never got an offer adds its tracks (and so offers) after this. */
const ANSWERER_FALLBACK_MS = 6_000;

export interface PeerLinkOptions {
  callId: string;
  pid: string;
  userId: string;
  /** Perfect negotiation: the polite side rolls back its own offer on glare. */
  polite: boolean;
  /** The newly joined side offers first and drives ICE restarts. */
  initiator: boolean;
  mode: CallMode;
  config: RTCConfiguration;
  platform: CallPlatform;
  /** Local media, read when tracks are attached. */
  local: () => MediaStream | null;
  send: (data: SignalData) => void;
  onTrack: (stream: MediaStream, track: MediaStreamTrack) => void;
  onConnection: (type: ConnectionType) => void;
  onReconnecting: (attempt: number) => void;
  onReconnected: () => void;
  onError: (code: string, message: string, cause?: unknown) => void;
  /** A text message on one of the link's data channels (in-call chat / data). */
  onChannelMessage?: (raw: string) => void;
  /** A data channel opened or closed. */
  onChannelState?: () => void;
}

/** Above this many queued bytes a data channel counts as congested (the server path is used). */
const CHANNEL_BUFFER_MAX = 1 << 20;

/**
 * One RTCPeerConnection to one remote participant, with perfect negotiation
 * (glare handled by rollback on the polite side), buffered ICE candidates,
 * and ICE restarts on failure or network change — without dropping tracks.
 */
export class PeerLink {
  readonly pc: RTCPeerConnection;
  readonly remoteStream: MediaStream;
  userId: string;
  /**
   * The peer's join epoch this link was made for (`peer_joined.epoch` /
   * `joined.peers[].epoch`); undefined when unknown (opened by an early
   * offer, or an older server). A different epoch means the peer joined
   * again from another device: this link must be replaced.
   */
  epoch?: number;

  private makingOffer = false;
  private ignoreOffer = false;
  private settingRemoteAnswer = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private tracksAttached = false;
  private closed = false;
  private restartAttempt = 0;
  private restarting = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private answererTimer: ReturnType<typeof setTimeout> | null = null;
  private everConnected = false;
  private statsCursor: StatsCursor | undefined;
  private healthCursor: StatsCursor | undefined;
  /** When the first health sample with a selected path was taken (bandwidth estimates ramp up after it). */
  firstPathAt: number | null = null;
  /** Key of the video encoding last applied with `applyVideo`. */
  private videoKey = "";
  /** Last path seen in stats. */
  connection: ConnectionType | null = null;
  /** Data channels for in-call messages (ordered + reliable, and unordered without retransmits). */
  private reliableChannel: RTCDataChannel | null = null;
  private unreliableChannel: RTCDataChannel | null = null;

  constructor(private o: PeerLinkOptions) {
    this.userId = o.userId;
    const p = o.platform;
    this.pc = new p.RTCPeerConnection(o.config);
    this.remoteStream = new p.MediaStream();

    this.pc.onnegotiationneeded = () => void this.negotiate();
    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) o.send({ candidate: ev.candidate.toJSON ? ev.candidate.toJSON() : (ev.candidate as any) });
    };
    this.pc.ontrack = (ev) => {
      const track = ev.track;
      if (!this.remoteStream.getTracks().includes(track)) {
        // One stream per peer: drop an older track of the same kind first.
        for (const t of this.remoteStream.getTracks()) {
          if (t.kind === track.kind && t !== track) this.remoteStream.removeTrack(t);
        }
        this.remoteStream.addTrack(track);
      }
      o.onTrack(this.remoteStream, track);
    };
    this.pc.oniceconnectionstatechange = () => this.onIceState();
    // An ICE restart over a path that never broke keeps iceConnectionState
    // "connected": the restart is done once the new offer/answer is applied.
    this.pc.onsignalingstatechange = () => {
      if (this.pc.signalingState === "stable") this.finishRestartIfConnected();
    };
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === "failed") this.requestRestart();
    };
    // The answerer gets the initiator's message channels in-band.
    this.pc.ondatachannel = (ev) => this.adoptChannel(ev.channel);
    if (o.initiator && typeof this.pc.createDataChannel === "function") {
      // Created before the first offer, so it carries the data section.
      try {
        this.adoptChannel(this.pc.createDataChannel(RELIABLE_CHANNEL, { ordered: true }));
        this.adoptChannel(this.pc.createDataChannel(UNRELIABLE_CHANNEL, { ordered: false, maxRetransmits: 0 }));
      } catch (err) {
        o.onError("data_channel_failed", "Could not open a data channel; messages go through the server", err);
      }
    }

    if (o.initiator) {
      this.attachLocal();
    } else {
      this.answererTimer = p.setTimeout(() => this.attachLocal(), ANSWERER_FALLBACK_MS);
    }
  }

  private adoptChannel(ch: RTCDataChannel): void {
    if (this.closed || !ch) return;
    if (ch.label === RELIABLE_CHANNEL) this.reliableChannel = ch;
    else if (ch.label === UNRELIABLE_CHANNEL) this.unreliableChannel = ch;
    else return; // not ours
    ch.onmessage = (ev: MessageEvent) => {
      if (!this.closed && typeof ev.data === "string") this.o.onChannelMessage?.(ev.data);
    };
    ch.onopen = ch.onclose = () => {
      if (!this.closed) this.o.onChannelState?.();
    };
  }

  /** Whether a message can go to this peer over a data channel now. */
  channelOpen(reliable = true): boolean {
    const ch = reliable ? this.reliableChannel : (this.unreliableChannel?.readyState === "open" ? this.unreliableChannel : this.reliableChannel);
    return !this.closed && !!ch && ch.readyState === "open" && (ch.bufferedAmount ?? 0) < CHANNEL_BUFFER_MAX;
  }

  /** Sends one message over the data channel; false when it could not (use the server). */
  sendOnChannel(text: string, reliable = true): boolean {
    if (!this.channelOpen(reliable)) return false;
    const ch = reliable || this.unreliableChannel?.readyState !== "open" ? this.reliableChannel! : this.unreliableChannel!;
    try {
      ch.send(text);
      return true;
    } catch {
      return false;
    }
  }

  get iceState(): RTCIceConnectionState {
    return this.pc.iceConnectionState;
  }

  /** Adds local tracks once. The initiator also asks for the media it lacks (receive-only). */
  attachLocal(): void {
    if (this.tracksAttached || this.closed) return;
    this.tracksAttached = true;
    if (this.answererTimer) this.o.platform.clearTimeout(this.answererTimer);
    this.answererTimer = null;

    const stream = this.o.local();
    const kinds = new Set<string>();
    if (stream) {
      const sending = new Set(this.pc.getSenders().map((x) => x.track));
      for (const track of stream.getTracks()) {
        if (!sending.has(track)) this.pc.addTrack(track, stream);
        kinds.add(track.kind);
      }
    }
    if (this.o.initiator) {
      const want = this.o.mode === "video" ? ["audio", "video"] : ["audio"];
      for (const kind of want) {
        if (!kinds.has(kind)) this.pc.addTransceiver(kind, { direction: "recvonly" });
      }
    }
  }

  private async negotiate(): Promise<void> {
    if (this.closed) return;
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      const d = this.pc.localDescription;
      if (d) this.o.send({ sdp: { type: d.type, sdp: d.sdp } });
    } catch (err) {
      this.o.onError("negotiation_failed", "Could not create an offer", err);
    } finally {
      this.makingOffer = false;
    }
  }

  /** Handles a `signal` from this peer. */
  async handleSignal(data: SignalData): Promise<void> {
    if (this.closed || !data) return;
    try {
      if ("sdp" in data && data.sdp) {
        const description = data.sdp as RTCSessionDescriptionInit;
        const readyForOffer =
          !this.makingOffer && (this.pc.signalingState === "stable" || this.settingRemoteAnswer);
        const offerCollision = description.type === "offer" && !readyForOffer;
        this.ignoreOffer = !this.o.polite && offerCollision;
        if (this.ignoreOffer) return;

        if (offerCollision) {
          // Polite side: roll back our own offer, then take theirs.
          await this.pc.setLocalDescription({ type: "rollback" });
        }
        this.settingRemoteAnswer = description.type === "answer";
        try {
          await this.pc.setRemoteDescription(description);
        } finally {
          this.settingRemoteAnswer = false;
        }
        await this.drainCandidates();

        if (description.type === "offer") {
          this.attachLocal();
          await this.pc.setLocalDescription();
          const d = this.pc.localDescription;
          if (d) this.o.send({ sdp: { type: d.type, sdp: d.sdp } });
        }
        return;
      }

      if ("candidate" in data) {
        const c = data.candidate;
        if (!c) return;
        if (!this.pc.remoteDescription) {
          this.pendingCandidates.push(c);
          return;
        }
        try {
          await this.pc.addIceCandidate(c);
        } catch (err) {
          if (!this.ignoreOffer) throw err;
        }
        return;
      }

      if ("restart" in data && data.restart) {
        // The other side lost the path and asks the offerer to restart ICE.
        this.restartNow();
      }
    } catch (err) {
      this.o.onError("signal_failed", "Could not apply a signal from the peer", err);
    }
  }

  private async drainCandidates(): Promise<void> {
    const list = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of list) {
      try {
        await this.pc.addIceCandidate(c);
      } catch {
        // a stale candidate from before a restart
      }
    }
  }

  private onIceState(): void {
    const s = this.pc.iceConnectionState;
    const p = this.o.platform;
    if (s === "connected" || s === "completed") {
      if (this.disconnectTimer) p.clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
      this.everConnected = true;
      this.finishRestartIfConnected(false); // the path came back: media flows again
    } else if (s === "disconnected") {
      // Often recovers by itself (a short Wi-Fi blip); restart if it lasts over 2 s.
      if (!this.disconnectTimer) {
        this.disconnectTimer = p.setTimeout(() => {
          this.disconnectTimer = null;
          if (this.pc.iceConnectionState === "disconnected") this.requestRestart();
        }, DISCONNECTED_GRACE_MS);
      }
    } else if (s === "failed") {
      this.requestRestart();
    }
  }

  /** Ends a restart (emits `reconnected`) once the path is up and negotiation is done. */
  private finishRestartIfConnected(requireStable = true): void {
    const s = this.pc.iceConnectionState;
    if (this.closed || !this.restarting || (s !== "connected" && s !== "completed")) return;
    if (requireStable && this.pc.signalingState !== "stable") return;
    const p = this.o.platform;
    if (this.checkTimer) p.clearTimeout(this.checkTimer);
    this.checkTimer = null;
    this.restarting = false;
    this.restartAttempt = 0;
    this.o.onReconnected();
  }

  /** Schedules an ICE restart with backoff (the first one at once). Tracks stay in place. */
  requestRestart(): void {
    if (this.closed || this.restartTimer) return;
    const p = this.o.platform;
    const attempt = this.restartAttempt;
    const d = attempt === 0 ? 0 : Math.min(MAX_RESTART_BACKOFF_MS, 1000 * Math.pow(2, attempt - 1));
    const delay = Math.round(d / 2 + (p.random() * d) / 2);
    this.restartTimer = p.setTimeout(() => {
      this.restartTimer = null;
      this.doRestart();
    }, delay);
  }

  /** Restart ICE right away (network changed, or the peer asked). */
  restartNow(): void {
    if (this.closed) return;
    if (this.restartTimer) {
      this.o.platform.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.doRestart();
  }

  private doRestart(): void {
    if (this.closed) return;
    const p = this.o.platform;
    this.restartAttempt += 1;
    this.restarting = true;
    this.o.onReconnecting(this.restartAttempt);

    if (this.o.initiator) {
      if (typeof this.pc.restartIce === "function") {
        // Fires negotiationneeded; the next offer carries new ICE credentials.
        this.pc.restartIce();
      } else {
        void this.legacyRestartOffer();
      }
    } else {
      this.o.send({ restart: true });
    }

    if (this.checkTimer) p.clearTimeout(this.checkTimer);
    this.checkTimer = p.setTimeout(() => {
      this.checkTimer = null;
      const s = this.pc.iceConnectionState;
      if (!this.closed && s !== "connected" && s !== "completed") this.requestRestart();
      else this.finishRestartIfConnected();
    }, RESTART_CHECK_MS);
  }

  private async legacyRestartOffer(): Promise<void> {
    try {
      this.makingOffer = true;
      const offer = await this.pc.createOffer({ iceRestart: true });
      await this.pc.setLocalDescription(offer);
      const d = this.pc.localDescription;
      if (d) this.o.send({ sdp: { type: d.type, sdp: d.sdp } });
    } catch (err) {
      this.o.onError("ice_restart_failed", "Could not restart ICE", err);
    } finally {
      this.makingOffer = false;
    }
  }

  /** The network changed (Wi-Fi ↔ cellular, back online): restart proactively once connected before. */
  onNetworkChange(): void {
    if (this.closed || !this.everConnected) return;
    if (this.o.initiator) this.restartNow();
    else this.o.send({ restart: true });
  }

  /** Applies refreshed TURN credentials without touching the running session. */
  setIceServers(iceServers: RTCIceServer[]): void {
    try {
      this.pc.setConfiguration({ ...this.pc.getConfiguration(), iceServers });
    } catch (err) {
      this.o.onError("ice_refresh_failed", "Could not apply new ICE servers", err);
    }
  }

  /**
   * Sends `track` (or nothing, with null) for `kind`: replaceTrack on the
   * existing sender — no renegotiation — or, when there is none, addTrack.
   */
  async replaceTrack(kind: "audio" | "video", track: MediaStreamTrack | null, stream: MediaStream | null): Promise<void> {
    if (this.closed) return;
    const tr = this.pc
      .getTransceivers()
      .find((t) => (t.sender.track?.kind ?? t.receiver.track?.kind) === kind && t.currentDirection !== "stopped");
    if (tr) {
      if (track && (tr.direction === "recvonly" || tr.direction === "inactive")) {
        tr.direction = tr.direction === "recvonly" ? "sendrecv" : "sendonly"; // renegotiates
      }
      await tr.sender.replaceTrack(track);
      if (track && stream && typeof (tr.sender as any).setStreams === "function") (tr.sender as any).setStreams(stream);
      return;
    }
    if (track) this.pc.addTrack(track, ...(stream ? [stream] : []));
  }

  /**
   * One stats sample; emits `connection` when the selected path changes.
   * `health` (the ~2 s checks) keeps its own interval counters, so it does
   * not disturb the 10 s quality samples.
   */
  async sample(kind: "quality" | "health" = "quality"): Promise<StatsSample | null> {
    if (this.closed) return null;
    try {
      const report = await this.pc.getStats();
      const now = this.o.platform.now();
      const s = readStats(report, now, kind === "health" ? this.healthCursor : this.statsCursor);
      if (kind === "health") {
        this.healthCursor = s.cursor;
        if (s.connection && this.firstPathAt === null) this.firstPathAt = now;
      } else this.statsCursor = s.cursor;
      if (s.connection && s.connection !== this.connection) {
        this.connection = s.connection;
        this.o.onConnection(s.connection);
      }
      return s;
    } catch {
      return null;
    }
  }

  /**
   * Sets the outgoing video encoding on every video sender (never audio):
   * `encodings[0].maxBitrate`, `scaleResolutionDownBy` and `active` (false
   * pauses video without dropping the track, so resuming is instant and
   * needs no renegotiation). Does nothing when unchanged. Returns false when
   * it could not be applied yet (e.g. before negotiation) — try again later.
   */
  async applyVideo(t: { maxBitrateKbps: number | null; scaleResolutionDownBy: number; active: boolean }): Promise<boolean> {
    if (this.closed) return false;
    const senders = this.pc.getSenders().filter((x) => x.track?.kind === "video");
    const key = `${t.maxBitrateKbps}|${t.scaleResolutionDownBy}|${t.active}|${senders.length}`;
    if (senders.length === 0) return true; // nothing to shape (no camera / screen)
    // Never shaped and the target is the browser's default: leave the senders alone.
    if (this.videoKey === "" && t.maxBitrateKbps === null && t.scaleResolutionDownBy <= 1 && t.active) return true;
    if (key === this.videoKey) return true;
    let ok = true;
    for (const sender of senders) {
      if (typeof sender.getParameters !== "function" || typeof sender.setParameters !== "function") continue;
      try {
        const params = sender.getParameters();
        const enc = params.encodings;
        if (!enc || enc.length === 0) {
          ok = false; // not negotiated yet
          continue;
        }
        const e = enc[0];
        if (t.maxBitrateKbps === null) delete e.maxBitrate;
        else e.maxBitrate = t.maxBitrateKbps * 1000;
        e.scaleResolutionDownBy = Math.max(1, t.scaleResolutionDownBy);
        e.active = t.active;
        await sender.setParameters(params);
      } catch {
        ok = false;
      }
    }
    if (ok) this.videoKey = key;
    return ok;
  }

  /** Forget the applied video encoding (the sender changed). */
  resetVideo(): void {
    this.videoKey = "";
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const p = this.o.platform;
    for (const t of [this.restartTimer, this.checkTimer, this.disconnectTimer, this.answererTimer]) {
      if (t) p.clearTimeout(t);
    }
    this.pc.onnegotiationneeded = this.pc.onicecandidate = this.pc.ontrack = this.pc.onsignalingstatechange = null;
    this.pc.oniceconnectionstatechange = this.pc.onconnectionstatechange = null;
    this.pc.ondatachannel = null;
    for (const ch of [this.reliableChannel, this.unreliableChannel]) {
      if (!ch) continue;
      ch.onmessage = ch.onopen = ch.onclose = null;
      try {
        ch.close();
      } catch {
        // already closed
      }
    }
    this.reliableChannel = this.unreliableChannel = null;
    try {
      this.pc.close();
    } catch {
      // already closed
    }
  }
}
