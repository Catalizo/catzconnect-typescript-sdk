// Fake browser built-ins for testing catzconnect/call in Node: WebSocket,
// RTCPeerConnection (a signaling-state machine, no real media), MediaStream,
// tracks, mediaDevices, and a manual clock.

export const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

export class Clock {
  constructor() {
    this.t = 1_000_000;
    this.seq = 0;
    this.timers = new Map();
  }
  now = () => this.t;
  setTimeout = (fn, ms = 0) => {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, fn, every: 0 });
    return id;
  };
  setInterval = (fn, ms) => {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, fn, every: ms });
    return id;
  };
  clearTimeout = (id) => this.timers.delete(id);
  clearInterval = (id) => this.timers.delete(id);
  /** Advance time, running due timers in order. */
  async tick(ms) {
    const end = this.t + ms;
    for (;;) {
      let next = null;
      for (const [id, tm] of this.timers) if (tm.at <= end && (!next || tm.at < next[1].at)) next = [id, tm];
      if (!next) break;
      const [id, tm] = next;
      this.t = tm.at;
      if (tm.every) tm.at += tm.every;
      else this.timers.delete(id);
      tm.fn();
      await flush();
    }
    this.t = end;
    await flush();
  }
}

let trackSeq = 0;
export class FakeTrack {
  constructor(kind, deviceId = `${kind}-dev-0`) {
    this.kind = kind;
    this.id = `t${++trackSeq}`;
    this.enabled = true;
    this.stopped = false;
    this.deviceId = deviceId;
    this.listeners = {};
  }
  stop() {
    this.stopped = true;
  }
  getSettings() {
    return { deviceId: this.deviceId };
  }
  addEventListener(t, f) {
    (this.listeners[t] ??= []).push(f);
  }
  fire(t) {
    for (const f of this.listeners[t] ?? []) f();
  }
}

export class FakeMediaStream {
  constructor(tracks = []) {
    this.tracks = [...tracks];
  }
  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  addTrack(t) {
    if (!this.tracks.includes(t)) this.tracks.push(t);
  }
  removeTrack(t) {
    this.tracks = this.tracks.filter((x) => x !== t);
  }
}

export function fakeMediaDevices() {
  const md = {
    gumCalls: [],
    cameras: ["cam-front", "cam-back"],
    async getUserMedia(c) {
      md.gumCalls.push(c);
      const tracks = [];
      if (c.audio) tracks.push(new FakeTrack("audio"));
      if (c.video) tracks.push(new FakeTrack("video", c.video.deviceId?.exact ?? md.cameras[0]));
      return new FakeMediaStream(tracks);
    },
    async enumerateDevices() {
      return md.cameras.map((id) => ({ kind: "videoinput", deviceId: id }));
    },
    async getDisplayMedia() {
      return new FakeMediaStream([new FakeTrack("video", "screen")]);
    },
  };
  return md;
}

let sdpSeq = 0;
export class FakePC {
  static all = [];
  constructor(config) {
    this.config = config;
    this.signalingState = "stable";
    this.iceConnectionState = "new";
    this.connectionState = "new";
    this.localDescription = null;
    this.remoteDescription = null;
    this.transceivers = [];
    this.candidates = [];
    this.restartIceCalls = 0;
    this.closed = false;
    this.stats = new Map();
    this.log = [];
    this._negPending = false;
    FakePC.all.push(this);
  }
  get signalingState() {
    return this._ss;
  }
  set signalingState(v) {
    const changed = v !== this._ss;
    this._ss = v;
    if (changed) this.onsignalingstatechange?.();
  }
  getConfiguration() {
    return this.config;
  }
  setConfiguration(c) {
    this.config = c;
    this.log.push("setConfiguration");
  }
  _needNegotiation() {
    if (this._negPending) return;
    this._negPending = true;
    setImmediate(() => {
      this._negPending = false;
      if (!this.closed && this.signalingState === "stable") this.onnegotiationneeded?.();
    });
  }
  _sender(track) {
    const sender = {
      track,
      params: { transactionId: "x", encodings: [{ active: true }] },
      setParametersCalls: 0,
      replaceTrack: async (t) => {
        sender.track = t;
        this.log.push(`replaceTrack:${t ? t.kind + ":" + t.deviceId : "null"}`);
      },
      getParameters: () => JSON.parse(JSON.stringify(sender.params)),
      setParameters: async (p) => {
        sender.params = JSON.parse(JSON.stringify(p));
        sender.setParametersCalls++;
        this.log.push(`setParameters:${sender.track?.kind}`);
      },
    };
    return sender;
  }
  addTrack(track) {
    if (this.getSenders().some((s) => s.track === track)) throw new Error("InvalidAccessError: track already added");
    let tr = this.transceivers.find((t) => t.receiver.track.kind === track.kind && !t.sender.track && t.fromRemote);
    if (tr) {
      tr.sender.track = track;
      tr.direction = "sendrecv";
    } else {
      tr = { sender: this._sender(track), receiver: { track: new FakeTrack(track.kind) }, direction: "sendrecv", currentDirection: null };
      this.transceivers.push(tr);
    }
    this._needNegotiation();
    return tr.sender;
  }
  addTransceiver(kind, init) {
    const tr = { sender: this._sender(null), receiver: { track: new FakeTrack(kind) }, direction: init?.direction ?? "sendrecv", currentDirection: null };
    this.transceivers.push(tr);
    this._needNegotiation();
    return tr;
  }
  getSenders() {
    return this.transceivers.map((t) => t.sender);
  }
  getTransceivers() {
    return this.transceivers;
  }
  async setLocalDescription(desc) {
    await null;
    if (desc?.type === "rollback") {
      this.log.push("rollback");
      this.signalingState = "stable";
      this.localDescription = null;
      return;
    }
    if (this.signalingState === "have-remote-offer") {
      this.localDescription = { type: "answer", sdp: `answer-${++sdpSeq}` };
      this.signalingState = "stable";
    } else {
      this.localDescription = { type: "offer", sdp: `offer-${++sdpSeq}${this._iceRestart ? "-icerestart" : ""}` };
      this._iceRestart = false;
      this.signalingState = "have-local-offer";
    }
    this.log.push(`setLocal:${this.localDescription.type}`);
  }
  async setRemoteDescription(desc) {
    await null;
    if (desc.type === "offer") {
      if (this.signalingState === "have-local-offer") throw new Error("InvalidStateError: glare without rollback");
      this.signalingState = "have-remote-offer";
      for (const kind of ["audio", "video"]) {
        if (!this.transceivers.some((t) => t.receiver.track.kind === kind)) {
          this.transceivers.push({ sender: this._sender(null), receiver: { track: new FakeTrack(kind) }, direction: "recvonly", currentDirection: null, fromRemote: true });
        }
      }
    } else {
      this.signalingState = "stable";
    }
    this.remoteDescription = desc;
    this.log.push(`setRemote:${desc.type}`);
  }
  async addIceCandidate(c) {
    if (!this.remoteDescription) throw new Error("no remote description");
    this.candidates.push(c);
  }
  restartIce() {
    this.restartIceCalls++;
    this._iceRestart = true;
    this._needNegotiation();
  }
  async createOffer() {
    return { type: "offer", sdp: "legacy" };
  }
  createDataChannel(label, init) {
    const ch = new FakeDataChannel(label, init);
    (this.channels ??= []).push(ch);
    this._needNegotiation();
    return ch;
  }
  /** Test helper: the remote side opened a data channel. */
  remoteChannel(label) {
    const ch = new FakeDataChannel(label, {});
    (this.channels ??= []).push(ch);
    this.ondatachannel?.({ channel: ch });
    return ch;
  }
  async getStats() {
    return this.stats;
  }
  close() {
    this.closed = true;
  }
  // test helpers
  setIce(state) {
    this.iceConnectionState = state;
    this.oniceconnectionstatechange?.();
  }
  emitCandidate(c) {
    this.onicecandidate?.({ candidate: { toJSON: () => c } });
  }
  emitTrack(kind) {
    const track = new FakeTrack(kind);
    this.ontrack?.({ track, streams: [] });
    return track;
  }
}

export class FakeDataChannel {
  constructor(label, init) {
    this.label = label;
    this.init = init;
    this.readyState = "connecting";
    this.bufferedAmount = 0;
    this.sent = [];
    this.closed = false;
  }
  send(data) {
    if (this.readyState !== "open") throw new Error("InvalidStateError: channel not open");
    if (this.failSend) throw new Error("send failed");
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = "closed";
  }
  // test helpers
  open() {
    this.readyState = "open";
    this.onopen?.();
  }
  receive(data) {
    this.onmessage?.({ data });
  }
}

export class FakeWS {
  static all = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.closed = false;
    FakeWS.all.push(this);
  }
  send(data) {
    if (this.closed) throw new Error("closed");
    this.sent.push(JSON.parse(data));
  }
  close(code) {
    this.closed = true;
    this.closeCode = code;
  }
  // server side
  receive(msg) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(code = 1006) {
    this.closed = true;
    this.onclose?.({ code });
  }
  sentOf(t) {
    return this.sent.filter((m) => m.t === t);
  }
}

export function makePlatform(clock, extra = {}) {
  const listeners = {};
  const win = {
    addEventListener: (t, f) => (listeners[t] ??= []).push(f),
    removeEventListener: (t, f) => (listeners[t] = (listeners[t] ?? []).filter((x) => x !== f)),
    fire: (t) => (listeners[t] ?? []).forEach((f) => f()),
  };
  return {
    WebSocket: FakeWS,
    RTCPeerConnection: FakePC,
    MediaStream: FakeMediaStream,
    mediaDevices: fakeMediaDevices(),
    window: win,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    now: clock.now,
    random: () => 0.5,
    ...extra,
  };
}

// As the server sends it: hello has STUN only; TURN credentials come per call in joined.ice_servers.
export const HELLO = {
  t: "hello",
  you: "alice",
  ice_servers: [{ urls: ["stun:turn.test:3478"] }],
  ice_ttl: 3600,
  limits: { max_participants: 4, max_frame_bytes: 65536, ping_interval_secs: 15, resume_grace_secs: 30 },
  resume_all: [],
};

export const CALL_ICE = [
  { urls: ["stun:turn.test:3478"] },
  { urls: ["turn:turn.test:3478?transport=udp", "turn:turn.test:3478?transport=tcp", "turns:turn.test:5349?transport=tcp"], username: "u", credential: "p" },
];
