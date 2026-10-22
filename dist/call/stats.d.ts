import type { ConnectionType } from "./types";
/** Counters kept between two samples so loss and bitrate are per interval. */
export interface StatsCursor {
    at: number;
    bytes: number;
    packetsLost: number;
    packetsReceived: number;
}
export interface StatsSample {
    connection: ConnectionType | null;
    /** Candidate types of the selected pair, e.g. `host`/`srflx`/`relay`. */
    localType: string | null;
    remoteType: string | null;
    rttMs: number | null;
    jitterMs: number | null;
    lossPct: number | null;
    bitrateKbps: number | null;
    /** `availableOutgoingBitrate` of the selected pair (kbps), when the browser reports it. */
    availableOutgoingKbps: number | null;
    /** Loss of what this side sends, from the peer's receiver reports (`remote-inbound-rtp` fractionLost, %). */
    remoteLossPct: number | null;
    /** True when an outbound video stream is limited by CPU (`qualityLimitationReason: "cpu"`). */
    cpuLimited: boolean;
    cursor: StatsCursor;
}
/**
 * Reads an RTCStatsReport: the selected candidate pair decides the path
 * (`relay` when either side's candidate is a TURN relay, otherwise
 * `direct`), with its round-trip time; inbound RTP gives jitter and loss;
 * transport/pair bytes give the bitrate since `prev`.
 */
export declare function readStats(report: RTCStatsReport | Map<string, any>, now: number, prev?: StatsCursor): StatsSample;
/** good (< 300 ms rtt and < 3 % loss), poor (> 600 ms or > 10 %), otherwise fair. */
export declare function qualityLevel(rttMs: number | null, lossPct: number | null): "good" | "fair" | "poor" | "unknown";
