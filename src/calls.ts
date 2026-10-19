import { HttpClient } from "./core/http";
import { encrypt, openResponse } from "./core/crypto";
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
export const CALL_MAX_CALLEES = 49;
/** Longest external user id. */
export const CALL_USER_ID_MAX = 128;
/** Largest `metadata`, serialised as JSON (UTF-8 bytes). */
export const CALL_METADATA_MAX_BYTES = 4096;
export const CALL_TOKEN_TTL_MIN = 60;
export const CALL_TOKEN_TTL_MAX = 86400;

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

// Unicode Cc.
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

/** Throws unless `id` is a usable external user id: non-empty, ≤ 128 characters, no control characters. */
export function validateCallUserId(id: unknown, field = "user id"): string {
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(`Missing ${field}`);
  }
  if (Array.from(id).length > CALL_USER_ID_MAX) {
    throw new Error(`${field} must be at most ${CALL_USER_ID_MAX} characters`);
  }
  if (CONTROL.test(id)) {
    throw new Error(`${field} contains control characters`);
  }
  return id;
}

function validateCallId(id: unknown): string {
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error("Missing call id");
  }
  if (id.length > 128 || CONTROL.test(id)) {
    throw new Error("Invalid call id");
  }
  return id.trim();
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** The JSON body (before encryption) `calls.create` posts. Validates first, as the server does. */
export function buildCreateCallPayload(input: CreateCallInput): Record<string, unknown> {
  if (!input || typeof input !== "object") {
    throw new Error("Missing call input");
  }
  if (input.mode !== "audio" && input.mode !== "video") {
    throw new Error("'mode' must be \"audio\" or \"video\"");
  }
  const from = validateCallUserId(input.from, "'from'");
  if (!Array.isArray(input.to) || input.to.length === 0) {
    throw new Error("'to' must list at least one user id");
  }
  if (input.to.length > CALL_MAX_CALLEES) {
    throw new Error(`'to' can list at most ${CALL_MAX_CALLEES} user ids`);
  }
  const seen = new Set<string>();
  for (const u of input.to) {
    validateCallUserId(u, "'to' entry");
    if (u === from) {
      throw new Error("'to' must not include the caller ('from')");
    }
    if (seen.has(u)) {
      throw new Error(`'to' lists '${u}' twice`);
    }
    seen.add(u);
  }

  const out: Record<string, unknown> = { mode: input.mode, from, to: [...input.to] };

  if (input.engine !== undefined && input.engine !== null) {
    if (typeof input.engine !== "string" || input.engine.trim() === "") {
      throw new Error("'engine' must be \"auto\", \"catz\" or a provider id or label");
    }
    out.engine = input.engine.trim();
  }
  if (input.ring !== undefined && input.ring !== null) {
    if (typeof input.ring !== "boolean") throw new Error("'ring' must be a boolean");
    out.ring = input.ring;
  }
  if (input.metadata !== undefined && input.metadata !== null) {
    if (typeof input.metadata !== "object" || Array.isArray(input.metadata)) {
      throw new Error("'metadata' must be a JSON object");
    }
    let json: string;
    try {
      json = JSON.stringify(input.metadata);
    } catch {
      throw new Error("'metadata' must be serialisable as JSON");
    }
    if (utf8Length(json) > CALL_METADATA_MAX_BYTES) {
      throw new Error("'metadata' must be at most 4 KB as JSON");
    }
    out.metadata = input.metadata;
  }
  if (input.maxParticipants !== undefined && input.maxParticipants !== null) {
    const n = input.maxParticipants;
    if (!Number.isInteger(n) || n < 2 || n > CALL_MAX_CALLEES + 1) {
      throw new Error(`'maxParticipants' must be a whole number from 2 to ${CALL_MAX_CALLEES + 1}`);
    }
    if (input.to.length + 1 > n) {
      throw new Error(`${input.to.length + 1} participants do not fit 'maxParticipants' ${n}`);
    }
    out.max_participants = n;
  }
  return out;
}

/** The JSON body `calls.token` posts. */
export function buildCallTokenPayload(userId: string, ttlSeconds?: number): Record<string, unknown> {
  const out: Record<string, unknown> = { user_id: validateCallUserId(userId, "'userId'") };
  if (ttlSeconds !== undefined && ttlSeconds !== null) {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < CALL_TOKEN_TTL_MIN || ttlSeconds > CALL_TOKEN_TTL_MAX) {
      throw new Error(`'ttlSeconds' must be a whole number from ${CALL_TOKEN_TTL_MIN} to ${CALL_TOKEN_TTL_MAX}`);
    }
    out.ttl_seconds = ttlSeconds;
  }
  return out;
}

/** Fields may arrive at the top level (`{success, call}`) or under `data`. */
function field<T>(res: any, name: string): T | undefined {
  if (res && typeof res === "object") {
    if (res[name] !== undefined) return res[name];
    if (res.data && typeof res.data === "object" && res.data[name] !== undefined) return res.data[name];
  }
  return undefined;
}

function needCall(res: any): Call {
  const call = field<Call>(res, "call");
  if (!call || typeof call !== "object" || typeof call.id !== "string") {
    throw new Error(`Unexpected response: no call in ${JSON.stringify(res).slice(0, 200)}`);
  }
  if (!Array.isArray(call.participants)) call.participants = [];
  return call;
}

/** `catzconnect.calls` — see {@link CreateCallInput}. */
export class CallsApi {
  constructor(private http: HttpClient = new HttpClient()) {}

  private async post(path: string, body: Record<string, unknown>, env?: EnvValues): Promise<any> {
    const enc = await encrypt(body, env);
    if (!enc) throw new Error("Encryption failed");
    const res = await this.http.request(path, enc, env);
    return openResponse(res, env);
  }

  /**
   * Creates a call and (unless `ring: false`) rings the callees. Then call
   * `calls.token(from)` and hand the token to the caller's client, which
   * joins with `client.join(call.id)`.
   */
  async create(input: CreateCallInput, env?: EnvValues): Promise<Call> {
    const res = await this.post("/sdk/calls/create", buildCreateCallPayload(input), env);
    return needCall(res);
  }

  /** Mints a user token for the browser/app client. `ttlSeconds` 60–86400, default 3600 on the server. */
  async token(userId: string, ttlSeconds?: number, env?: EnvValues): Promise<CallToken> {
    const res = await this.post("/sdk/calls/token", buildCallTokenPayload(userId, ttlSeconds), env);
    const token = field<string>(res, "token");
    if (typeof token !== "string" || token === "") {
      throw new Error("Unexpected response: no token");
    }
    return {
      token,
      expires_at: field<string | number>(res, "expires_at") ?? "",
      ws_url: field<string>(res, "ws_url") ?? "",
    };
  }

  /** Reads a call with its participants, duration, billed minutes and end reason. */
  async get(callId: string, env?: EnvValues): Promise<Call> {
    const res = await this.post("/sdk/calls/get", { call_id: validateCallId(callId) }, env);
    return needCall(res);
  }

  /** Ends a call for everyone. */
  async end(callId: string, reason?: string, env?: EnvValues): Promise<EndCallResult> {
    const body: Record<string, unknown> = { call_id: validateCallId(callId) };
    if (reason !== undefined && reason !== null) {
      if (typeof reason !== "string") throw new Error("'reason' must be a string");
      if (reason.trim() !== "") body.reason = reason.trim();
    }
    const res = await this.post("/sdk/calls/end", body, env);
    return { success: res?.success !== false, message: typeof res?.message === "string" ? res.message : "" };
  }
}
