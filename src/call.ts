/**
 * `catzconnect/call` — the browser side of CatzConnect Voice & Video.
 *
 * Uses only browser built-ins (RTCPeerConnection, WebSocket, MediaDevices);
 * no Node APIs and no dependencies, so it bundles for any web app.
 *
 * Your backend creates the call and a user token with the server SDK
 * (`catzconnect.calls.create(...)`, `catzconnect.calls.token(userId)`);
 * the page connects with that token and joins.
 */
export { CatzCallClient, DEFAULT_CALL_URL } from "./call/client";
export type { JoinOptions } from "./call/client";
export { readStats, qualityLevel } from "./call/stats";
export type { StatsSample } from "./call/stats";
export { tokenExpiry, backoffDelay } from "./call/signaling";
export type {
  CallErrorEvent,
  CallInfo,
  CallMode,
  CallPlatform,
  CallStatus,
  CatzCallEvents,
  CatzCallOptions,
  ClientMessage,
  ConnectionType,
  IceServerInfo,
  IncomingCall,
  JoinResult,
  PeerInfo,
  PeerQuality,
  ProviderInfo,
  ServerMessage,
  SignalData,
} from "./call/types";
