import type { CallWarning, CallWarningCleared } from "./warnings";

/**
 * Types for the browser call client (`catzconnect/call`) and the signaling
 * protocol it speaks (`/rtc/v1/ws`, JSON text frames `{ t, ... }`).
 */

export type CallMode = "audio" | "video";
export type CallStatus = "ringing" | "active" | "ended" | "missed" | "declined" | "canceled" | "failed";
export type ConnectionType = "direct" | "relay";

/** An ICE server as the server hands it out (our STUN/TURN relay). */
export interface IceServerInfo {
  urls: string[] | string;
  username?: string;
  credential?: string;
}

/** The call as the signaling server describes it. Unknown fields are kept. */
export interface CallInfo {
  id: string;
  mode: CallMode;
  engine: string;
  from?: string;
  status?: CallStatus;
  participants?: Array<{ user_id: string; role?: string; state?: string; pid?: string }>;
  metadata?: Record<string, unknown> | null;
  max_participants?: number;
  [key: string]: unknown;
}

/** A remote participant in the mesh. */
export interface PeerInfo {
  pid: string;
  user_id: string;
  /** Join epoch of this participant (incremented each time it joins anew, e.g. from another device). */
  epoch?: number;
}

/**
 * Hand-off data when the call runs on a provider engine (Agora, Twilio,
 * LiveKit, …). Join with that provider's own SDK using these values; this
 * client creates no peer connections for such a call.
 */
export interface ProviderInfo {
  name: string;
  room: string;
  token: string;
  app_id?: string;
  url?: string;
  extra?: Record<string, unknown>;
}

/** A participant of this user that is in its reconnect grace and can be resumed. */
export interface ResumeInfo {
  call_id: string;
  pid: string;
}

export interface HelloMessage {
  t: "hello";
  /** The external user id this token belongs to. */
  you: string;
  /** STUN only; TURN credentials come per call in `joined.ice_servers`. */
  ice_servers: IceServerInfo[];
  ice_ttl?: number;
  limits?: {
    max_participants?: number;
    max_frame_bytes?: number;
    ping_interval_secs?: number;
    resume_grace_secs?: number;
    /** In-call message caps (see `MessageLimits`). */
    chat_max_chars?: number;
    data_max_bytes?: number;
    messages_per_sec?: number;
    messages_burst?: number;
    messages_relay?: boolean;
  };
  /** The first entry of `resume_all`, absent when there is none. */
  resume?: ResumeInfo;
  resume_all?: ResumeInfo[];
}

export interface JoinedMessage {
  t: "joined";
  call: CallInfo;
  peers: PeerInfo[];
  polite_for?: Record<string, boolean>;
  provider?: ProviderInfo;
  /** This participant's id. Read from `pid`, `you.pid` or `call.pid` — whichever the server sends. */
  pid?: string;
  /** True when this answers a `resume` (no renegotiation). */
  resume?: boolean;
  /** STUN + TURN with credentials scoped to this call and pid (engine catz only). */
  ice_servers?: IceServerInfo[];
  ice_ttl?: number;
  [key: string]: unknown;
}

export type SignalData =
  | { sdp: { type: RTCSdpType; sdp?: string } }
  | { candidate: RTCIceCandidateInit | null }
  | { restart: true };

export type ServerMessage =
  | HelloMessage
  | { t: "incoming"; call: CallInfo }
  | JoinedMessage
  | { t: "peer_joined"; call_id: string; pid: string; user_id: string; epoch?: number }
  | { t: "peer_left"; call_id: string; pid: string; user_id: string; reason?: string }
  | { t: "signal"; call_id: string; from: string; data: SignalData }
  | { t: "state"; call_id: string; status: CallStatus; reason?: string }
  | { t: "ice_refresh"; call_id?: string; ice_servers: IceServerInfo[]; ice_ttl?: number }
  | { t: "error"; code: string; message: string; call_id?: string | null; id?: string | null }
  /** In-call chat relayed by the server (`from` is the sender's pid; `to` is set for a private message). */
  | { t: "chat"; call_id: string; id: string; from: string; user_id: string; to: string | null; text: string; ts: number }
  /** App data relayed by the server. */
  | { t: "data"; call_id: string; id: string; from: string; user_id: string; to: string | null; payload: unknown; ts: number }
  /** Something may degrade the call (`large_call`, `relay_busy`, `relay_unavailable`, or a newer code). */
  | { t: "warning"; call_id?: string; code: string; participants?: number; message?: string }
  | { t: "warning_cleared"; call_id?: string; code: string }
  | { t: "ping"; ts: number }
  | { t: "pong"; ts?: number | null };

export type ClientMessage =
  | { t: "join"; call_id: string; media: { audio: boolean; video: boolean }; platform?: string }
  | { t: "accept"; call_id: string; media?: { audio: boolean; video: boolean }; platform?: string }
  | { t: "decline"; call_id: string }
  | { t: "leave"; call_id: string }
  | { t: "cancel"; call_id: string }
  | { t: "signal"; call_id: string; to: string; data: SignalData }
  | {
      t: "stats";
      call_id: string;
      connection: ConnectionType;
      rtt_ms: number | null;
      jitter_ms: number | null;
      loss_pct: number | null;
      bitrate_kbps: number | null;
    }
  | { t: "pong"; ts: number }
  | { t: "ping"; ts: number }
  | { t: "resume"; call_id: string; pid: string }
  | { t: "chat"; call_id: string; id: string; text: string; to?: string }
  | { t: "data"; call_id: string; id: string; payload: unknown; to?: string };

/** One quality sample for one peer (every 10 s). */
export interface PeerQuality {
  callId: string;
  pid: string;
  userId: string;
  connection: ConnectionType | null;
  rttMs: number | null;
  jitterMs: number | null;
  lossPct: number | null;
  bitrateKbps: number | null;
  /** A rough grade from rtt and loss: good (< 300 ms, < 3 %), fair, poor (> 600 ms or > 10 %). */
  level: "good" | "fair" | "poor" | "unknown";
}

export interface IncomingCall {
  call: CallInfo;
  callId: string;
  from?: string;
  mode: CallMode;
  engine: string;
  metadata?: Record<string, unknown> | null;
}

export interface JoinResult {
  call: CallInfo;
  /** This participant's id, when the server sent it. */
  pid: string | null;
  peers: PeerInfo[];
  provider?: ProviderInfo;
}

export interface CallErrorEvent {
  code: string;
  message: string;
  callId?: string;
  pid?: string;
  /** The in-call message (chat / data) the server refused, by id. */
  messageId?: string;
  cause?: unknown;
}

/** How a message reached (or left) this client. */
export type MessageVia = "p2p" | "relay";

/** An in-call chat message from another participant. */
export interface CallChatMessage {
  callId: string;
  /** Sender-chosen id (unique per sender). */
  id: string;
  /** Sender's pid. */
  from: string;
  /** Sender's user id ("" when not known yet). */
  userId: string;
  text: string;
  /** This client's pid when the message was sent to it alone; null when sent to everyone. */
  to: string | null;
  /** True when it was sent to this participant only. */
  private: boolean;
  /** Send time, ms (the server's clock when relayed, the sender's when peer-to-peer). */
  ts: number;
  via: MessageVia;
}

/** App-defined data from another participant (any JSON value). */
export interface CallDataMessage {
  callId: string;
  id: string;
  from: string;
  userId: string;
  payload: unknown;
  to: string | null;
  private: boolean;
  ts: number;
  via: MessageVia;
}

/** What `sendChat` / `sendData` did with a message. */
export interface SentMessage {
  id: string;
  ts: number;
  /** `p2p`: over data channels; `relay`: through the server (queued while signaling reconnects). */
  via: MessageVia;
  to: string | null;
}

export interface SendMessageOptions {
  /** A participant's pid: send to that participant only. Default everyone. */
  to?: string;
}

export interface SendDataOptions extends SendMessageOptions {
  /**
   * Default true: ordered, retransmitted until delivered. False: the
   * unordered, no-retransmit channel (lower latency, may drop — cursors,
   * live positions); through the server it is not queued while signaling
   * is down.
   */
  reliable?: boolean;
}

/** Every event `CatzCallClient` emits, and its payload. */
export interface CatzCallEvents {
  /** Someone is calling this user (sent while the call rings). */
  incoming: IncomingCall;
  /** A call's status changed (ringing → active → ended/missed/declined/canceled/failed). */
  state: { callId: string; status: CallStatus; reason?: string };
  "peer-joined": { callId: string; pid: string; userId: string };
  "peer-left": { callId: string; pid: string; userId: string; reason?: string };
  /** Media from a peer; `stream` is one MediaStream per peer that gains tracks. */
  track: { callId: string; pid: string; userId: string; stream: MediaStream; track: MediaStreamTrack };
  /** The local camera/mic stream (also after switchCamera / shareScreen / stopShare). */
  "local-stream": { stream: MediaStream; screen: boolean };
  /** The path to a peer: `direct` (host/srflx/prflx) or `relay` (TURN). Emitted on change. */
  connection: { callId: string; pid: string; userId: string; type: ConnectionType };
  quality: PeerQuality;
  /** Signaling or a peer path dropped; the client is restoring it. The call is not over. */
  reconnecting: { scope: "signaling" | "peer"; callId?: string; pid?: string; attempt: number };
  reconnected: { scope: "signaling" | "peer"; callId?: string; pid?: string };
  /** The call runs on a provider engine: join it with that provider's SDK. */
  provider: { callId: string; call: CallInfo; provider: ProviderInfo };
  error: CallErrorEvent;
  /**
   * Something may degrade the call: from the server (`large_call`,
   * `relay_busy`, `relay_unavailable`) or the client's own checks
   * (`poor_network`, `device_overloaded`, `video_reduced`, `video_paused`).
   * Emitted once when it starts; see `activeWarnings`.
   */
  warning: CallWarning;
  /** A warning is over (also emitted for every active warning when the call ends). */
  "warning-cleared": CallWarningCleared;
  /** The client was closed (by `close()`, or because it cannot authenticate any more). */
  closed: { reason: string };
  /** In-call chat from another participant (your own sends are not echoed). */
  chat: CallChatMessage;
  /** App data from another participant. */
  data: CallDataMessage;
}

/** Browser built-ins the client uses; override only in tests or unusual runtimes. */
export interface CallPlatform {
  WebSocket: typeof WebSocket;
  RTCPeerConnection: typeof RTCPeerConnection;
  mediaDevices?: MediaDevices;
  MediaStream: typeof MediaStream;
  /** For `online` events. */
  window?: Pick<Window, "addEventListener" | "removeEventListener">;
  /** `navigator.connection`, when the browser has it. */
  connection?: { addEventListener(t: "change", f: () => void): void; removeEventListener(t: "change", f: () => void): void };
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  now: () => number;
  random: () => number;
}

export interface CatzCallOptions {
  /** A user token from `catzconnect.calls.token(userId)` on your backend. */
  token?: string;
  /**
   * Returns a fresh user token. Called when there is no token, when the
   * token is about to expire, and after the server refuses one — so a long
   * call survives token expiry and WebSocket reconnects.
   */
  getToken?: () => Promise<string>;
  /**
   * Signaling URL. Default `wss://api.catzconnect.com/rtc/v1/ws` (use `ws_url` from `calls.token`).
   * Must be `wss://`; `ws://` only to localhost / 127.0.0.1 / ::1 / 10.0.2.2 unless `allowInsecureHttp`.
   */
  url?: string;
  /** Accept a `ws://` signaling `url` to any host (the token travels unencrypted). Default false. */
  allowInsecureHttp?: boolean;
  /** How long a dropped socket may stay away and still `resume` the call. Default 30 000 ms (the server's grace). */
  resumeGraceMs?: number;
  /** Interval for `quality` events and `stats` to the server. Default 10 000 ms. */
  statsIntervalMs?: number;
  /** Extra RTCConfiguration fields (iceServers come from the server). */
  rtcConfig?: Omit<RTCConfiguration, "iceServers">;
  /**
   * Relay-only ICE (`iceTransportPolicy: "relay"`) for every call: media goes
   * through the TURN server only, so the other participants never learn this
   * device's IP addresses (at the cost of relayed bandwidth and latency).
   * Default false. Can be set per call with `JoinOptions.relayOnly`. Needs
   * TURN on the server; without it a relay-only call cannot connect.
   */
  relayOnly?: boolean;
  /**
   * Split the outgoing video bitrate across the peers of a peer-to-peer call
   * (clamp(available / peers, 150 kbps, 1.5 Mbps) per peer, lower resolution
   * as it shrinks) and pause video under 150 kbps per peer to keep audio
   * clear. Emits `video_reduced` / `video_paused` warnings. Audio is never
   * touched. Default true.
   */
  adaptiveVideo?: boolean;
  /** Interval of the network / CPU checks behind client-side warnings and adaptive video. Default 2 000 ms. */
  healthIntervalMs?: number;
  /**
   * How `sendChat` / `sendData` deliver: `"auto"` (default) over WebRTC data
   * channels to each peer, through the signaling server when a channel is
   * not open; `"server"` always through the server.
   */
  messageTransport?: "auto" | "server";
  /** Override browser built-ins (tests). */
  platform?: Partial<CallPlatform>;
}
