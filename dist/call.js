"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/call.ts
var call_exports = {};
__export(call_exports, {
  CatzCallClient: () => CatzCallClient,
  DEFAULT_CALL_URL: () => DEFAULT_CALL_URL,
  backoffDelay: () => backoffDelay,
  qualityLevel: () => qualityLevel,
  readStats: () => readStats,
  tokenExpiry: () => tokenExpiry
});
module.exports = __toCommonJS(call_exports);

// src/call/emitter.ts
var Emitter = class {
  constructor() {
    this.handlers = /* @__PURE__ */ new Map();
  }
  /** Subscribe; returns a function that unsubscribes. */
  on(event, fn) {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, set = /* @__PURE__ */ new Set());
    set.add(fn);
    return () => this.off(event, fn);
  }
  /** Subscribe for one event only. */
  once(event, fn) {
    const off = this.on(event, (p) => {
      off();
      fn(p);
    });
    return off;
  }
  off(event, fn) {
    this.handlers.get(event)?.delete(fn);
  }
  emit(event, payload) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        if (typeof console !== "undefined") console.error(`[catzconnect/call] '${String(event)}' listener failed`, err);
      }
    }
  }
};

// src/call/media.ts
function need(md) {
  if (!md || typeof md.getUserMedia !== "function") {
    throw new Error("This browser cannot capture media (navigator.mediaDevices is missing; pages must be served over https)");
  }
  return md;
}
async function getLocalMedia(md, req) {
  return need(md).getUserMedia({
    audio: req.audio ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false,
    video: req.video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } : false
  });
}
async function nextCamera(md, current) {
  const devices = need(md);
  const settings = current?.getSettings?.() ?? {};
  let constraints;
  const cams = (await devices.enumerateDevices()).filter((d) => d.kind === "videoinput" && d.deviceId);
  if (cams.length >= 2) {
    const i = cams.findIndex((d) => d.deviceId === settings.deviceId);
    constraints = { deviceId: { exact: cams[(i + 1) % cams.length].deviceId } };
  } else {
    constraints = { facingMode: settings.facingMode === "environment" ? "user" : "environment" };
  }
  const s = await devices.getUserMedia({ video: { ...constraints, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  const track = s.getVideoTracks()[0];
  if (!track) throw new Error("No camera track");
  return track;
}
async function getScreenTrack(md) {
  const devices = need(md);
  if (typeof devices.getDisplayMedia !== "function") {
    throw new Error("This browser cannot share the screen");
  }
  const s = await devices.getDisplayMedia({ video: true, audio: false });
  const track = s.getVideoTracks()[0];
  if (!track) throw new Error("No screen track");
  try {
    track.contentHint = "detail";
  } catch {
  }
  return track;
}

// src/call/stats.ts
function readStats(report, now, prev) {
  const all = /* @__PURE__ */ new Map();
  report.forEach((v, k) => all.set(k, v));
  let pair = null;
  for (const s of all.values()) {
    if (s.type === "transport" && s.selectedCandidatePairId && all.has(s.selectedCandidatePairId)) {
      pair = all.get(s.selectedCandidatePairId);
      break;
    }
  }
  if (!pair) {
    for (const s of all.values()) {
      if (s.type === "candidate-pair" && (s.selected === true || s.nominated === true && s.state === "succeeded")) {
        pair = s;
        break;
      }
    }
  }
  const local = pair ? all.get(pair.localCandidateId) : null;
  const remote = pair ? all.get(pair.remoteCandidateId) : null;
  const localType = local?.candidateType ?? null;
  const remoteType = remote?.candidateType ?? null;
  const connection = pair ? localType === "relay" || remoteType === "relay" ? "relay" : "direct" : null;
  const rttMs = typeof pair?.currentRoundTripTime === "number" ? Math.round(pair.currentRoundTripTime * 1e3) : null;
  let jitterSum = 0;
  let jitterN = 0;
  let packetsLost = 0;
  let packetsReceived = 0;
  let rtpBytes = 0;
  for (const s of all.values()) {
    if (s.type === "inbound-rtp") {
      if (typeof s.jitter === "number") {
        jitterSum += s.jitter;
        jitterN += 1;
      }
      packetsLost += Math.max(0, s.packetsLost ?? 0);
      packetsReceived += s.packetsReceived ?? 0;
      rtpBytes += s.bytesReceived ?? 0;
    } else if (s.type === "outbound-rtp") {
      rtpBytes += s.bytesSent ?? 0;
    }
  }
  const bytes = pair ? (pair.bytesSent ?? 0) + (pair.bytesReceived ?? 0) : rtpBytes;
  const jitterMs = jitterN > 0 ? Math.round(jitterSum / jitterN * 1e3) : null;
  let lossPct = null;
  let bitrateKbps = null;
  if (prev) {
    const lost = packetsLost - prev.packetsLost;
    const recv = packetsReceived - prev.packetsReceived;
    if (lost >= 0 && recv >= 0 && lost + recv > 0) {
      lossPct = Math.round(lost / (lost + recv) * 1e3) / 10;
    } else if (lost + recv === 0) {
      lossPct = 0;
    }
    const ms = now - prev.at;
    const db = bytes - prev.bytes;
    if (ms > 0 && db >= 0) bitrateKbps = Math.round(db * 8 / ms);
  } else if (packetsLost + packetsReceived > 0) {
    lossPct = Math.round(packetsLost / (packetsLost + packetsReceived) * 1e3) / 10;
  }
  return {
    connection,
    localType,
    remoteType,
    rttMs,
    jitterMs,
    lossPct,
    bitrateKbps,
    cursor: { at: now, bytes, packetsLost, packetsReceived }
  };
}
function qualityLevel(rttMs, lossPct) {
  if (rttMs === null && lossPct === null) return "unknown";
  const rtt = rttMs ?? 0;
  const loss = lossPct ?? 0;
  if (rtt > 600 || loss > 10) return "poor";
  if (rtt < 300 && loss < 3) return "good";
  return "fair";
}

// src/call/peer.ts
var DISCONNECTED_GRACE_MS = 2e3;
var RESTART_CHECK_MS = 1e4;
var MAX_RESTART_BACKOFF_MS = 15e3;
var ANSWERER_FALLBACK_MS = 6e3;
var PeerLink = class {
  constructor(o) {
    this.o = o;
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.settingRemoteAnswer = false;
    this.pendingCandidates = [];
    this.tracksAttached = false;
    this.closed = false;
    this.restartAttempt = 0;
    this.restarting = false;
    this.restartTimer = null;
    this.checkTimer = null;
    this.disconnectTimer = null;
    this.answererTimer = null;
    this.everConnected = false;
    /** Last path seen in stats. */
    this.connection = null;
    this.userId = o.userId;
    const p = o.platform;
    this.pc = new p.RTCPeerConnection(o.config);
    this.remoteStream = new p.MediaStream();
    this.pc.onnegotiationneeded = () => void this.negotiate();
    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) o.send({ candidate: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate });
    };
    this.pc.ontrack = (ev) => {
      const track = ev.track;
      if (!this.remoteStream.getTracks().includes(track)) {
        for (const t of this.remoteStream.getTracks()) {
          if (t.kind === track.kind && t !== track) this.remoteStream.removeTrack(t);
        }
        this.remoteStream.addTrack(track);
      }
      o.onTrack(this.remoteStream, track);
    };
    this.pc.oniceconnectionstatechange = () => this.onIceState();
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
  get iceState() {
    return this.pc.iceConnectionState;
  }
  /** Adds local tracks once. The initiator also asks for the media it lacks (receive-only). */
  attachLocal() {
    if (this.tracksAttached || this.closed) return;
    this.tracksAttached = true;
    if (this.answererTimer) this.o.platform.clearTimeout(this.answererTimer);
    this.answererTimer = null;
    const stream = this.o.local();
    const kinds = /* @__PURE__ */ new Set();
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
  async negotiate() {
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
  async handleSignal(data) {
    if (this.closed || !data) return;
    try {
      if ("sdp" in data && data.sdp) {
        const description = data.sdp;
        const readyForOffer = !this.makingOffer && (this.pc.signalingState === "stable" || this.settingRemoteAnswer);
        const offerCollision = description.type === "offer" && !readyForOffer;
        this.ignoreOffer = !this.o.polite && offerCollision;
        if (this.ignoreOffer) return;
        if (offerCollision) {
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
        this.restartNow();
      }
    } catch (err) {
      this.o.onError("signal_failed", "Could not apply a signal from the peer", err);
    }
  }
  async drainCandidates() {
    const list = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of list) {
      try {
        await this.pc.addIceCandidate(c);
      } catch {
      }
    }
  }
  onIceState() {
    const s = this.pc.iceConnectionState;
    const p = this.o.platform;
    if (s === "connected" || s === "completed") {
      if (this.disconnectTimer) p.clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
      this.everConnected = true;
      this.finishRestartIfConnected(false);
    } else if (s === "disconnected") {
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
  finishRestartIfConnected(requireStable = true) {
    const s = this.pc.iceConnectionState;
    if (this.closed || !this.restarting || s !== "connected" && s !== "completed") return;
    if (requireStable && this.pc.signalingState !== "stable") return;
    const p = this.o.platform;
    if (this.checkTimer) p.clearTimeout(this.checkTimer);
    this.checkTimer = null;
    this.restarting = false;
    this.restartAttempt = 0;
    this.o.onReconnected();
  }
  /** Schedules an ICE restart with backoff (the first one at once). Tracks stay in place. */
  requestRestart() {
    if (this.closed || this.restartTimer) return;
    const p = this.o.platform;
    const attempt = this.restartAttempt;
    const d = attempt === 0 ? 0 : Math.min(MAX_RESTART_BACKOFF_MS, 1e3 * Math.pow(2, attempt - 1));
    const delay = Math.round(d / 2 + p.random() * d / 2);
    this.restartTimer = p.setTimeout(() => {
      this.restartTimer = null;
      this.doRestart();
    }, delay);
  }
  /** Restart ICE right away (network changed, or the peer asked). */
  restartNow() {
    if (this.closed) return;
    if (this.restartTimer) {
      this.o.platform.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.doRestart();
  }
  doRestart() {
    if (this.closed) return;
    const p = this.o.platform;
    this.restartAttempt += 1;
    this.restarting = true;
    this.o.onReconnecting(this.restartAttempt);
    if (this.o.initiator) {
      if (typeof this.pc.restartIce === "function") {
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
  async legacyRestartOffer() {
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
  onNetworkChange() {
    if (this.closed || !this.everConnected) return;
    if (this.o.initiator) this.restartNow();
    else this.o.send({ restart: true });
  }
  /** Applies refreshed TURN credentials without touching the running session. */
  setIceServers(iceServers) {
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
  async replaceTrack(kind, track, stream) {
    if (this.closed) return;
    const tr = this.pc.getTransceivers().find((t) => (t.sender.track?.kind ?? t.receiver.track?.kind) === kind && t.currentDirection !== "stopped");
    if (tr) {
      if (track && (tr.direction === "recvonly" || tr.direction === "inactive")) {
        tr.direction = tr.direction === "recvonly" ? "sendrecv" : "sendonly";
      }
      await tr.sender.replaceTrack(track);
      if (track && stream && typeof tr.sender.setStreams === "function") tr.sender.setStreams(stream);
      return;
    }
    if (track) this.pc.addTrack(track, ...stream ? [stream] : []);
  }
  /** One stats sample; emits `connection` when the selected path changes. */
  async sample() {
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
  close() {
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
    }
  }
};

// src/call/signaling.ts
var AUTH_CLOSE_CODES = /* @__PURE__ */ new Set([4401, 4403]);
var OVERLOAD_CLOSE_CODE = 4008;
var AUTH_ERROR_CODES = /* @__PURE__ */ new Set(["unauthorized", "invalid_token", "token_expired", "token_revoked"]);
function isAuthCloseCode(code) {
  return typeof code === "number" && AUTH_CLOSE_CODES.has(code);
}
var SILENCE_MS = 45e3;
var MAX_BACKOFF_MS = 15e3;
var BASE_BACKOFF_MS = 500;
var MAX_QUEUE = 500;
var FIRST_CONNECT_TIMEOUT_MS = 2e4;
function isAuthErrorCode(code) {
  return typeof code === "string" && AUTH_ERROR_CODES.has(code.toLowerCase());
}
function tokenExpiry(token) {
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
function backoffDelay(attempt, random, base = BASE_BACKOFF_MS, max = MAX_BACKOFF_MS) {
  const d = Math.min(max, base * Math.pow(2, Math.max(0, attempt)));
  return Math.round(d / 2 + random() * d / 2);
}
var Signaling = class {
  constructor(url, token, getToken, p, h) {
    this.url = url;
    this.getToken = getToken;
    this.p = p;
    this.h = h;
    this.ws = null;
    this.tokenStale = false;
    this.attempt = 0;
    this.failuresBeforeHello = 0;
    this.everOpened = false;
    this.open = false;
    this.closed = false;
    this.queue = [];
    this.lastRx = 0;
    this.retryTimer = null;
    this.watchdog = null;
    this.firstConnect = null;
    this.token = token;
  }
  get isOpen() {
    return this.open;
  }
  /** Opens the first socket; resolves on the server's `hello`. Retries for up to 20 s. */
  connect() {
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
  send(msg, queue = true) {
    if (this.open && this.ws) {
      try {
        this.ws.send(JSON.stringify(msg));
        return true;
      } catch {
      }
    }
    if (queue && !this.closed) {
      this.queue.push(msg);
      if (this.queue.length > MAX_QUEUE) this.queue.shift();
    }
    return false;
  }
  /** Drops queued frames that `drop` matches (e.g. signals for a call being rejoined). */
  dropQueued(drop) {
    this.queue = this.queue.filter((m) => !drop(m));
  }
  /** Skip the backoff and reconnect now (the network came back). */
  reconnectNow() {
    if (this.closed || this.open || !this.retryTimer) return;
    this.p.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.openSocket();
  }
  /** The server refused the token (an `error` frame): fetch a new one before the next attempt. */
  markTokenStale() {
    this.tokenStale = true;
  }
  close() {
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
        ws.close(1e3, "client closed");
      } catch {
      }
    }
    if (this.firstConnect) {
      this.p.clearTimeout(this.firstConnect.timer);
      this.firstConnect.reject(new Error("The call client is closed"));
      this.firstConnect = null;
    }
  }
  fatal(code, message) {
    const fc = this.firstConnect;
    this.firstConnect = null;
    if (fc) this.p.clearTimeout(fc.timer);
    this.close();
    if (fc) fc.reject(new Error(message));
    this.h.onFatal({ code, message });
  }
  async ensureToken() {
    const exp = this.token ? tokenExpiry(this.token) : null;
    const nowS = this.p.now() / 1e3;
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
        this.h.onMessage({ t: "error", code: "token_fetch_failed", message: err?.message ?? String(err) });
        return null;
      }
    } else if (!this.token) {
      this.fatal("no_token", "Pass a token or getToken to CatzCallClient");
      return null;
    } else if (this.tokenStale || exp !== null && exp <= nowS) {
      this.fatal("token_expired", "The call token expired or was refused; pass getToken to renew it automatically");
      return null;
    }
    return this.token ?? null;
  }
  async openSocket() {
    if (this.closed) return;
    const token = await this.ensureToken();
    if (this.closed) return;
    if (token === null) {
      this.scheduleReconnect();
      return;
    }
    let ws;
    try {
      const sep = this.url.includes("?") ? "&" : "?";
      ws = new this.p.WebSocket(`${this.url}${sep}token=${encodeURIComponent(token)}`);
    } catch (err) {
      this.h.onMessage({ t: "error", code: "signaling_failed", message: err?.message ?? String(err) });
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    let saidHello = false;
    this.lastRx = this.p.now();
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.lastRx = this.p.now();
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object" || typeof msg.t !== "string") return;
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
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.open = false;
      if (this.watchdog) this.p.clearInterval(this.watchdog);
      this.watchdog = null;
      if (this.closed) return;
      if (!saidHello) this.failuresBeforeHello += 1;
      if (isAuthCloseCode(ev?.code)) this.tokenStale = true;
      if (ev?.code === OVERLOAD_CLOSE_CODE) this.attempt = Math.max(this.attempt, 3);
      this.scheduleReconnect();
    };
    ws.onerror = () => {
    };
  }
  sendRaw(ws, msg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
    }
  }
  flush() {
    const q = this.queue;
    this.queue = [];
    for (const m of q) this.send(m);
  }
  startWatchdog() {
    if (this.watchdog) this.p.clearInterval(this.watchdog);
    this.watchdog = this.p.setInterval(() => {
      if (!this.ws || this.p.now() - this.lastRx <= SILENCE_MS) return;
      const ws = this.ws;
      try {
        ws.close(4e3, "no ping");
      } catch {
      }
      ws.onclose?.call(ws, { code: 4e3 });
    }, 5e3);
  }
  scheduleReconnect() {
    if (this.closed || this.retryTimer) return;
    this.attempt += 1;
    if (this.everOpened) this.h.onDown(this.attempt);
    const delay = backoffDelay(this.attempt - 1, this.p.random);
    this.retryTimer = this.p.setTimeout(() => {
      this.retryTimer = null;
      void this.openSocket();
    }, delay);
  }
};

// src/call/client.ts
var DEFAULT_CALL_URL = "wss://api.catzconnect.com/rtc/v1/ws";
var TERMINAL = /* @__PURE__ */ new Set(["ended", "missed", "declined", "canceled", "failed"]);
var JOIN_TIMEOUT_MS = 15e3;
var RESUME_CONFIRM_MS = 5e3;
function resolvePlatform(over) {
  const g = typeof globalThis !== "undefined" ? globalThis : {};
  const nav = g.navigator;
  return {
    WebSocket: g.WebSocket,
    RTCPeerConnection: g.RTCPeerConnection,
    MediaStream: g.MediaStream,
    mediaDevices: nav?.mediaDevices,
    window: typeof g.addEventListener === "function" ? g : void 0,
    connection: nav?.connection && typeof nav.connection.addEventListener === "function" ? nav.connection : void 0,
    setTimeout: g.setTimeout.bind(g),
    clearTimeout: g.clearTimeout.bind(g),
    setInterval: g.setInterval.bind(g),
    clearInterval: g.clearInterval.bind(g),
    now: () => Date.now(),
    random: Math.random,
    ...over
  };
}
function toRtcIce(list) {
  return (list ?? []).map((s) => ({
    urls: s.urls,
    ...s.username !== void 0 ? { username: s.username } : {},
    ...s.credential !== void 0 ? { credential: s.credential } : {}
  }));
}
function ownPid(msg) {
  const m = msg;
  const pid = m.pid ?? m.you?.pid ?? m.self?.pid ?? m.call?.pid ?? m.participant?.pid;
  return typeof pid === "string" && pid !== "" ? pid : null;
}
function staleLink(link, epoch) {
  return typeof epoch === "number" && typeof link.epoch === "number" && link.epoch !== epoch;
}
var CatzCallClient = class extends Emitter {
  constructor(options = {}) {
    super();
    this.sig = null;
    this.iceServers = [];
    this.maxParticipants = 4;
    this.call = null;
    this.links = /* @__PURE__ */ new Map();
    this.ringing = /* @__PURE__ */ new Map();
    this.localStream = null;
    this.ownsLocalStream = false;
    this.screenTrack = null;
    this.cameraTrack = null;
    this.muted = { audio: false, video: false };
    this.pendingJoin = null;
    this.statsTimer = null;
    this.downAt = null;
    this.resumeTimer = null;
    this.closedForGood = false;
    this.connecting = null;
    this.onNetwork = () => this.networkChanged();
    this.opts = options;
    this.p = resolvePlatform(options.platform);
  }
  // ── state ────────────────────────────────────────────────────────────
  /** True while the signaling socket is open. */
  get connected() {
    return !!this.sig?.isOpen;
  }
  /** The call this client is in, or null. */
  get callId() {
    return this.call?.id ?? null;
  }
  /** This participant's id in the current call (when the server sent it). */
  get pid() {
    return this.call?.pid ?? null;
  }
  /** The local camera/mic stream, once acquired. */
  get localMediaStream() {
    return this.localStream;
  }
  /** Remote participants in the current call. */
  get peers() {
    return [...this.links.entries()].map(([pid, l]) => ({ pid, user_id: l.userId }));
  }
  /** Remote stream for a participant. */
  remoteStream(pid) {
    return this.links.get(pid)?.remoteStream ?? null;
  }
  // ── connection ───────────────────────────────────────────────────────
  /** Opens signaling and waits for the server's `hello`. Safe to call more than once. */
  connect() {
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
      }
    });
    this.sig = sig;
    this.p.window?.addEventListener("online", this.onNetwork);
    this.p.connection?.addEventListener("change", this.onNetwork);
    this.connecting = sig.connect().then(() => void 0).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }
  send(msg, queue = true) {
    this.sig?.send(msg, queue);
  }
  /** ICE servers for the current call: the call's own (with TURN) or, before `joined`, hello's STUN. */
  callIce() {
    return this.call?.ice ?? this.iceServers;
  }
  applyIce() {
    const rtc = toRtcIce(this.callIce());
    for (const l of this.links.values()) l.setIceServers(rtc);
  }
  onOpen(hello, reconnect) {
    this.iceServers = Array.isArray(hello.ice_servers) ? hello.ice_servers : [];
    if (hello.limits?.max_participants) this.maxParticipants = hello.limits.max_participants;
    if (!this.call?.ice) this.applyIce();
    if (!reconnect) return;
    const downFor = this.downAt === null ? 0 : this.p.now() - this.downAt;
    this.downAt = null;
    const call = this.call;
    if (call) {
      const offered = [...Array.isArray(hello.resume_all) ? hello.resume_all : [], ...hello.resume ? [hello.resume] : []];
      const r = offered.find((x) => x && x.call_id === call.id && typeof x.pid === "string");
      if (!call.pid && r) call.pid = r.pid;
      const grace = this.opts.resumeGraceMs ?? 3e4;
      if (call.pid && downFor <= grace) {
        this.send({ t: "resume", call_id: call.id, pid: call.pid });
        if (this.resumeTimer) this.p.clearTimeout(this.resumeTimer);
        this.resumeTimer = this.p.setTimeout(() => this.resumeTimer = null, RESUME_CONFIRM_MS);
      } else {
        this.rejoin("grace_expired");
      }
    }
    this.emit("reconnected", { scope: "signaling", callId: call?.id });
  }
  onDown(attempt) {
    if (this.downAt === null) this.downAt = this.p.now();
    this.emit("reconnecting", { scope: "signaling", callId: this.call?.id, attempt });
  }
  /** The grace ran out or the server refused the resume: join again with a new pid, keeping local media. */
  rejoin(reason) {
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
    this.sendJoin(call.id, "join", call.media).catch(
      (err) => this.emit("error", { code: "rejoin_failed", message: err.message, callId: call.id })
    );
  }
  networkChanged() {
    this.sig?.reconnectNow();
    for (const l of this.links.values()) l.onNetworkChange();
  }
  // ── server frames ────────────────────────────────────────────────────
  onMessage(m) {
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
          metadata: call.metadata
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
        if (!l) l = this.createLink({ pid: m.from, user_id: "" }, false);
        void l.handleSignal(m.data);
        return;
      }
      case "state": {
        if (TERMINAL.has(m.status)) this.ringing.delete(m.call_id);
        if (m.reason === "answered_elsewhere" || m.reason === "declined_elsewhere" || m.reason === "missed") this.ringing.delete(m.call_id);
        const replaced = m.reason === "joined_elsewhere" && !TERMINAL.has(m.status);
        if (this.call && m.call_id === this.call.id && (TERMINAL.has(m.status) || replaced)) {
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
        if (m.call_id && m.call_id !== this.call.id) return;
        this.call.ice = m.ice_servers;
        this.applyIce();
        return;
      }
      case "pong":
        return;
      case "error": {
        const callId = m.call_id ?? void 0;
        if (this.pendingJoin && !this.pendingJoin.silent && (!callId || callId === this.pendingJoin.callId)) {
          this.failJoin(Object.assign(new Error(m.message || m.code), { code: m.code }));
        } else if (this.resumeTimer && this.call && (!callId || callId === this.call.id) && !isAuthErrorCode(m.code)) {
          this.rejoin(m.code || "resume_failed");
        }
        if (isAuthErrorCode(m.code)) this.sig?.markTokenStale();
        this.emit("error", { code: m.code, message: m.message, callId });
        return;
      }
    }
  }
  onJoined(m) {
    const call = m.call;
    if (!call || typeof call.id !== "string") return;
    const pending = this.pendingJoin && this.pendingJoin.callId === call.id ? this.pendingJoin : null;
    if (this.resumeTimer) {
      this.p.clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    if (!pending && (!this.call || this.call.id !== call.id)) return;
    this.ringing.delete(call.id);
    const mode = call.mode === "video" ? "video" : "audio";
    const media = this.call?.id === call.id ? this.call.media : { audio: true, video: mode === "video" };
    const reqMedia = pending?.media ?? media;
    if (mode === "audio") reqMedia.video = false;
    this.call = {
      id: call.id,
      info: call,
      mode,
      pid: ownPid(m) ?? this.call?.pid ?? null,
      media: reqMedia,
      provider: m.provider,
      polite: m.polite_for ?? {},
      ice: Array.isArray(m.ice_servers) ? m.ice_servers : this.call?.id === call.id ? this.call.ice : null
    };
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
      const local = this.localStream;
      if (local) {
        for (const l of this.links.values()) {
          for (const t of local.getTracks()) void l.replaceTrack(t.kind, t, local);
        }
      }
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
          callId: call.id
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
  settleJoin(pending, r) {
    if (!pending) return;
    this.p.clearTimeout(pending.timer);
    if (this.pendingJoin === pending) this.pendingJoin = null;
    pending.resolve(r);
  }
  failJoin(err) {
    const pj = this.pendingJoin;
    if (!pj) return;
    this.pendingJoin = null;
    this.p.clearTimeout(pj.timer);
    if (this.call && this.call.id === pj.callId && this.links.size === 0) this.teardown();
    pj.reject(err);
  }
  createLink(peer, initiator) {
    const call = this.call;
    const callId = call.id;
    const pid = peer.pid;
    const polite = typeof call.polite[pid] === "boolean" ? call.polite[pid] : call.pid ? call.pid > pid : !initiator;
    const link = new PeerLink({
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
        iceServers: toRtcIce(this.callIce())
      },
      local: () => this.localStream,
      send: (data) => this.send({ t: "signal", call_id: callId, to: pid, data }),
      onTrack: (stream, track) => this.emit("track", { callId, pid, userId: link.userId, stream, track }),
      onConnection: (type) => this.emit("connection", { callId, pid, userId: link.userId, type }),
      onReconnecting: (attempt) => this.emit("reconnecting", { scope: "peer", callId, pid, attempt }),
      onReconnected: () => this.emit("reconnected", { scope: "peer", callId, pid }),
      onError: (code, message, cause) => this.emit("error", { code, message, callId, pid, cause })
    });
    if (typeof peer.epoch === "number") link.epoch = peer.epoch;
    this.links.set(pid, link);
    return link;
  }
  // ── media ────────────────────────────────────────────────────────────
  async ensureLocalMedia(req) {
    if (this.localStream || !req.audio && !req.video) return;
    try {
      this.localStream = await getLocalMedia(this.p.mediaDevices, req);
      this.ownsLocalStream = true;
    } catch (err) {
      this.emit("error", {
        code: "media_failed",
        message: err?.message ?? "Could not open the microphone or camera",
        callId: this.call?.id,
        cause: err
      });
      return;
    }
    for (const t of this.localStream.getTracks()) t.enabled = !this.muted[t.kind];
    this.emit("local-stream", { stream: this.localStream, screen: false });
  }
  // ── call actions ─────────────────────────────────────────────────────
  sendJoin(callId, verb, media, silent = false) {
    return new Promise((resolve, reject) => {
      if (this.pendingJoin) this.failJoin(new Error("Superseded by another join"));
      const timer = this.p.setTimeout(() => this.failJoin(new Error("The server did not answer the join")), JOIN_TIMEOUT_MS);
      const pj = { callId, resolve, reject, timer, silent, media: { ...media } };
      this.pendingJoin = pj;
      if (verb === "accept") this.send({ t: "accept", call_id: callId, media: { ...media }, platform: "web" });
      else this.send({ t: "join", call_id: callId, media: { ...media }, platform: "web" });
    });
  }
  async prepareJoin(callId, o) {
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
  async join(callId, options = {}) {
    const media = await this.prepareJoin(callId, options);
    return this.sendJoin(callId, "join", media);
  }
  /** Answers an `incoming` call (an alias of join for callees). */
  async accept(callId, options = {}) {
    const media = await this.prepareJoin(callId, options);
    return this.sendJoin(callId, "accept", media);
  }
  /** Declines an `incoming` call. */
  decline(callId) {
    this.ringing.delete(callId);
    this.send({ t: "decline", call_id: callId });
  }
  /** The caller hangs up while it is still ringing. */
  cancel(callId) {
    const id = callId ?? this.call?.id;
    if (!id) return;
    this.send({ t: "cancel", call_id: id });
    if (this.call?.id === id) this.teardown();
  }
  /** Leaves the current call and releases the camera and microphone. */
  leave() {
    const call = this.call;
    if (!call) return;
    this.send({ t: "leave", call_id: call.id });
    if (this.pendingJoin?.callId === call.id) this.failJoin(new Error("Left the call"));
    this.teardown();
  }
  /** Mutes or unmutes the microphone (`audio`) or camera (`video`) without renegotiating. */
  setMuted(kind, muted) {
    this.muted[kind] = muted;
    for (const t of this.localStream?.getTracks() ?? []) if (t.kind === kind) t.enabled = !muted;
    if (kind === "video" && this.cameraTrack) this.cameraTrack.enabled = !muted;
  }
  /** True when that kind is muted. */
  isMuted(kind) {
    return this.muted[kind];
  }
  /** Switches to the next camera (front/back on phones) with replaceTrack. */
  async switchCamera() {
    const stream = this.localStream;
    const current = this.cameraTrack ?? stream?.getVideoTracks()[0] ?? null;
    if (!stream || !current) throw new Error("No camera in use");
    const next = await nextCamera(this.p.mediaDevices, current);
    next.enabled = !this.muted.video;
    if (this.screenTrack) {
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
  async shareScreen() {
    if (!this.call || this.call.provider) throw new Error("Not in a peer-to-peer call");
    if (this.screenTrack) return;
    const track = await getScreenTrack(this.p.mediaDevices);
    this.screenTrack = track;
    this.cameraTrack = this.localStream?.getVideoTracks()[0] ?? null;
    track.addEventListener?.("ended", () => void this.stopShare());
    const stream = this.localStream ?? new this.p.MediaStream();
    await Promise.all([...this.links.values()].map((l) => l.replaceTrack("video", track, stream)));
    const preview = new this.p.MediaStream([...this.localStream?.getAudioTracks() ?? [], track]);
    this.emit("local-stream", { stream: preview, screen: true });
  }
  /** Stops sharing and puts the camera back (or sends no video if there was none). */
  async stopShare() {
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
  startStats() {
    if (this.statsTimer) return;
    this.statsTimer = this.p.setInterval(() => void this.collectStats(), this.opts.statsIntervalMs ?? 1e4);
  }
  /** Samples every peer, emits `quality`, and sends one aggregated `stats` frame. Exposed for tests. */
  async collectStats() {
    const call = this.call;
    if (!call) return;
    const rows = await Promise.all(
      [...this.links.entries()].map(async ([pid, l]) => ({ pid, l, s: await l.sample() }))
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
        level: qualityLevel(s.rttMs, s.lossPct)
      });
    }
    if (usable.length === 0 || this.call !== call) return;
    const avg = (xs) => {
      const v = xs.filter((x) => typeof x === "number");
      return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
    };
    const losses = usable.map((r) => r.s.lossPct).filter((x) => typeof x === "number");
    const rates = usable.map((r) => r.s.bitrateKbps).filter((x) => typeof x === "number");
    this.send(
      {
        t: "stats",
        call_id: call.id,
        connection: usable.some((r) => r.s.connection === "relay") ? "relay" : "direct",
        rtt_ms: avg(usable.map((r) => r.s.rttMs)),
        jitter_ms: avg(usable.map((r) => r.s.jitterMs)),
        loss_pct: losses.length ? Math.max(...losses) : null,
        bitrate_kbps: rates.length ? rates.reduce((a, b) => a + b, 0) : null
      },
      false
    );
  }
  // ── teardown ─────────────────────────────────────────────────────────
  teardown() {
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
  shutdown(reason) {
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
  close() {
    if (this.call) this.send({ t: "leave", call_id: this.call.id }, false);
    this.shutdown("closed");
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CatzCallClient,
  DEFAULT_CALL_URL,
  backoffDelay,
  qualityLevel,
  readStats,
  tokenExpiry
});
