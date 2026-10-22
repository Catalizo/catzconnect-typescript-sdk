import { Emitter } from "./emitter";
import type { MessageLimits } from "./messages";
import type { CallWarning } from "./warnings";
import type { CatzCallEvents, CatzCallOptions, JoinResult, PeerInfo, SendDataOptions, SendMessageOptions, SentMessage } from "./types";
/** Default signaling endpoint. */
export declare const DEFAULT_CALL_URL = "wss://api.catzconnect.com/rtc/v1/ws";
export interface JoinOptions {
    /** Send the microphone. Default true. */
    audio?: boolean;
    /** Send the camera. Default: true for a video call (when known from `incoming`), else false. */
    video?: boolean;
    /** Use this stream instead of asking for the camera/mic. The client does not stop its tracks on leave. */
    stream?: MediaStream;
    /**
     * Relay-only ICE for this call (overrides the client's `relayOnly`):
     * media goes through the TURN server only, so the other participants
     * never learn this device's IP addresses. Needs TURN on the server.
     */
    relayOnly?: boolean;
}
/**
 * Browser client for CatzConnect calls (engine `catz`: peer-to-peer WebRTC
 * mesh through our STUN/TURN relay). Uses only browser built-ins.
 *
 * ```ts
 * const client = new CatzCallClient({ getToken: () => fetch("/api/call-token").then(r => r.text()) });
 * client.on("incoming", ({ callId }) => client.accept(callId));
 * client.on("track", ({ pid, stream }) => attach(pid, stream));
 * await client.connect();
 * await client.join(callIdFromYourBackend, { audio: true, video: true });
 * ```
 *
 * The connection is kept up without hanging up: ICE prefers a direct path
 * and falls back to the relay (UDP → TCP → TLS) by itself; a failed or
 * long-disconnected path is ICE-restarted with backoff; a dropped WebSocket
 * reconnects with backoff and resumes the call within the server's 30 s
 * grace (or rejoins after it), renewing the token through `getToken`.
 */
/**
 * Whether an existing link belongs to an earlier join of that participant:
 * the server's epoch for it changed. A link without a known epoch (opened
 * by an early offer) or a message without one (older server) is kept.
 */
export declare function staleLink(link: {
    epoch?: number;
}, epoch: number | undefined): boolean;
/**
 * The RTCConfiguration for a peer connection: `relayOnly` (the join's, else
 * the client's) forces `iceTransportPolicy: "relay"`, over anything in
 * `rtcConfig`; otherwise `rtcConfig.iceTransportPolicy` or `"all"`.
 */
export declare function rtcConfigFor(opts: Pick<CatzCallOptions, "rtcConfig" | "relayOnly">, joinRelayOnly: boolean | undefined, iceServers: RTCIceServer[]): RTCConfiguration;
export declare class CatzCallClient extends Emitter<CatzCallEvents> {
    private readonly p;
    private readonly opts;
    private sig;
    private iceServers;
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
    /** `JoinOptions.relayOnly` of the last join/accept (kept for rejoins). */
    private joinRelayOnly;
    private readonly onNetwork;
    /** Active warnings of the current call, by code. */
    private warnings;
    private healthTimer;
    private healthBusy;
    private readonly netFlag;
    private readonly cpuFlag;
    private readonly adapter;
    /** In-call message caps (from `hello.limits`). */
    private msgLimits;
    private sendBucket;
    /** Per-peer rate limit on what arrives over data channels (the server limits the relay path). */
    private recvBuckets;
    /** (sender pid, message id) already delivered: a message that came both ways is emitted once. */
    private readonly seen;
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
    /** Warnings in effect for the current call (server and client), oldest first. */
    get activeWarnings(): CallWarning[];
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
    /** The in-call message caps in force (from the server's `hello`). */
    get messageLimits(): MessageLimits;
    /**
     * Sends a chat message to everyone in the call, or to one participant
     * (`to`: its pid). Goes over WebRTC data channels when they are open,
     * through the signaling server otherwise. Your own message is not echoed
     * back as a `chat` event — show it from the returned `SentMessage`.
     * Throws `CallMessageError` (`not_in_call`, `bad_request`,
     * `message_too_large`, `rate_limited`, `no_route`); a refusal by the
     * server arrives as an `error` event with `messageId`.
     */
    sendChat(text: string, options?: SendMessageOptions): SentMessage;
    /**
     * Sends app-defined data (any JSON value, at most `messageLimits.dataMaxBytes`
     * as JSON) to everyone or to one participant. `reliable: false` uses the
     * unordered, no-retransmit channel. Same delivery and errors as `sendChat`.
     */
    sendData(payload: unknown, options?: SendDataOptions): SentMessage;
    private sendMessage;
    private onRelayedMessage;
    private onPeerMessage;
    private startStats;
    private isOurCall;
    /** Adds or updates an active warning; emits `warning` when it is new (or its participant count changed). */
    private raiseWarning;
    private clientWarning;
    private clearWarning;
    private clearAllWarnings;
    /** True when some peer gets (or will get) video from this client. */
    private sendingVideo;
    /**
     * The ~2 s check behind client-side warnings and adaptive video: samples
     * every peer, raises/clears `poor_network` and `device_overloaded` (with
     * hysteresis), and shapes the outgoing video. Exposed for tests.
     */
    checkHealth(): Promise<void>;
    /** Samples every peer, emits `quality`, and sends one aggregated `stats` frame. Exposed for tests. */
    collectStats(): Promise<void>;
    private teardown;
    private shutdown;
    /** Leaves any call, closes signaling and stops all timers. The client cannot be reused. */
    close(): void;
}
