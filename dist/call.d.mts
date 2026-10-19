/** A small typed event emitter. Listener errors are caught so one bad handler cannot break the call. */
declare class Emitter<E extends {
    [K in keyof E]: unknown;
}> {
    private handlers;
    /** Subscribe; returns a function that unsubscribes. */
    on<K extends keyof E>(event: K, fn: (payload: E[K]) => void): () => void;
    /** Subscribe for one event only. */
    once<K extends keyof E>(event: K, fn: (payload: E[K]) => void): () => void;
    off<K extends keyof E>(event: K, fn: (payload: E[K]) => void): void;
    protected emit<K extends keyof E>(event: K, payload: E[K]): void;
}

/**
 * Types for the browser call client (`catzconnect/call`) and the signaling
 * protocol it speaks (`/rtc/v1/ws`, JSON text frames `{ t, ... }`).
 */
type CallMode = "audio" | "video";
type CallStatus = "ringing" | "active" | "ended" | "missed" | "declined" | "canceled" | "failed";
type ConnectionType = "direct" | "relay";
/** An ICE server as the server hands it out (our STUN/TURN relay). */
interface IceServerInfo {
    urls: string[] | string;
    username?: string;
    credential?: string;
}
/** The call as the signaling server describes it. Unknown fields are kept. */
interface CallInfo {
    id: string;
    mode: CallMode;
    engine: string;
    from?: string;
    status?: CallStatus;
    participants?: Array<{
        user_id: string;
        role?: string;
        state?: string;
        pid?: string;
    }>;
    metadata?: Record<string, unknown> | null;
    max_participants?: number;
    [key: string]: unknown;
}
/** A remote participant in the mesh. */
interface PeerInfo {
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
interface ProviderInfo {
    name: string;
    room: string;
    token: string;
    app_id?: string;
    url?: string;
    extra?: Record<string, unknown>;
}
/** A participant of this user that is in its reconnect grace and can be resumed. */
interface ResumeInfo {
    call_id: string;
    pid: string;
}
interface HelloMessage {
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
interface JoinedMessage {
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
type SignalData = {
    sdp: {
        type: RTCSdpType;
        sdp?: string;
    };
} | {
    candidate: RTCIceCandidateInit | null;
} | {
    restart: true;
};
type ServerMessage = HelloMessage | {
    t: "incoming";
    call: CallInfo;
} | JoinedMessage | {
    t: "peer_joined";
    call_id: string;
    pid: string;
    user_id: string;
    epoch?: number;
} | {
    t: "peer_left";
    call_id: string;
    pid: string;
    user_id: string;
    reason?: string;
} | {
    t: "signal";
    call_id: string;
    from: string;
    data: SignalData;
} | {
    t: "state";
    call_id: string;
    status: CallStatus;
    reason?: string;
} | {
    t: "ice_refresh";
    call_id?: string;
    ice_servers: IceServerInfo[];
    ice_ttl?: number;
} | {
    t: "error";
    code: string;
    message: string;
    call_id?: string | null;
} | {
    t: "ping";
    ts: number;
} | {
    t: "pong";
    ts?: number | null;
};
type ClientMessage = {
    t: "join";
    call_id: string;
    media: {
        audio: boolean;
        video: boolean;
    };
    platform?: string;
} | {
    t: "accept";
    call_id: string;
    media?: {
        audio: boolean;
        video: boolean;
    };
    platform?: string;
} | {
    t: "decline";
    call_id: string;
} | {
    t: "leave";
    call_id: string;
} | {
    t: "cancel";
    call_id: string;
} | {
    t: "signal";
    call_id: string;
    to: string;
    data: SignalData;
} | {
    t: "stats";
    call_id: string;
    connection: ConnectionType;
    rtt_ms: number | null;
    jitter_ms: number | null;
    loss_pct: number | null;
    bitrate_kbps: number | null;
} | {
    t: "pong";
    ts: number;
} | {
    t: "ping";
    ts: number;
} | {
    t: "resume";
    call_id: string;
    pid: string;
};
/** One quality sample for one peer (every 10 s). */
interface PeerQuality {
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
interface IncomingCall {
    call: CallInfo;
    callId: string;
    from?: string;
    mode: CallMode;
    engine: string;
    metadata?: Record<string, unknown> | null;
}
interface JoinResult {
    call: CallInfo;
    /** This participant's id, when the server sent it. */
    pid: string | null;
    peers: PeerInfo[];
    provider?: ProviderInfo;
}
interface CallErrorEvent {
    code: string;
    message: string;
    callId?: string;
    pid?: string;
    cause?: unknown;
}
/** Every event `CatzCallClient` emits, and its payload. */
interface CatzCallEvents {
    /** Someone is calling this user (sent while the call rings). */
    incoming: IncomingCall;
    /** A call's status changed (ringing → active → ended/missed/declined/canceled/failed). */
    state: {
        callId: string;
        status: CallStatus;
        reason?: string;
    };
    "peer-joined": {
        callId: string;
        pid: string;
        userId: string;
    };
    "peer-left": {
        callId: string;
        pid: string;
        userId: string;
        reason?: string;
    };
    /** Media from a peer; `stream` is one MediaStream per peer that gains tracks. */
    track: {
        callId: string;
        pid: string;
        userId: string;
        stream: MediaStream;
        track: MediaStreamTrack;
    };
    /** The local camera/mic stream (also after switchCamera / shareScreen / stopShare). */
    "local-stream": {
        stream: MediaStream;
        screen: boolean;
    };
    /** The path to a peer: `direct` (host/srflx/prflx) or `relay` (TURN). Emitted on change. */
    connection: {
        callId: string;
        pid: string;
        userId: string;
        type: ConnectionType;
    };
    quality: PeerQuality;
    /** Signaling or a peer path dropped; the client is restoring it. The call is not over. */
    reconnecting: {
        scope: "signaling" | "peer";
        callId?: string;
        pid?: string;
        attempt: number;
    };
    reconnected: {
        scope: "signaling" | "peer";
        callId?: string;
        pid?: string;
    };
    /** The call runs on a provider engine: join it with that provider's SDK. */
    provider: {
        callId: string;
        call: CallInfo;
        provider: ProviderInfo;
    };
    error: CallErrorEvent;
    /** The client was closed (by `close()`, or because it cannot authenticate any more). */
    closed: {
        reason: string;
    };
}
/** Browser built-ins the client uses; override only in tests or unusual runtimes. */
interface CallPlatform {
    WebSocket: typeof WebSocket;
    RTCPeerConnection: typeof RTCPeerConnection;
    mediaDevices?: MediaDevices;
    MediaStream: typeof MediaStream;
    /** For `online` events. */
    window?: Pick<Window, "addEventListener" | "removeEventListener">;
    /** `navigator.connection`, when the browser has it. */
    connection?: {
        addEventListener(t: "change", f: () => void): void;
        removeEventListener(t: "change", f: () => void): void;
    };
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
    setInterval: typeof setInterval;
    clearInterval: typeof clearInterval;
    now: () => number;
    random: () => number;
}
interface CatzCallOptions {
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

/** Default signaling endpoint. */
declare const DEFAULT_CALL_URL = "wss://api.catzconnect.com/rtc/v1/ws";
interface JoinOptions {
    /** Send the microphone. Default true. */
    audio?: boolean;
    /** Send the camera. Default: true for a video call (when known from `incoming`), else false. */
    video?: boolean;
    /** Use this stream instead of asking for the camera/mic. The client does not stop its tracks on leave. */
    stream?: MediaStream;
}
declare class CatzCallClient extends Emitter<CatzCallEvents> {
    private readonly p;
    private readonly opts;
    private sig;
    private iceServers;
    private maxParticipants;
    private call;
    private links;
    private ringing;
    private localStream;
    private ownsLocalStream;
    private screenTrack;
    private cameraTrack;
    private muted;
    private pendingJoin;
    private statsTimer;
    private downAt;
    private resumeTimer;
    private closedForGood;
    private connecting;
    private readonly onNetwork;
    constructor(options?: CatzCallOptions);
    /** True while the signaling socket is open. */
    get connected(): boolean;
    /** The call this client is in, or null. */
    get callId(): string | null;
    /** This participant's id in the current call (when the server sent it). */
    get pid(): string | null;
    /** The local camera/mic stream, once acquired. */
    get localMediaStream(): MediaStream | null;
    /** Remote participants in the current call. */
    get peers(): PeerInfo[];
    /** Remote stream for a participant. */
    remoteStream(pid: string): MediaStream | null;
    /** Opens signaling and waits for the server's `hello`. Safe to call more than once. */
    connect(): Promise<void>;
    private send;
    /** ICE servers for the current call: the call's own (with TURN) or, before `joined`, hello's STUN. */
    private callIce;
    private applyIce;
    private onOpen;
    private onDown;
    /** The grace ran out or the server refused the resume: join again with a new pid, keeping local media. */
    private rejoin;
    private networkChanged;
    private onMessage;
    private onJoined;
    private settleJoin;
    private failJoin;
    private createLink;
    private ensureLocalMedia;
    private sendJoin;
    private prepareJoin;
    /**
     * Joins a call: the caller after creating it on the backend, or anyone
     * invited. Resolves with the call, this participant's pid and the peers
     * already in it. For a provider-engine call it resolves with `provider`
     * (and emits `provider`) instead of opening peer connections.
     */
    join(callId: string, options?: JoinOptions): Promise<JoinResult>;
    /** Answers an `incoming` call (an alias of join for callees). */
    accept(callId: string, options?: JoinOptions): Promise<JoinResult>;
    /** Declines an `incoming` call. */
    decline(callId: string): void;
    /** The caller hangs up while it is still ringing. */
    cancel(callId?: string): void;
    /** Leaves the current call and releases the camera and microphone. */
    leave(): void;
    /** Mutes or unmutes the microphone (`audio`) or camera (`video`) without renegotiating. */
    setMuted(kind: "audio" | "video", muted: boolean): void;
    /** True when that kind is muted. */
    isMuted(kind: "audio" | "video"): boolean;
    /** Switches to the next camera (front/back on phones) with replaceTrack. */
    switchCamera(): Promise<void>;
    /** Shares the screen in place of the camera (replaceTrack; adds a video track in an audio call). */
    shareScreen(): Promise<void>;
    /** Stops sharing and puts the camera back (or sends no video if there was none). */
    stopShare(): Promise<void>;
    private startStats;
    /** Samples every peer, emits `quality`, and sends one aggregated `stats` frame. Exposed for tests. */
    collectStats(): Promise<void>;
    private teardown;
    private shutdown;
    /** Leaves any call, closes signaling and stops all timers. The client cannot be reused. */
    close(): void;
}

/** Counters kept between two samples so loss and bitrate are per interval. */
interface StatsCursor {
    at: number;
    bytes: number;
    packetsLost: number;
    packetsReceived: number;
}
interface StatsSample {
    connection: ConnectionType | null;
    /** Candidate types of the selected pair, e.g. `host`/`srflx`/`relay`. */
    localType: string | null;
    remoteType: string | null;
    rttMs: number | null;
    jitterMs: number | null;
    lossPct: number | null;
    bitrateKbps: number | null;
    cursor: StatsCursor;
}
/**
 * Reads an RTCStatsReport: the selected candidate pair decides the path
 * (`relay` when either side's candidate is a TURN relay, otherwise
 * `direct`), with its round-trip time; inbound RTP gives jitter and loss;
 * transport/pair bytes give the bitrate since `prev`.
 */
declare function readStats(report: RTCStatsReport | Map<string, any>, now: number, prev?: StatsCursor): StatsSample;
/** good (< 300 ms rtt and < 3 % loss), poor (> 600 ms or > 10 %), otherwise fair. */
declare function qualityLevel(rttMs: number | null, lossPct: number | null): "good" | "fair" | "poor" | "unknown";

/** The `exp` (unix seconds) inside a `ct1.<payload>.<mac>` user token, or null. */
declare function tokenExpiry(token: string): number | null;
/** Full-jitter exponential backoff: a delay in [d/2, d] where d = min(max, base·2^attempt). */
declare function backoffDelay(attempt: number, random: () => number, base?: number, max?: number): number;

export { type CallErrorEvent, type CallInfo, type CallMode, type CallPlatform, type CallStatus, CatzCallClient, type CatzCallEvents, type CatzCallOptions, type ClientMessage, type ConnectionType, DEFAULT_CALL_URL, type IceServerInfo, type IncomingCall, type JoinOptions, type JoinResult, type PeerInfo, type PeerQuality, type ProviderInfo, type ServerMessage, type SignalData, type StatsSample, backoffDelay, qualityLevel, readStats, tokenExpiry };
