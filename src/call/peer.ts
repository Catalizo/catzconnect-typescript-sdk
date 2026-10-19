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
}

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
  /** Last path seen in stats. */
  connection: ConnectionType | null = null;

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

    if (o.initiator) {
      this.attachLocal();
    } else {
      this.answererTimer = p.setTimeout(() => this.attachLocal(), ANSWERER_FALLBACK_MS);
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

  /** One stats sample; emits `connection` when the selected path changes. */
  async sample(): Promise<StatsSample | null> {
    if (this.closed) return null;
    try {
      const report = await this.pc.getStats();
      const s = readStats(report, this.o.platform.now(), this.statsCursor);
      this.statsCursor = s.cursor;
      if (s.connection && s.connection !== this.connection) {
        this.connection = s.connection;
        this.o.onConnection(s.connection);
      }
      return s;
    } catch {
      return null;
    }
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
    try {
      this.pc.close();
    } catch {
      // already closed
    }
  }
}
