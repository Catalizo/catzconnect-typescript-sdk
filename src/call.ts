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
export {
  CallMessageError,
  DEFAULT_MESSAGE_LIMITS,
  Dedup,
  RateBucket,
  checkChat,
  checkData,
  chooseRoute,
  decodeEnvelope,
  encodeEnvelope,
  messageLimitsFrom,
  validMessageId,
  isUnsupportedMessageError,
} from "./call/messages";
export type { MessageLimits, PeerEnvelope } from "./call/messages";
export {
  AUDIO_KBPS_PER_PEER,
  CallWarningCodes,
  DEFAULT_ADAPT_OPTIONS,
  DEFAULT_NETWORK_THRESHOLDS,
  DEFAULT_WARNING_MESSAGES,
  MAX_VIDEO_KBPS,
  MIN_VIDEO_KBPS,
  SustainedFlag,
  VIDEO_LEVELS,
  VIDEO_PAUSED,
  VideoAdapter,
  defaultWarningMessage,
  levelFor,
  networkBad,
  parseWarning,
  parseWarningCleared,
  requiredKbps,
  videoBudget,
  videoTarget,
  warningSeverity,
} from "./call/warnings";
export type {
  AdaptChange,
  AdaptInput,
  AdaptOptions,
  CallWarning,
  CallWarningCleared,
  CallWarningCode,
  CallWarningSource,
  KnownCallWarningCode,
  NetworkMetrics,
  NetworkThresholds,
  VideoBudget,
  VideoTarget,
} from "./call/warnings";
export type {
  CallChatMessage,
  CallDataMessage,
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
  MessageVia,
  PeerInfo,
  PeerQuality,
  ProviderInfo,
  SendDataOptions,
  SendMessageOptions,
  SentMessage,
  ServerMessage,
  SignalData,
} from "./call/types";
