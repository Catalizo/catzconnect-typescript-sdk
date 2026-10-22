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
export function readStats(report: RTCStatsReport | Map<string, any>, now: number, prev?: StatsCursor): StatsSample {
  const all = new Map<string, any>();
  (report as Map<string, any>).forEach((v: any, k: string) => all.set(k, v));

  let pair: any = null;
  for (const s of all.values()) {
    if (s.type === "transport" && s.selectedCandidatePairId && all.has(s.selectedCandidatePairId)) {
      pair = all.get(s.selectedCandidatePairId);
      break;
    }
  }
  if (!pair) {
    for (const s of all.values()) {
      if (s.type === "candidate-pair" && (s.selected === true || (s.nominated === true && s.state === "succeeded"))) {
        pair = s;
        break;
      }
    }
  }

  const local = pair ? all.get(pair.localCandidateId) : null;
  const remote = pair ? all.get(pair.remoteCandidateId) : null;
  const localType: string | null = local?.candidateType ?? null;
  const remoteType: string | null = remote?.candidateType ?? null;
  const connection: ConnectionType | null = pair
    ? localType === "relay" || remoteType === "relay"
      ? "relay"
      : "direct"
    : null;

  let rttMs = typeof pair?.currentRoundTripTime === "number" ? Math.round(pair.currentRoundTripTime * 1000) : null;
  const availableOutgoingKbps =
    typeof pair?.availableOutgoingBitrate === "number" && pair.availableOutgoingBitrate >= 0
      ? Math.round(pair.availableOutgoingBitrate / 1000)
      : null;

  let jitterSum = 0;
  let jitterN = 0;
  let packetsLost = 0;
  let packetsReceived = 0;
  let rtpBytes = 0;
  let cpuLimited = false;
  let remoteLossSum = 0;
  let remoteLossN = 0;
  let remoteRttMs: number | null = null;
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
      if (typeof s.roundTripTime === "number") remoteRttMs = Math.round(s.roundTripTime * 1000);
    }
  }
  if (rttMs === null) rttMs = remoteRttMs;
  const remoteLossPct = remoteLossN > 0 ? Math.round((remoteLossSum / remoteLossN) * 1000) / 10 : null;
  const bytes = pair ? (pair.bytesSent ?? 0) + (pair.bytesReceived ?? 0) : rtpBytes;
  const jitterMs = jitterN > 0 ? Math.round((jitterSum / jitterN) * 1000) : null;

  let lossPct: number | null = null;
  let bitrateKbps: number | null = null;
  if (prev) {
    const lost = packetsLost - prev.packetsLost;
    const recv = packetsReceived - prev.packetsReceived;
    if (lost >= 0 && recv >= 0 && lost + recv > 0) {
      lossPct = Math.round((lost / (lost + recv)) * 1000) / 10;
    } else if (lost + recv === 0) {
      lossPct = 0;
    }
    const ms = now - prev.at;
    const db = bytes - prev.bytes;
    if (ms > 0 && db >= 0) bitrateKbps = Math.round((db * 8) / ms);
  } else if (packetsLost + packetsReceived > 0) {
    lossPct = Math.round((packetsLost / (packetsLost + packetsReceived)) * 1000) / 10;
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
    cursor: { at: now, bytes, packetsLost, packetsReceived },
  };
}

/** good (< 300 ms rtt and < 3 % loss), poor (> 600 ms or > 10 %), otherwise fair. */
export function qualityLevel(rttMs: number | null, lossPct: number | null): "good" | "fair" | "poor" | "unknown" {
  if (rttMs === null && lossPct === null) return "unknown";
  const rtt = rttMs ?? 0;
  const loss = lossPct ?? 0;
  if (rtt > 600 || loss > 10) return "poor";
  if (rtt < 300 && loss < 3) return "good";
  return "fair";
}
