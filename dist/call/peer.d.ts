import { StatsSample } from "./stats";
import type { CallMode, CallPlatform, ConnectionType, SignalData } from "./types";
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
    /** A text message on one of the link's data channels (in-call chat / data). */
    onChannelMessage?: (raw: string) => void;
    /** A data channel opened or closed. */
    onChannelState?: () => void;
}
/**
 * One RTCPeerConnection to one remote participant, with perfect negotiation
 * (glare handled by rollback on the polite side), buffered ICE candidates,
 * and ICE restarts on failure or network change — without dropping tracks.
 */
export declare class PeerLink {
    private o;
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
    private makingOffer;
    private ignoreOffer;
    private settingRemoteAnswer;
    private pendingCandidates;
    private tracksAttached;
    private closed;
    private restartAttempt;
    private restarting;
    private restartTimer;
    private checkTimer;
    private disconnectTimer;
    private answererTimer;
    private everConnected;
    private statsCursor;
    private healthCursor;
    /** When the first health sample with a selected path was taken (bandwidth estimates ramp up after it). */
    firstPathAt: number | null;
    /** Key of the video encoding last applied with `applyVideo`. */
    private videoKey;
    /** Last path seen in stats. */
    connection: ConnectionType | null;
    /** Data channels for in-call messages (ordered + reliable, and unordered without retransmits). */
    private reliableChannel;
    private unreliableChannel;
    constructor(o: PeerLinkOptions);
    private adoptChannel;
    /** Whether a message can go to this peer over a data channel now. */
    channelOpen(reliable?: boolean): boolean;
    /** Sends one message over the data channel; false when it could not (use the server). */
    sendOnChannel(text: string, reliable?: boolean): boolean;
    get iceState(): RTCIceConnectionState;
    /** Adds local tracks once. The initiator also asks for the media it lacks (receive-only). */
    attachLocal(): void;
    private negotiate;
    /** Handles a `signal` from this peer. */
    handleSignal(data: SignalData): Promise<void>;
    private drainCandidates;
    private onIceState;
    /** Ends a restart (emits `reconnected`) once the path is up and negotiation is done. */
    private finishRestartIfConnected;
    /** Schedules an ICE restart with backoff (the first one at once). Tracks stay in place. */
    requestRestart(): void;
    /** Restart ICE right away (network changed, or the peer asked). */
    restartNow(): void;
    private doRestart;
    private legacyRestartOffer;
    /** The network changed (Wi-Fi ↔ cellular, back online): restart proactively once connected before. */
    onNetworkChange(): void;
    /** Applies refreshed TURN credentials without touching the running session. */
    setIceServers(iceServers: RTCIceServer[]): void;
    /**
     * Sends `track` (or nothing, with null) for `kind`: replaceTrack on the
     * existing sender — no renegotiation — or, when there is none, addTrack.
     */
    replaceTrack(kind: "audio" | "video", track: MediaStreamTrack | null, stream: MediaStream | null): Promise<void>;
    /**
     * One stats sample; emits `connection` when the selected path changes.
     * `health` (the ~2 s checks) keeps its own interval counters, so it does
     * not disturb the 10 s quality samples.
     */
    sample(kind?: "quality" | "health"): Promise<StatsSample | null>;
    /**
     * Sets the outgoing video encoding on every video sender (never audio):
     * `encodings[0].maxBitrate`, `scaleResolutionDownBy` and `active` (false
     * pauses video without dropping the track, so resuming is instant and
     * needs no renegotiation). Does nothing when unchanged. Returns false when
     * it could not be applied yet (e.g. before negotiation) — try again later.
     */
    applyVideo(t: {
        maxBitrateKbps: number | null;
        scaleResolutionDownBy: number;
        active: boolean;
    }): Promise<boolean>;
    /** Forget the applied video encoding (the sender changed). */
    resetVideo(): void;
    close(): void;
}
