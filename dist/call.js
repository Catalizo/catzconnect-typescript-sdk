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
  AUDIO_KBPS_PER_PEER: () => AUDIO_KBPS_PER_PEER,
  CallMessageError: () => CallMessageError,
  CallWarningCodes: () => CallWarningCodes,
  CatzCallClient: () => CatzCallClient,
  DEFAULT_ADAPT_OPTIONS: () => DEFAULT_ADAPT_OPTIONS,
  DEFAULT_CALL_URL: () => DEFAULT_CALL_URL,
  DEFAULT_MESSAGE_LIMITS: () => DEFAULT_MESSAGE_LIMITS,
  DEFAULT_NETWORK_THRESHOLDS: () => DEFAULT_NETWORK_THRESHOLDS,
  DEFAULT_WARNING_MESSAGES: () => DEFAULT_WARNING_MESSAGES,
  Dedup: () => Dedup,
  MAX_VIDEO_KBPS: () => MAX_VIDEO_KBPS,
  MIN_VIDEO_KBPS: () => MIN_VIDEO_KBPS,
  RateBucket: () => RateBucket,
  SustainedFlag: () => SustainedFlag,
  VIDEO_LEVELS: () => VIDEO_LEVELS,
  VIDEO_PAUSED: () => VIDEO_PAUSED,
  VideoAdapter: () => VideoAdapter,
  backoffDelay: () => backoffDelay,
  checkChat: () => checkChat,
  checkData: () => checkData,
  chooseRoute: () => chooseRoute,
  decodeEnvelope: () => decodeEnvelope,
  defaultWarningMessage: () => defaultWarningMessage,
  encodeEnvelope: () => encodeEnvelope,
  isUnsupportedMessageError: () => isUnsupportedMessageError,
  levelFor: () => levelFor,
  messageLimitsFrom: () => messageLimitsFrom,
  networkBad: () => networkBad,
  parseWarning: () => parseWarning,
  parseWarningCleared: () => parseWarningCleared,
  qualityLevel: () => qualityLevel,
  readStats: () => readStats,
  requiredKbps: () => requiredKbps,
  tokenExpiry: () => tokenExpiry,
  validMessageId: () => validMessageId,
  videoBudget: () => videoBudget,
  videoTarget: () => videoTarget,
  warningSeverity: () => warningSeverity
});
module.exports = __toCommonJS(call_exports);

// src/core/http.ts
var LOCAL_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "::1", "[::1]", "10.0.2.2"]);
function checkBaseUrl(raw, allowInsecure = false, what = "CATZCONNECT_BASE_URL") {
  const url = raw.trim().replace(/\/+$/, "");
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`${what} is not a valid URL: ${JSON.stringify(url)}`);
  }
  const scheme = u.protocol.toLowerCase();
  if (scheme === "https:" || scheme === "wss:") return url;
  if (scheme !== "http:" && scheme !== "ws:") {
    throw new Error(`${what} must start with https:// (got ${JSON.stringify(u.protocol)})`);
  }
  if (allowInsecure || LOCAL_HOSTS.has(u.hostname.toLowerCase())) return url;
  throw new Error(
    `${what} uses plain ${scheme.slice(0, -1)}:// to ${u.hostname}: the API key and tokens would travel unencrypted. Use https://, or set CATZCONNECT_ALLOW_INSECURE_HTTP=1 / catzconnect.setAllowInsecureHttp(true) to allow it anyway.`
  );
}

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

// src/call/messages.ts
var DEFAULT_MESSAGE_LIMITS = Object.freeze({
  chatMaxChars: 2e3,
  dataMaxBytes: 16384,
  perSec: 5,
  burst: 20,
  relay: false
});
var RELIABLE_CHANNEL = "catz-msg";
var UNRELIABLE_CHANNEL = "catz-msg-u";
var num = (v, d, min, max) => typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : d;
function messageLimitsFrom(limits) {
  const l = limits ?? {};
  const d = DEFAULT_MESSAGE_LIMITS;
  const perSec = num(l.messages_per_sec, d.perSec, 1, 1e3);
  return {
    chatMaxChars: num(l.chat_max_chars, d.chatMaxChars, 1, 1e5),
    dataMaxBytes: num(l.data_max_bytes, d.dataMaxBytes, 1, 1e6),
    perSec,
    burst: Math.max(perSec, num(l.messages_burst, d.burst, 1, 1e4)),
    relay: typeof l.messages_relay === "boolean" ? l.messages_relay : d.relay
  };
}
var CallMessageError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "CallMessageError";
  }
};
var ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
function validMessageId(id) {
  return typeof id === "string" && ID_RE.test(id);
}
function newMessageId(random, now) {
  let r = "";
  for (let i = 0; i < 12; i++) r += Math.floor(random() * 36).toString(36);
  return `${now.toString(36)}-${r}`;
}
var CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
function charCount(s) {
  let n = 0;
  for (const _ of s) n++;
  return n;
}
function utf8Length(s) {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    n += c < 128 ? 1 : c < 2048 ? 2 : c < 65536 ? 3 : 4;
  }
  return n;
}
function checkChat(text, l) {
  if (typeof text !== "string" || text.trim() === "") return new CallMessageError("bad_request", "Chat text is empty");
  if (charCount(text) > l.chatMaxChars) {
    return new CallMessageError("message_too_large", `Chat text is longer than ${l.chatMaxChars} characters`);
  }
  if (CONTROL_RE.test(text)) return new CallMessageError("bad_request", "Chat text contains control characters");
  return null;
}
function checkData(payload, l) {
  if (payload === null || payload === void 0) {
    return { error: new CallMessageError("bad_request", "Data payload is empty"), json: "" };
  }
  let json;
  try {
    json = JSON.stringify(payload);
  } catch {
    json = void 0;
  }
  if (typeof json !== "string") return { error: new CallMessageError("bad_request", "Data payload is not JSON"), json: "" };
  if (utf8Length(json) > l.dataMaxBytes) {
    return { error: new CallMessageError("message_too_large", `Data payload is larger than ${l.dataMaxBytes} bytes`), json };
  }
  return { error: null, json };
}
var RateBucket = class {
  constructor(l) {
    this.l = l;
    this.at = null;
    this.tokens = l.burst;
  }
  take(now) {
    if (this.at !== null) this.tokens = Math.min(this.l.burst, this.tokens + (now - this.at) / 1e3 * this.l.perSec);
    this.at = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
};
var Dedup = class {
  constructor(max = 1024) {
    this.max = max;
    this.keys = /* @__PURE__ */ new Set();
  }
  seen(key) {
    if (this.keys.has(key)) return true;
    this.keys.add(key);
    if (this.keys.size > this.max) {
      const first = this.keys.values().next().value;
      if (first !== void 0) this.keys.delete(first);
    }
    return false;
  }
  clear() {
    this.keys.clear();
  }
};
function encodeEnvelope(e) {
  return JSON.stringify(e);
}
function decodeEnvelope(raw, l) {
  if (typeof raw !== "string" || raw.length > 4 * (l.dataMaxBytes + l.chatMaxChars) + 1024) return null;
  let e;
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
function chooseRoute(targets, o) {
  if (!o.forceServer && targets.length > 0 && targets.every((t) => t.open)) return "p2p";
  if (o.serverRelay) return "relay";
  return !o.forceServer && targets.some((t) => t.open) ? "p2p" : "none";
}
function isUnsupportedMessageError(code, message) {
  return code === "bad_request" && typeof message === "string" && /^Unknown message type "(chat|data)"$/.test(message.trim());
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
  let rttMs = typeof pair?.currentRoundTripTime === "number" ? Math.round(pair.currentRoundTripTime * 1e3) : null;
  const availableOutgoingKbps = typeof pair?.availableOutgoingBitrate === "number" && pair.availableOutgoingBitrate >= 0 ? Math.round(pair.availableOutgoingBitrate / 1e3) : null;
  let jitterSum = 0;
  let jitterN = 0;
  let packetsLost = 0;
  let packetsReceived = 0;
  let rtpBytes = 0;
  let cpuLimited = false;
  let remoteLossSum = 0;
  let remoteLossN = 0;
  let remoteRttMs = null;
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
      if ((s.kind ?? s.mediaType) === "video" && s.qualityLimitationReason === "cpu") cpuLimited = true;
    } else if (s.type === "remote-inbound-rtp") {
      if (typeof s.fractionLost === "number" && s.fractionLost >= 0) {
        remoteLossSum += s.fractionLost;
        remoteLossN += 1;
      }
      if (typeof s.roundTripTime === "number") remoteRttMs = Math.round(s.roundTripTime * 1e3);
    }
  }
  if (rttMs === null) rttMs = remoteRttMs;
  const remoteLossPct = remoteLossN > 0 ? Math.round(remoteLossSum / remoteLossN * 1e3) / 10 : null;
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
    availableOutgoingKbps,
    remoteLossPct,
    cpuLimited,
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
var CHANNEL_BUFFER_MAX = 1 << 20;
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
    /** When the first health sample with a selected path was taken (bandwidth estimates ramp up after it). */
    this.firstPathAt = null;
    /** Key of the video encoding last applied with `applyVideo`. */
    this.videoKey = "";
    /** Last path seen in stats. */
    this.connection = null;
    /** Data channels for in-call messages (ordered + reliable, and unordered without retransmits). */
    this.reliableChannel = null;
    this.unreliableChannel = null;
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
    this.pc.ondatachannel = (ev) => this.adoptChannel(ev.channel);
    if (o.initiator && typeof this.pc.createDataChannel === "function") {
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
  adoptChannel(ch) {
    if (this.closed || !ch) return;
    if (ch.label === RELIABLE_CHANNEL) this.reliableChannel = ch;
    else if (ch.label === UNRELIABLE_CHANNEL) this.unreliableChannel = ch;
    else return;
    ch.onmessage = (ev) => {
      if (!this.closed && typeof ev.data === "string") this.o.onChannelMessage?.(ev.data);
    };
    ch.onopen = ch.onclose = () => {
      if (!this.closed) this.o.onChannelState?.();
    };
  }
  /** Whether a message can go to this peer over a data channel now. */
  channelOpen(reliable = true) {
    const ch = reliable ? this.reliableChannel : this.unreliableChannel?.readyState === "open" ? this.unreliableChannel : this.reliableChannel;
    return !this.closed && !!ch && ch.readyState === "open" && (ch.bufferedAmount ?? 0) < CHANNEL_BUFFER_MAX;
  }
  /** Sends one message over the data channel; false when it could not (use the server). */
  sendOnChannel(text, reliable = true) {
    if (!this.channelOpen(reliable)) return false;
    const ch = reliable || this.unreliableChannel?.readyState !== "open" ? this.reliableChannel : this.unreliableChannel;
    try {
      ch.send(text);
      return true;
    } catch {
      return false;
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
  /**
   * One stats sample; emits `connection` when the selected path changes.
   * `health` (the ~2 s checks) keeps its own interval counters, so it does
   * not disturb the 10 s quality samples.
   */
  async sample(kind = "quality") {
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
  async applyVideo(t) {
    if (this.closed) return false;
    const senders = this.pc.getSenders().filter((x) => x.track?.kind === "video");
    const key = `${t.maxBitrateKbps}|${t.scaleResolutionDownBy}|${t.active}|${senders.length}`;
    if (senders.length === 0) return true;
    if (this.videoKey === "" && t.maxBitrateKbps === null && t.scaleResolutionDownBy <= 1 && t.active) return true;
    if (key === this.videoKey) return true;
    let ok = true;
    for (const sender of senders) {
      if (typeof sender.getParameters !== "function" || typeof sender.setParameters !== "function") continue;
      try {
        const params = sender.getParameters();
        const enc = params.encodings;
        if (!enc || enc.length === 0) {
          ok = false;
          continue;
        }
        const e = enc[0];
        if (t.maxBitrateKbps === null) delete e.maxBitrate;
        else e.maxBitrate = t.maxBitrateKbps * 1e3;
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
  resetVideo() {
    this.videoKey = "";
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
    this.pc.ondatachannel = null;
    for (const ch of [this.reliableChannel, this.unreliableChannel]) {
      if (!ch) continue;
      ch.onmessage = ch.onopen = ch.onclose = null;
      try {
        ch.close();
      } catch {
      }
    }
    this.reliableChannel = this.unreliableChannel = null;
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

// src/call/warnings.ts
var CallWarningCodes = {
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
  VideoPaused: "video_paused"
};
var DEFAULT_WARNING_MESSAGES = {
  large_call: "Call quality may drop \u2014 many people are in this call",
  relay_busy: "The call relay is busy; the call may not connect on some networks",
  relay_unavailable: "Calls aren't available on this network right now",
  poor_network: "Your connection is weak",
  device_overloaded: "Your device is overloaded; video quality was lowered",
  video_reduced: "Video quality was lowered to fit your connection",
  video_paused: "Your video is paused to keep audio clear"
};
function defaultWarningMessage(code) {
  return DEFAULT_WARNING_MESSAGES[code] ?? `Call warning: ${code}`;
}
function warningSeverity(code) {
  return code === CallWarningCodes.VideoReduced ? "info" : "warning";
}
function parseWarning(msg, now, fallbackCallId) {
  const m = msg;
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
    ...Number.isFinite(n) && n >= 0 ? { participants: Math.round(n) } : {},
    source: "server",
    severity: warningSeverity(code),
    at: now
  };
}
function parseWarningCleared(msg, now, fallbackCallId) {
  const m = msg;
  if (!m || typeof m !== "object" || m.t !== "warning_cleared") return null;
  const code = typeof m.code === "string" ? m.code.trim() : "";
  if (!code) return null;
  const callId = typeof m.call_id === "string" && m.call_id ? m.call_id : fallbackCallId ?? "";
  if (!callId) return null;
  return { code, callId, source: "server", at: now };
}
var SustainedFlag = class {
  constructor(enterMs = 6e3, exitMs = 6e3) {
    this.enterMs = enterMs;
    this.exitMs = exitMs;
    this.active = false;
    this.since = null;
  }
  update(bad, now) {
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
  reset() {
    this.active = false;
    this.since = null;
  }
};
var DEFAULT_NETWORK_THRESHOLDS = {
  lossEnterPct: 8,
  lossExitPct: 4,
  rttEnterMs: 600,
  rttExitMs: 400,
  bitrateExitFactor: 1.2
};
var AUDIO_KBPS_PER_PEER = 40;
var MIN_VIDEO_KBPS = 150;
var MAX_VIDEO_KBPS = 1500;
function requiredKbps(peers, sendingVideo) {
  return Math.max(0, peers) * (AUDIO_KBPS_PER_PEER + (sendingVideo ? MIN_VIDEO_KBPS : 0));
}
function networkBad(m, active, t = DEFAULT_NETWORK_THRESHOLDS) {
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
var VIDEO_LEVELS = [
  { maxKbps: 1500, scaleResolutionDownBy: 1 },
  { maxKbps: 1e3, scaleResolutionDownBy: 1 },
  { maxKbps: 600, scaleResolutionDownBy: 1.5 },
  { maxKbps: 300, scaleResolutionDownBy: 2 },
  { maxKbps: 150, scaleResolutionDownBy: 3 }
];
var VIDEO_PAUSED = VIDEO_LEVELS.length;
function levelFor(perPeerKbps) {
  if (!(perPeerKbps >= MIN_VIDEO_KBPS)) return VIDEO_PAUSED;
  for (let i = 0; i < VIDEO_LEVELS.length; i++) if (perPeerKbps >= VIDEO_LEVELS[i].maxKbps) return i;
  return VIDEO_LEVELS.length - 1;
}
function videoBudget(availableKbps, peers) {
  const perPeerKbps = availableKbps / Math.max(1, peers);
  const level = levelFor(perPeerKbps);
  const maxBitrateKbps = Math.round(Math.min(MAX_VIDEO_KBPS, Math.max(MIN_VIDEO_KBPS, perPeerKbps)));
  const scaleResolutionDownBy = level === VIDEO_PAUSED ? VIDEO_LEVELS[VIDEO_LEVELS.length - 1].scaleResolutionDownBy : VIDEO_LEVELS[level].scaleResolutionDownBy;
  return { perPeerKbps, maxBitrateKbps, scaleResolutionDownBy, paused: level === VIDEO_PAUSED, level };
}
function videoTarget(level, peers) {
  if (level >= VIDEO_PAUSED) {
    const last = VIDEO_LEVELS[VIDEO_LEVELS.length - 1];
    return { level: VIDEO_PAUSED, maxBitrateKbps: last.maxKbps, scaleResolutionDownBy: last.scaleResolutionDownBy, active: false };
  }
  const l = VIDEO_LEVELS[Math.max(0, level)];
  if (level <= 0 && peers <= 1) return { level: 0, maxBitrateKbps: null, scaleResolutionDownBy: 1, active: true };
  return { level: Math.max(0, level), maxBitrateKbps: l.maxKbps, scaleResolutionDownBy: l.scaleResolutionDownBy, active: true };
}
var DEFAULT_ADAPT_OPTIONS = {
  warmupMs: 1e4,
  downAfterMs: 4e3,
  upAfterMs: 1e4,
  retryMs: 15e3,
  maxRetryMs: 6e4
};
var STAY_FACTOR = 0.75;
var UP_FACTOR = 0.85;
var PROBE_WINDOW_MS = 3e4;
var MAX_UP_DELAY_MS = 16e4;
var VideoAdapter = class {
  constructor(options = {}) {
    this.level = 0;
    this.firstAt = null;
    this.downSince = null;
    this.upSince = null;
    this.pausedAt = 0;
    this.lastUpAt = null;
    this.o = { ...DEFAULT_ADAPT_OPTIONS, ...options };
    this.retryDelay = this.o.retryMs;
    this.upDelay = this.o.upAfterMs;
  }
  get paused() {
    return this.level >= VIDEO_PAUSED;
  }
  /** True when video is below the best level (or paused). */
  get reduced() {
    return this.level > 0;
  }
  reset() {
    this.level = 0;
    this.firstAt = this.downSince = this.upSince = this.lastUpAt = null;
    this.pausedAt = 0;
    this.retryDelay = this.o.retryMs;
    this.upDelay = this.o.upAfterMs;
  }
  /** The level the budget asks for, with hysteresis around the current one. */
  wanted(per, peers) {
    if (per < MIN_VIDEO_KBPS) return VIDEO_PAUSED;
    if (peers <= 1) return 0;
    const raw = levelFor(per);
    if (raw > this.level && this.level < VIDEO_PAUSED && per >= VIDEO_LEVELS[this.level].maxKbps * STAY_FACTOR) {
      return this.level;
    }
    return raw;
  }
  /** One sample. Returns the changes to announce (in order), possibly none. */
  update(s) {
    const out = [];
    if (this.firstAt === null) this.firstAt = s.now;
    if (s.now - this.firstAt < this.o.warmupMs || s.availableKbps === null || s.peers <= 0) {
      this.downSince = this.upSince = null;
      return out;
    }
    if (this.lastUpAt !== null && s.now - this.lastUpAt >= PROBE_WINDOW_MS) {
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
        if (s.peers <= 1) up = true;
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
};

// src/call/client.ts
var DEFAULT_CALL_URL = "wss://api.catzconnect.com/rtc/v1/ws";
var TERMINAL = /* @__PURE__ */ new Set(["ended", "missed", "declined", "canceled", "failed"]);
var JOIN_TIMEOUT_MS = 15e3;
var RESUME_CONFIRM_MS = 5e3;
var ESTIMATE_WARMUP_MS = 1e4;
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
function rtcConfigFor(opts, joinRelayOnly, iceServers) {
  const relay = joinRelayOnly ?? opts.relayOnly ?? false;
  return {
    iceTransportPolicy: "all",
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
    ...opts.rtcConfig,
    ...relay ? { iceTransportPolicy: "relay" } : {},
    iceServers
  };
}
var CatzCallClient = class extends Emitter {
  constructor(options = {}) {
    super();
    this.sig = null;
    this.iceServers = [];
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
    /** `JoinOptions.relayOnly` of the last join/accept (kept for rejoins). */
    this.joinRelayOnly = void 0;
    this.onNetwork = () => this.networkChanged();
    /** Active warnings of the current call, by code. */
    this.warnings = /* @__PURE__ */ new Map();
    this.healthTimer = null;
    this.healthBusy = false;
    this.netFlag = new SustainedFlag(6e3, 6e3);
    this.cpuFlag = new SustainedFlag(6e3, 6e3);
    this.adapter = new VideoAdapter();
    /** In-call message caps (from `hello.limits`). */
    this.msgLimits = { ...DEFAULT_MESSAGE_LIMITS };
    this.sendBucket = new RateBucket(DEFAULT_MESSAGE_LIMITS);
    /** Per-peer rate limit on what arrives over data channels (the server limits the relay path). */
    this.recvBuckets = /* @__PURE__ */ new Map();
    /** (sender pid, message id) already delivered: a message that came both ways is emitted once. */
    this.seen = new Dedup(2048);
    if (options.url !== void 0) checkBaseUrl(options.url, !!options.allowInsecureHttp, "CatzCallClient url");
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
  /** Warnings in effect for the current call (server and client), oldest first. */
  get activeWarnings() {
    return [...this.warnings.values()];
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
    if (!this.call?.ice) this.applyIce();
    const limits = messageLimitsFrom(hello.limits);
    if (JSON.stringify(limits) !== JSON.stringify(this.msgLimits)) {
      this.msgLimits = limits;
      this.sendBucket = new RateBucket(limits);
      this.recvBuckets.clear();
    }
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
        this.recvBuckets.delete(m.pid);
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
      case "warning": {
        const w = parseWarning(m, this.p.now(), this.call?.id ?? this.pendingJoin?.callId);
        if (w && this.isOurCall(w.callId)) this.raiseWarning(w);
        return;
      }
      case "warning_cleared": {
        const c = parseWarningCleared(m, this.p.now(), this.call?.id ?? this.pendingJoin?.callId);
        if (c && this.isOurCall(c.callId)) this.clearWarning(c.code, "server");
        return;
      }
      case "pong":
        return;
      case "chat":
      case "data":
        this.onRelayedMessage(m);
        return;
      case "error": {
        const callId = m.call_id ?? void 0;
        if (validMessageId(m.id)) {
          this.emit("error", { code: m.code, message: m.message, callId, messageId: m.id });
          return;
        }
        if (isUnsupportedMessageError(m.code, m.message)) {
          this.msgLimits = { ...this.msgLimits, relay: false };
          this.emit("error", { code: m.code, message: m.message, callId });
          return;
        }
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
      peers.forEach((peer) => {
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
    else if (!this.call) this.clearAllWarnings();
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
      config: rtcConfigFor(this.opts, this.joinRelayOnly, toRtcIce(this.callIce())),
      local: () => this.localStream,
      send: (data) => this.send({ t: "signal", call_id: callId, to: pid, data }),
      onTrack: (stream, track) => this.emit("track", { callId, pid, userId: link.userId, stream, track }),
      onConnection: (type) => this.emit("connection", { callId, pid, userId: link.userId, type }),
      onReconnecting: (attempt) => this.emit("reconnecting", { scope: "peer", callId, pid, attempt }),
      onReconnected: () => this.emit("reconnected", { scope: "peer", callId, pid }),
      onError: (code, message, cause) => this.emit("error", { code, message, callId, pid, cause }),
      onChannelMessage: (raw) => this.onPeerMessage(callId, pid, link, raw)
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
    this.joinRelayOnly = o.relayOnly;
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
  // ── in-call messages ─────────────────────────────────────────────────
  /** The in-call message caps in force (from the server's `hello`). */
  get messageLimits() {
    return { ...this.msgLimits };
  }
  /**
   * Sends a chat message to everyone in the call, or to one participant
   * (`to`: its pid). Goes over WebRTC data channels when they are open,
   * through the signaling server otherwise. Your own message is not echoed
   * back as a `chat` event — show it from the returned `SentMessage`.
   * Throws `CallMessageError` (`not_in_call`, `bad_request`,
   * `message_too_large`, `rate_limited`, `no_route`); a refusal by the
   * server arrives as an `error` event with `messageId`.
   */
  sendChat(text, options = {}) {
    const err = checkChat(text, this.msgLimits);
    if (err) throw err;
    return this.sendMessage("chat", text, void 0, options.to, true);
  }
  /**
   * Sends app-defined data (any JSON value, at most `messageLimits.dataMaxBytes`
   * as JSON) to everyone or to one participant. `reliable: false` uses the
   * unordered, no-retransmit channel. Same delivery and errors as `sendChat`.
   */
  sendData(payload, options = {}) {
    const { error } = checkData(payload, this.msgLimits);
    if (error) throw error;
    return this.sendMessage("data", void 0, payload, options.to, options.reliable !== false);
  }
  sendMessage(kind, text, payload, to, reliable) {
    const call = this.call;
    if (!call) throw new CallMessageError("not_in_call", "Not in a call");
    if (to !== void 0 && (typeof to !== "string" || to === "" || to === call.pid)) {
      throw new CallMessageError("bad_request", "`to` must be another participant's pid");
    }
    const now = this.p.now();
    if (!this.sendBucket.take(now)) throw new CallMessageError("rate_limited", "Too many messages \u2014 slow down");
    const id = newMessageId(this.p.random, now);
    const target = to !== void 0 ? this.links.get(to) : void 0;
    const links = to !== void 0 ? target ? [target] : [] : [...this.links.values()];
    const route = chooseRoute(
      links.map((l) => ({ open: l.channelOpen(reliable) })),
      { forceServer: this.opts.messageTransport === "server" || !!call.provider, serverRelay: this.msgLimits.relay }
    );
    const sent = { id, ts: now, via: "p2p", to: to ?? null };
    if (route === "p2p") {
      const env = encodeEnvelope(
        kind === "chat" ? { v: 1, k: "chat", id, ts: now, to: to ?? null, text } : { v: 1, k: "data", id, ts: now, to: to ?? null, payload, reliable }
      );
      const missed = links.filter((l) => !l.sendOnChannel(env, reliable));
      if (missed.length === 0) return sent;
      if (!this.msgLimits.relay) {
        if (missed.length === links.length) throw new CallMessageError("no_route", "No open data channel and the server does not relay messages");
        return sent;
      }
    } else if (route === "none") {
      throw new CallMessageError("no_route", "No open data channel and the server does not relay messages");
    }
    const msg = kind === "chat" ? { t: "chat", call_id: call.id, id, text, ...to !== void 0 ? { to } : {} } : { t: "data", call_id: call.id, id, payload, ...to !== void 0 ? { to } : {} };
    this.send(msg, reliable);
    return { ...sent, via: "relay" };
  }
  onRelayedMessage(m) {
    const call = this.call;
    if (!call || m.call_id !== call.id || !validMessageId(m.id) || typeof m.from !== "string" || m.from === "") return;
    if (m.t === "chat" && typeof m.text !== "string") return;
    if (this.seen.seen(`${m.from}|${m.id}`)) return;
    const to = typeof m.to === "string" ? m.to : null;
    const base = {
      callId: call.id,
      id: m.id,
      from: m.from,
      userId: typeof m.user_id === "string" ? m.user_id : this.links.get(m.from)?.userId ?? "",
      to,
      private: to !== null,
      ts: typeof m.ts === "number" ? m.ts : this.p.now(),
      via: "relay"
    };
    if (m.t === "chat") this.emit("chat", { ...base, text: m.text });
    else this.emit("data", { ...base, payload: m.payload });
  }
  onPeerMessage(callId, pid, link, raw) {
    const call = this.call;
    if (!call || call.id !== callId || this.links.get(pid) !== link) return;
    const e = decodeEnvelope(raw, this.msgLimits);
    if (!e) return;
    if (e.to !== null && call.pid && e.to !== call.pid) return;
    let bucket = this.recvBuckets.get(pid);
    if (!bucket) this.recvBuckets.set(pid, bucket = new RateBucket(this.msgLimits));
    if (!bucket.take(this.p.now())) return;
    if (this.seen.seen(`${pid}|${e.id}`)) return;
    const base = { callId, id: e.id, from: pid, userId: link.userId, to: e.to, private: e.to !== null, ts: e.ts, via: "p2p" };
    if (e.k === "chat") this.emit("chat", { ...base, text: e.text });
    else this.emit("data", { ...base, payload: e.payload });
  }
  // ── stats ────────────────────────────────────────────────────────────
  startStats() {
    if (!this.healthTimer) {
      this.healthTimer = this.p.setInterval(() => void this.checkHealth(), this.opts.healthIntervalMs ?? 2e3);
    }
    if (this.statsTimer) return;
    this.statsTimer = this.p.setInterval(() => void this.collectStats(), this.opts.statsIntervalMs ?? 1e4);
  }
  // ── warnings ─────────────────────────────────────────────────────────
  isOurCall(callId) {
    return callId === this.call?.id || callId === this.pendingJoin?.callId;
  }
  /** Adds or updates an active warning; emits `warning` when it is new (or its participant count changed). */
  raiseWarning(w) {
    const prev = this.warnings.get(w.code);
    if (prev && prev.participants === w.participants && prev.message === w.message) return;
    this.warnings.set(w.code, prev ? { ...w, at: prev.at } : w);
    this.emit("warning", w);
  }
  clientWarning(code) {
    const callId = this.call?.id;
    if (!callId) return;
    this.raiseWarning({
      code,
      message: defaultWarningMessage(code),
      callId,
      participants: this.links.size + 1,
      source: "client",
      severity: warningSeverity(code),
      at: this.p.now()
    });
  }
  clearWarning(code, source) {
    const w = this.warnings.get(code);
    if (!w) return;
    this.warnings.delete(code);
    this.emit("warning-cleared", { code, callId: w.callId, source, at: this.p.now() });
  }
  clearAllWarnings() {
    for (const w of [...this.warnings.values()]) this.clearWarning(w.code, w.source);
  }
  /** True when some peer gets (or will get) video from this client. */
  sendingVideo() {
    for (const l of this.links.values()) {
      if (l.pc.getSenders().some((x) => x.track?.kind === "video")) return true;
    }
    return false;
  }
  /**
   * The ~2 s check behind client-side warnings and adaptive video: samples
   * every peer, raises/clears `poor_network` and `device_overloaded` (with
   * hysteresis), and shapes the outgoing video. Exposed for tests.
   */
  async checkHealth() {
    const call = this.call;
    if (!call || call.provider || this.healthBusy) return;
    this.healthBusy = true;
    try {
      const links = [...this.links.values()];
      const rows = await Promise.all(links.map(async (l) => ({ l, s: await l.sample("health") })));
      if (this.call !== call) return;
      const now = this.p.now();
      const usable = rows.filter((r) => r.s && r.s.connection);
      if (usable.length === 0) return;
      const avg = (xs) => {
        const v = xs.filter((x) => typeof x === "number");
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
      };
      const lossPct = avg(
        usable.map((r) => {
          const a = r.s.lossPct;
          const b = r.s.remoteLossPct;
          return a === null ? b : b === null ? a : Math.max(a, b);
        })
      );
      const rttMs = avg(usable.map((r) => r.s.rttMs));
      const warm = usable.filter(
        (r) => r.s.availableOutgoingKbps !== null && r.l.firstPathAt !== null && now - r.l.firstPathAt >= ESTIMATE_WARMUP_MS
      );
      const peers = links.length;
      const meanAvail = avg(warm.map((r) => r.s.availableOutgoingKbps));
      const availableKbps = meanAvail === null ? null : meanAvail * peers;
      const video = this.sendingVideo();
      const adaptive = this.opts.adaptiveVideo !== false;
      const net = this.netFlag.update(
        networkBad(
          { availableKbps, neededKbps: requiredKbps(peers, video && !(adaptive && this.adapter.paused)), lossPct, rttMs },
          this.netFlag.active
        ),
        now
      );
      if (net === "enter") this.clientWarning(CallWarningCodes.PoorNetwork);
      else if (net === "exit") this.clearWarning(CallWarningCodes.PoorNetwork, "client");
      const cpu = this.cpuFlag.update(usable.some((r) => r.s.cpuLimited), now);
      if (cpu === "enter") this.clientWarning(CallWarningCodes.DeviceOverloaded);
      else if (cpu === "exit") this.clearWarning(CallWarningCodes.DeviceOverloaded, "client");
      if (!adaptive || !video) return;
      const changes = this.adapter.update({ now, peers, availableKbps, lossPct, rttMs });
      const target = videoTarget(this.adapter.level, peers);
      await Promise.all(links.map((l) => l.applyVideo(target)));
      if (this.call !== call) return;
      for (const c of changes) {
        if (c === "reduced") this.clientWarning(CallWarningCodes.VideoReduced);
        else if (c === "restored") this.clearWarning(CallWarningCodes.VideoReduced, "client");
        else if (c === "paused") this.clientWarning(CallWarningCodes.VideoPaused);
        else if (c === "resumed") this.clearWarning(CallWarningCodes.VideoPaused, "client");
      }
    } finally {
      this.healthBusy = false;
    }
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
    if (this.healthTimer) this.p.clearInterval(this.healthTimer);
    this.healthTimer = null;
    this.netFlag.reset();
    this.cpuFlag.reset();
    this.adapter.reset();
    this.clearAllWarnings();
    if (this.resumeTimer) this.p.clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    for (const l of this.links.values()) l.close();
    this.links.clear();
    this.recvBuckets.clear();
    this.seen.clear();
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
  AUDIO_KBPS_PER_PEER,
  CallMessageError,
  CallWarningCodes,
  CatzCallClient,
  DEFAULT_ADAPT_OPTIONS,
  DEFAULT_CALL_URL,
  DEFAULT_MESSAGE_LIMITS,
  DEFAULT_NETWORK_THRESHOLDS,
  DEFAULT_WARNING_MESSAGES,
  Dedup,
  MAX_VIDEO_KBPS,
  MIN_VIDEO_KBPS,
  RateBucket,
  SustainedFlag,
  VIDEO_LEVELS,
  VIDEO_PAUSED,
  VideoAdapter,
  backoffDelay,
  checkChat,
  checkData,
  chooseRoute,
  decodeEnvelope,
  defaultWarningMessage,
  encodeEnvelope,
  isUnsupportedMessageError,
  levelFor,
  messageLimitsFrom,
  networkBad,
  parseWarning,
  parseWarningCleared,
  qualityLevel,
  readStats,
  requiredKbps,
  tokenExpiry,
  validMessageId,
  videoBudget,
  videoTarget,
  warningSeverity
});
