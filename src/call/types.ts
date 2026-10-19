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
  | { t: "error"; code: string; message: string; call_id?: string | null }
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
  | { t: "resume"; call_id: string; pid: string };

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
  cause?: unknown;
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
  /** The client was closed (by `close()`, or because it cannot authenticate any more). */
  closed: { reason: string };
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
  /** Signaling URL. Default `wss://api.catzconnect.com/rtc/v1/ws` (use `ws_url` from `calls.token`). */
  url?: string;
  /** How long a dropped socket may stay away and still `resume` the call. Default 30 000 ms (the server's grace). */
  resumeGraceMs?: number;
  /** Interval for `quality` events and `stats` to the server. Default 10 000 ms. */
  statsIntervalMs?: number;
  /** Extra RTCConfiguration fields (iceServers come from the server). */
  rtcConfig?: Omit<RTCConfiguration, "iceServers">;
  /** Override browser built-ins (tests). */
  platform?: Partial<CallPlatform>;
}
