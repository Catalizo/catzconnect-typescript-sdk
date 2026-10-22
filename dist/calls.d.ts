import { HttpClient } from "./core/http";
import { EnvValues } from "./types";
/**
 * Server-side Voice & Video calls: create a call from your backend, mint a
 * short-lived user token for the browser or app, read a call, end it.
 *
 * Every request uses the same API key, encryption and headers as `send()`.
 * The browser side lives in `catzconnect/call`.
 */
export type CallMode = "audio" | "video";
export type CallStatus = "ringing" | "active" | "ended" | "missed" | "declined" | "canceled" | "failed";
export type ParticipantState = "invited" | "ringing" | "joined" | "left" | "declined" | "missed";
/** Most callees per call (the caller is the 50th participant). */
export declare const CALL_MAX_CALLEES = 49;
/** Longest external user id. */
export declare const CALL_USER_ID_MAX = 128;
/** Largest `metadata`, serialised as JSON (UTF-8 bytes). */
export declare const CALL_METADATA_MAX_BYTES = 4096;
export declare const CALL_TOKEN_TTL_MIN = 60;
export declare const CALL_TOKEN_TTL_MAX = 86400;
export interface CreateCallInput {
    /** `"audio"` or `"video"`. */
    mode: CallMode;
    /** The caller's external user id (your user id, up to 128 characters). */
    from: string;
    /** The callees' external user ids: 1–49, unique, not including `from`. */
    to: string[];
    /**
     * `"auto"` (default: the org's setting), `"catz"` (our peer-to-peer engine),
     * or a configured provider's id or label (it must be in the key's scope).
     */
    engine?: string;
    /** Ring the callees (WebSocket + push). Default true. */
    ring?: boolean;
    /** Your own JSON object, up to 4 KB; delivered with `incoming`. */
    metadata?: Record<string, unknown>;
    /** Participant cap for this call (caller included), 2–50. */
    maxParticipants?: number;
}
export interface CallParticipant {
    user_id: string;
    role: "caller" | "callee";
    state: ParticipantState;
    joined_at?: string | null;
    left_at?: string | null;
    seconds?: number;
    connection?: "direct" | "relay" | "provider" | null;
}
export interface CallProvider {
    /** Provider row id. */
    id: string;
    /** Its label in the panel. */
    label?: string | null;
    /** Registry name: `agora`, `livekit`, … */
    name: string;
}
export interface Call {
    id: string;
    /** `"catz"` or a provider id. */
    engine: string;
    /** The configured provider when `engine` is not `catz` (null for catz). */
    provider?: CallProvider | null;
    mode: CallMode;
    status: CallStatus;
    room: string;
    participants: CallParticipant[];
    created_at: string;
    started_at?: string | null;
    ended_at?: string | null;
    duration_secs?: number | null;
    billed_minutes?: number | null;
    end_reason?: string | null;
    metadata?: Record<string, unknown> | null;
}
export interface CallToken {
    /** `ct1.…` — give it to the browser/app; it never contains your API key. */
    token: string;
    expires_at: string | number;
    /** The signaling WebSocket URL to pass to `CatzCallClient({ url })`. */
    ws_url: string;
}
export interface EndCallResult {
    success: boolean;
    message: string;
}
/** Throws unless `id` is a usable external user id: non-empty, ≤ 128 characters, no control characters. */
export declare function validateCallUserId(id: unknown, field?: string): string;
/** The JSON body (before encryption) `calls.create` posts. Validates first, as the server does. */
export declare function buildCreateCallPayload(input: CreateCallInput): Record<string, unknown>;
/** The JSON body `calls.token` posts. */
export declare function buildCallTokenPayload(userId: string, ttlSeconds?: number): Record<string, unknown>;
/** `catzconnect.calls` — see {@link CreateCallInput}. */
export declare class CallsApi {
    private http;
    constructor(http?: HttpClient);
    private post;
    /**
     * Creates a call and (unless `ring: false`) rings the callees. Then call
     * `calls.token(from)` and hand the token to the caller's client, which
     * joins with `client.join(call.id)`.
     */
    create(input: CreateCallInput, env?: EnvValues): Promise<Call>;
    /** Mints a user token for the browser/app client. `ttlSeconds` 60–86400, default 3600 on the server. */
    token(userId: string, ttlSeconds?: number, env?: EnvValues): Promise<CallToken>;
    /** Reads a call with its participants, duration, billed minutes and end reason. */
    get(callId: string, env?: EnvValues): Promise<Call>;
    /** Ends a call for everyone. */
    end(callId: string, reason?: string, env?: EnvValues): Promise<EndCallResult>;
}
