import { HttpClient, postPublic } from "./core/http";
import { encrypt } from "./core/crypto";
import { EnvValues, WhatsAppOptions } from "./types";
import { EMAIL_TOPIC_KEY } from "./core/payload";
import { checkToken as token, pushTopic } from "./devices";

// ─── error codes ─────────────────────────────────────────────────────────

/**
 * Machine codes the API sends in `code` (on `CatzApiError.code`). Branch on
 * these rather than on the human sentence, which is translated.
 */
export const ErrorCodes = {
  // Organization / platform
  ORGANIZATION_SUSPENDED: "organization_suspended",
  SENDING_PAUSED: "sending_paused",
  FEATURE_NOT_IN_PLAN: "feature_not_in_plan",
  PLAN_REQUIRED: "plan_required",
  CHANNEL_LIMIT_REACHED: "channel_limit_reached",
  DAILY_LIMIT_REACHED: "daily_limit_reached",
  MONTHLY_LIMIT_REACHED: "monthly_limit_reached",
  MINUTES_CAP_REACHED: "minutes_cap_reached",
  // API key policy
  KEY_EXPIRED: "key_expired",
  IP_NOT_ALLOWED: "ip_not_allowed",
  KEY_RATE_LIMITED: "key_rate_limited",
  KEY_SEND_LIMIT: "key_send_limit",
  NOT_ALLOWED_FOR_APP_KEYS: "not_allowed_for_app_keys",
  NOT_ALLOWED_FOR_TEST_KEYS: "not_allowed_for_test_keys",
  MANAGEMENT_SCOPE_REQUIRED: "management_scope_required",
  // WhatsApp
  WHATSAPP_INVALID_TEMPLATE: "whatsapp_invalid_template",
  WHATSAPP_TEMPLATE_NOT_APPROVED: "whatsapp_template_not_approved",
  WHATSAPP_TEMPLATE_LANGUAGE_REQUIRED: "whatsapp_template_language_required",
  WHATSAPP_INVALID_TEMPLATE_PARAMS: "whatsapp_invalid_template_params",
  WHATSAPP_INVALID_MEDIA: "whatsapp_invalid_media",
  WHATSAPP_WINDOW_CLOSED: "whatsapp_window_closed",
  // Idempotency and references
  IDEMPOTENCY_CONFLICT: "idempotency_conflict",
  IDEMPOTENCY_IN_PROGRESS: "idempotency_in_progress",
  INVALID_IDEMPOTENCY_KEY: "invalid_idempotency_key",
  INVALID_REFERENCE: "invalid_reference",
  // Lookups
  MESSAGE_NOT_FOUND: "message_not_found",
  // Hosted OTP
  OTP_INVALID: "otp_invalid",
  OTP_EXPIRED: "otp_expired",
  OTP_NOT_FOUND: "otp_not_found",
  OTP_ALREADY_VERIFIED: "otp_already_verified",
  OTP_ATTEMPTS_EXCEEDED: "otp_attempts_exceeded",
  OTP_RESEND_COOLDOWN: "otp_resend_cooldown",
  OTP_SEND_LIMIT: "otp_send_limit",
  // Management API
  UNSUPPORTED_CHANNEL: "unsupported_channel",
  UNKNOWN_OPERATION: "unknown_operation",
  INVALID_REQUEST: "invalid_request",
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  // Opt-outs, topics, push broadcasts, resends
  INVALID_TOPIC: "invalid_topic",
  TOPIC_EMAIL_ONLY: "topic_email_only",
  RECIPIENT_SUPPRESSED: "recipient_suppressed",
  WHATSAPP_OPTED_OUT: "whatsapp_opted_out",
  NOT_CANCELABLE: "not_cancelable",
  NOT_RESENDABLE: "not_resendable",
  CONTENT_GONE: "content_gone",
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** True for refusals worth retrying later with the same request. */
export function isRetryableCode(code: string | undefined): boolean {
  return (
    code === ErrorCodes.SENDING_PAUSED ||
    code === ErrorCodes.KEY_RATE_LIMITED ||
    code === ErrorCodes.KEY_SEND_LIMIT ||
    code === ErrorCodes.IDEMPOTENCY_IN_PROGRESS ||
    code === ErrorCodes.OTP_RESEND_COOLDOWN
  );
}

// ─── shared ──────────────────────────────────────────────────────────────

async function sdkPost(http: HttpClient, path: string, body: Record<string, unknown>, env?: EnvValues): Promise<any> {
  const enc = await encrypt(body, env);
  if (!enc) throw new Error("Encryption failed");
  const res = await http.request(path, enc, env);
  return res && typeof res === "object" && "data" in res ? res.data : res;
}

function str(v: unknown, field: string, max = 320): string {
  if (typeof v !== "string" || v.trim() === "") throw new Error(`Missing '${field}'`);
  if (v.length > max) throw new Error(`'${field}' must be at most ${max} characters`);
  return v.trim();
}

function optInt(v: unknown, field: string, min: number, max: number): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(`'${field}' must be a whole number from ${min} to ${max}`);
  }
  return v;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(v: unknown, field: string): string {
  if (typeof v !== "string" || !UUID_RE.test(v.trim())) throw new Error(`'${field}' must be a message id (UUID)`);
  return v.trim();
}

/** `reference` on send / otp.start: up to 128 characters, no control characters. */
export function validateReference(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error("'reference' must be a string");
  const t = v.trim();
  if (t === "") return undefined;
  if ([...t].length > 128 || /[\u0000-\u001f\u007f]/.test(t)) {
    throw new Error("'reference' must be up to 128 characters without line breaks or control characters");
  }
  return t;
}

/** An Idempotency-Key: 1–255 visible ASCII characters, no spaces. */
export function validateIdempotencyKey(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || !/^[\x21-\x7e]{1,255}$/.test(v.trim())) {
    throw new Error("'idempotencyKey' must be 1–255 visible ASCII characters without spaces");
  }
  return v.trim();
}

// ─── message status (/sdk/messages/*) ────────────────────────────────────

export type MessageChannel = "email" | "sms" | "whatsapp" | "push" | "voice";

/**
 * Normalised status: queued, deferred, sending, sent, delivered, read,
 * ringing, answered, completed, failed, undelivered, suppressed, bounced,
 * complained, unknown.
 */
export type MessageStatusName =
  | "queued" | "deferred" | "sending" | "sent" | "delivered" | "read" | "ringing" | "answered"
  | "completed" | "failed" | "undelivered" | "suppressed" | "bounced" | "complained" | "unknown";

export interface MessageEvent {
  type: string;
  at: string;
  detail?: string;
}

export interface MessageStatus {
  message_id: string;
  channel: MessageChannel;
  status: MessageStatusName | string;
  /** The channel's own word (`Sent`, `Accepted`, `NoAnswer`…). */
  provider_status: string;
  /** Email or phone in full; push tokens only by their last 8 characters. */
  to: string;
  template: string | null;
  reference: string | null;
  key_id: string | null;
  /** Sent with a test (sandbox) key. */
  test: boolean;
  error: string | null;
  created_at: string;
  updated_at: string;
  /** Push: the broadcast / topic / scheduled send it was part of. */
  broadcast_id?: string;
  /** Resent from the panel: the original message's id (the original's timeline has a `resent` event). */
  resent_from?: string;
  /** Present on `messages.get`, oldest first. */
  events?: MessageEvent[];
}

export interface ListMessagesInput {
  recipient?: string;
  reference?: string;
  /** The deliveries of one push broadcast (`data.broadcast_id` of a send with `push`). */
  broadcastId?: string;
  channel?: MessageChannel;
  /** 1–100, default 20. */
  limit?: number;
  /** The previous page's `next_before`. */
  before?: string;
}

const CHANNELS: MessageChannel[] = ["email", "sms", "whatsapp", "push", "voice"];

export function buildListMessagesPayload(input: ListMessagesInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.recipient !== undefined) out.recipient = str(input.recipient, "recipient");
  if (input.reference !== undefined) out.reference = validateReference(input.reference);
  if (input.broadcastId !== undefined) out.broadcast_id = uuid(input.broadcastId, "broadcastId");
  if (out.recipient === undefined && out.reference === undefined && out.broadcast_id === undefined) {
    throw new Error("Give 'recipient', 'reference' or 'broadcastId'");
  }
  if (input.channel !== undefined) {
    const c = String(input.channel).toLowerCase() as MessageChannel;
    if (!CHANNELS.includes(c)) throw new Error("'channel' must be email, sms, whatsapp, push or voice");
    out.channel = c;
  }
  const limit = optInt(input.limit, "limit", 1, 100);
  if (limit !== undefined) out.limit = limit;
  if (input.before !== undefined) out.before = str(input.before, "before", 64);
  return out;
}

/** `catzconnect.messages` — status and history of sent messages. */
export class MessagesApi {
  constructor(private http: HttpClient = new HttpClient()) {}

  /** One message by the `message_id` a send returned, with its event timeline. */
  async get(messageId: string, env?: EnvValues): Promise<MessageStatus> {
    return sdkPost(this.http, "/sdk/messages/get", { message_id: uuid(messageId, "messageId") }, env);
  }

  /** Recent messages to a recipient and/or with a `reference`, newest first. */
  async list(input: ListMessagesInput, env?: EnvValues): Promise<{ messages: MessageStatus[]; next_before: string | null }> {
    const d = await sdkPost(this.http, "/sdk/messages/list", buildListMessagesPayload(input), env);
    return { messages: Array.isArray(d?.messages) ? d.messages : [], next_before: d?.next_before ?? null };
  }
}

// ─── hosted OTP (/sdk/otp/*) ─────────────────────────────────────────────

export type OtpChannel = "Email" | "SMS" | "WhatsApp" | "Voice";

export interface OtpStartInput {
  channel: OtpChannel | Lowercase<OtpChannel>;
  to: string;
  /** Sending mailbox (Email) or number (WhatsApp); not used by SMS / Voice. */
  identity?: string;
  /** `Otp` (default) or one of your templates; `{{otp}}` is the code. */
  template?: string;
  language?: string;
  /** 4–10 digits (6). */
  codeLength?: number;
  /** 60–3600 s (600). */
  ttlSeconds?: number;
  /** 1–10 wrong codes allowed (5). */
  maxAttempts?: number;
  /** 10–3600 s between sends to one person (30). */
  resendCooldownSeconds?: number;
  gateway?: string;
  sender?: string;
  dltTemplateId?: string;
  provider?: string;
  whatsapp?: WhatsAppOptions;
  /** Extra template variables. */
  data?: Record<string, string>;
  reference?: string;
}

export interface OtpStartResult {
  verification_id: string;
  channel: string;
  to: string;
  status: "pending";
  expires_at: string;
  resend_available_at: string;
  attempts_remaining: number;
  sends_remaining: number;
  message_id: string | null;
  test: boolean;
  /** Test keys only: the code, since nothing is delivered. */
  code?: string;
}

export interface OtpVerifyInput {
  verificationId?: string;
  channel?: OtpChannel | Lowercase<OtpChannel>;
  to?: string;
  code: string;
}

export interface OtpVerifyResult {
  verified: true;
  verification_id: string;
  verified_at: string;
  test: boolean;
}

const OTP_CHANNELS: Record<string, OtpChannel> = { email: "Email", sms: "SMS", whatsapp: "WhatsApp", voice: "Voice" };

export function buildOtpStartPayload(input: OtpStartInput): Record<string, unknown> {
  const ch = OTP_CHANNELS[String(input.channel ?? "").toLowerCase()];
  if (!ch) throw new Error("'channel' must be Email, SMS, WhatsApp or Voice");
  const out: Record<string, unknown> = { channel: ch, to: str(input.to, "to") };
  const opt = (k: string, v: unknown) => {
    if (typeof v === "string" && v.trim() !== "") out[k] = v.trim();
  };
  opt("identity", input.identity);
  opt("template", input.template);
  opt("language", input.language);
  opt("gateway", input.gateway);
  opt("sender", input.sender);
  opt("dlt_template_id", input.dltTemplateId);
  opt("provider", input.provider);
  const nums: [string, unknown, number, number][] = [
    ["code_length", input.codeLength, 4, 10],
    ["ttl_seconds", input.ttlSeconds, 60, 3600],
    ["max_attempts", input.maxAttempts, 1, 10],
    ["resend_cooldown_seconds", input.resendCooldownSeconds, 10, 3600],
  ];
  for (const [k, v, min, max] of nums) {
    const n = optInt(v, k, min, max);
    if (n !== undefined) out[k] = n;
  }
  if (input.whatsapp !== undefined) out.whatsapp = input.whatsapp;
  if (input.data !== undefined) {
    for (const [k, v] of Object.entries(input.data)) {
      if (typeof v !== "string") throw new Error(`'data.${k}' must be a string`);
    }
    out.data = input.data;
  }
  const ref = validateReference(input.reference);
  if (ref !== undefined) out.reference = ref;
  return out;
}

export function buildOtpVerifyPayload(input: OtpVerifyInput): Record<string, unknown> {
  const code = typeof input.code === "string" ? input.code.replace(/[\s-]/g, "") : "";
  if (!/^[A-Za-z0-9]{1,15}$/.test(code)) throw new Error("'code' must be the 1–15 letters or digits that were sent");
  if (input.verificationId !== undefined) {
    return { verification_id: uuid(input.verificationId, "verificationId"), code };
  }
  const ch = OTP_CHANNELS[String(input.channel ?? "").toLowerCase()];
  if (!ch || typeof input.to !== "string" || input.to.trim() === "") {
    throw new Error("Give 'verificationId', or 'channel' and 'to'");
  }
  return { channel: ch, to: input.to.trim(), code };
}

/**
 * `catzconnect.otp` — hosted one-time codes: the server makes the code,
 * sends it and checks it. Refusals are `CatzApiError` with `code`
 * `otp_invalid` (`details.attempts_remaining`), `otp_expired`,
 * `otp_attempts_exceeded`, `otp_resend_cooldown` (`details.retry_after`),
 * `otp_send_limit`, `otp_not_found`, `otp_already_verified`.
 */
export class OtpApi {
  constructor(private http: HttpClient = new HttpClient()) {}

  /** Send a code (again: a resend replaces the code, after the cooldown). */
  async start(input: OtpStartInput, env?: EnvValues): Promise<OtpStartResult> {
    return sdkPost(this.http, "/sdk/otp/start", buildOtpStartPayload(input), env);
  }

  /** Check a code. Resolves only when it is correct. */
  async verify(input: OtpVerifyInput, env?: EnvValues): Promise<OtpVerifyResult> {
    return sdkPost(this.http, "/sdk/otp/verify", buildOtpVerifyPayload(input), env);
  }
}

// ─── management API (/sdk/manage/*) ──────────────────────────────────────

export interface TemplateInput {
  id?: string;
  name: string;
  channel?: "Email" | "SMS" | "Voice";
  subject?: string;
  body: string;
  dlt_template_id?: string;
}

export interface WebhookInput {
  id?: string;
  url: string;
  events: string[];
  description?: string;
  key_id?: string;
  is_enabled?: boolean;
  rotate_secret?: boolean;
}

export interface KeyPolicy {
  expires_at?: string | null;
  ip_allowlist?: string[];
  rate_per_minute?: number | null;
  sends_per_hour?: number | null;
}

export interface CreateKeyInput {
  name: string;
  /** `server` (default) or `test` (sandbox). */
  kind?: "server" | "test";
  /** Channel names (`Email`, `SMS`, `WhatsApp`, `Push`, `Voice`, `Calls`) or use `channel_ids`. */
  channels?: string[];
  channel_ids?: string[];
  user_ids?: string[];
  whatsapp_account_ids?: string[];
  push_project_ids?: string[];
  sms_gateway_ids?: string[];
  call_provider_ids?: string[];
  policy?: KeyPolicy;
}

/** The secrets of a created or rotated key: shown only in this answer. */
export interface CreatedKey {
  id: string;
  name: string;
  kind?: string;
  api_key: string;
  /** Set on create, and on rotate with `rotateEte`. */
  private_key?: string;
  server_public_key?: string;
  api_key_short: string;
}

/**
 * One suppression list per channel: `email` (address), `sms` / `whatsapp` /
 * `voice` (E.164 number), `push` (your app's `external_user_id`).
 */
export type SuppressionChannel = "email" | "sms" | "whatsapp" | "voice" | "push" | (string & {});

export interface Suppression {
  id: string;
  channel: SuppressionChannel;
  /** Email: the subscription topic it is limited to; `null` = every topic. */
  topic: string | null;
  /** `(erased)` for a person erased under GDPR (still suppressed). */
  address: string;
  reason: string;
  detail: string | null;
  expires_at: string | null;
  permanent: boolean;
  created_at: string;
}

export interface SuppressionAddOptions {
  detail?: string;
  /** Email only: suppress just this subscription topic. */
  topic?: string;
}

export interface SuppressionRemoveInput {
  /** The entry's id (from `list`), or `channel` + `address`. */
  id?: string;
  address?: string;
  /** Needed for numbers and user ids (they exist on several channels). */
  channel?: SuppressionChannel;
  /** Email: only this topic's entry; default every entry of the address on the channel. */
  topic?: string;
}

function suppressionTopic(channel: string, topic: unknown): string | undefined {
  if (topic === undefined || topic === null) return undefined;
  if (String(channel).toLowerCase() !== "email") throw new Error("'topic' applies to email suppressions only");
  if (typeof topic !== "string" || !EMAIL_TOPIC_KEY.test(topic)) throw new Error("'topic' must be a topic key");
  return topic;
}

/**
 * `catzconnect.manage` — templates, webhooks, suppressions and API keys of
 * your organization. Needs a live server key with the management scope
 * (panel → API keys) on a plan with the management API.
 */
export class ManageApi {
  constructor(private http: HttpClient = new HttpClient()) {}

  private call(resource: string, op: string, body: Record<string, unknown>, env?: EnvValues): Promise<any> {
    return sdkPost(this.http, `/sdk/manage/${resource}/${op}`, body, env);
  }

  readonly templates = {
    list: (channel?: "Email" | "SMS" | "Voice", env?: EnvValues) => this.call("templates", "list", channel ? { channel } : {}, env),
    get: (idOrName: { id?: string; name?: string; channel?: string }, env?: EnvValues) => this.call("templates", "get", { ...idOrName }, env),
    save: (t: TemplateInput, env?: EnvValues) => {
      str(t.name, "name", 80);
      if (typeof t.body !== "string") throw new Error("Missing 'body'");
      return this.call("templates", "save", { ...t }, env);
    },
    delete: (id: string, env?: EnvValues) => this.call("templates", "delete", { id }, env),
    /** A language version (`de`, `pt-BR`) of a template. */
    saveVariant: (v: { template_id: string; language: string; subject?: string; body: string; dlt_template_id?: string }, env?: EnvValues) =>
      this.call("templates", "variant_save", { ...v }, env),
    deleteVariant: (templateId: string, language: string, env?: EnvValues) =>
      this.call("templates", "variant_delete", { template_id: templateId, language }, env),
  };

  readonly webhooks = {
    list: (env?: EnvValues) => this.call("webhooks", "list", {}, env),
    /** Create (no `id`; the answer has the signing `secret`, once) or update. */
    save: (w: WebhookInput, env?: EnvValues) => {
      str(w.url, "url", 2048);
      if (!Array.isArray(w.events) || w.events.length === 0) throw new Error("Choose at least one event");
      return this.call("webhooks", "save", { ...w }, env);
    },
    delete: (id: string, env?: EnvValues) => this.call("webhooks", "delete", { id }, env),
  };

  readonly suppressions = {
    list: (
      q: { channel?: SuppressionChannel; topic?: string; q?: string; limit?: number; offset?: number } = {},
      env?: EnvValues,
    ): Promise<{ suppressions: Suppression[]; total: number }> => this.call("suppressions", "list", { ...q }, env),
    /** `detail` as a string, or `{ detail?, topic? }` (topic: email only). */
    add: (channel: SuppressionChannel, address: string, options?: string | SuppressionAddOptions, env?: EnvValues) => {
      const o: SuppressionAddOptions = typeof options === "string" ? { detail: options } : (options ?? {});
      const topic = suppressionTopic(channel, o.topic);
      return this.call(
        "suppressions",
        "add",
        { channel, address: str(address, "address"), ...(o.detail ? { detail: o.detail } : {}), ...(topic ? { topic } : {}) },
        env,
      );
    },
    /** `remove("a@b.co")`, `remove("+15550100", "sms")` or `remove({ id })` / `remove({ channel, address, topic })`. */
    remove: (target: string | SuppressionRemoveInput, channel?: SuppressionChannel, env?: EnvValues) => {
      const t: SuppressionRemoveInput = typeof target === "string" ? { address: target, channel } : target;
      if (t.id !== undefined) return this.call("suppressions", "remove", { id: uuid(t.id, "id") }, env);
      const body: Record<string, unknown> = { address: str(t.address, "address") };
      if (t.channel) body.channel = t.channel;
      const topic = suppressionTopic(String(t.channel ?? "email"), t.topic);
      if (topic) body.topic = topic;
      return this.call("suppressions", "remove", body, env);
    },
  };

  readonly keys = {
    list: (env?: EnvValues) => this.call("keys", "list", {}, env),
    create: (k: CreateKeyInput, env?: EnvValues): Promise<CreatedKey> => {
      str(k.name, "name", 100);
      if (k.kind !== undefined && k.kind !== "server" && k.kind !== "test") throw new Error("'kind' must be server or test");
      return this.call("keys", "create", { ...k }, env);
    },
    rotate: (id: string, rotateEte = false, env?: EnvValues): Promise<CreatedKey> => this.call("keys", "rotate", { id, rotate_ete: rotateEte }, env),
    revoke: (id: string, env?: EnvValues) => this.call("keys", "revoke", { id }, env),
    /** Replaces the whole policy (omitted fields are cleared). */
    setPolicy: (id: string, policy: KeyPolicy, env?: EnvValues) => this.call("keys", "policy", { id, ...policy }, env),
  };
}

// ─── push device registry (public endpoints) ─────────────────────────────
// Lives in ./devices (no Node built-ins), so apps can import it from
// "catzconnect/push" too; re-exported here for existing imports.

export { PushDevicesApi, buildRegisterDevicePayload, pushTopics } from "./devices";
export type { PushPlatform, RegisterDeviceInput, PushDevicesOptions } from "./devices";

// ─── push broadcasts and topics (/sdk/push/*) ────────────────────────────

export interface PushBroadcast {
  id: string;
  push_project_id: string;
  project_label: string;
  firebase_project: string;
  key_id: string | null;
  audience: "all" | "topic" | "token" | "user";
  topic: string | null;
  external_user_id: string | null;
  title_hint: string | null;
  send_at: string;
  /** scheduled → dispatching → completed | canceled | failed */
  status: "scheduled" | "dispatching" | "completed" | "canceled" | "failed" | (string & {});
  queued: number;
  skipped: number;
  over_quota: number;
  error: string | null;
  error_code: string | null;
  started_at: string | null;
  completed_at: string | null;
  canceled_at: string | null;
  created_at: string;
}

export interface PushTopicChangeInput {
  /** The Firebase project id (the send's `identity`). */
  identity: string;
  topic: string;
  /** FCM tokens of devices registered with `/push/register` (≤ 1000). */
  tokens?: string[];
  /** Or every registered device of this user. */
  externalUserId?: string;
}

export function buildPushTopicChangePayload(input: PushTopicChangeInput): Record<string, unknown> {
  const out: Record<string, unknown> = { identity: str(input.identity, "identity", 200), topic: pushTopic(input.topic) };
  if (input.tokens !== undefined) {
    if (!Array.isArray(input.tokens) || input.tokens.length > 1000) throw new Error("'tokens' must list at most 1000 tokens");
    out.tokens = input.tokens.map((t) => token(t));
  }
  if (input.externalUserId !== undefined) out.external_user_id = str(input.externalUserId, "externalUserId", 128);
  const hasTokens = Array.isArray(out.tokens) && out.tokens.length > 0;
  if (!hasTokens && out.external_user_id === undefined) {
    throw new Error("Give 'tokens' (registered devices) or 'externalUserId'");
  }
  return out;
}

/**
 * `catzconnect.push` — broadcasts / scheduled pushes created by `send()`
 * with `payload.push`, and push topic subscriptions, from your server
 * (server key with the Push channel; app and test keys are refused).
 */
export class PushApi {
  constructor(private http: HttpClient = new HttpClient()) {}

  /** Status and counters of a broadcast or scheduled push. */
  async broadcast(broadcastId: string, env?: EnvValues): Promise<PushBroadcast> {
    return sdkPost(this.http, "/sdk/push/broadcast", { broadcast_id: uuid(broadcastId, "broadcastId") }, env);
  }

  /** Stop one that has not finished (`not_cancelable` once it has). Devices already queued still get it. */
  async cancel(broadcastId: string, env?: EnvValues): Promise<{ broadcast_id: string; status: "canceled" }> {
    return sdkPost(this.http, "/sdk/push/cancel", { broadcast_id: uuid(broadcastId, "broadcastId") }, env);
  }

  /** Subscribe registered devices to a topic. Resolves `{ topic, devices }` (devices matched). */
  async subscribe(input: PushTopicChangeInput, env?: EnvValues): Promise<{ topic: string; devices: number }> {
    return sdkPost(this.http, "/sdk/push/topic/subscribe", buildPushTopicChangePayload(input), env);
  }

  async unsubscribe(input: PushTopicChangeInput, env?: EnvValues): Promise<{ topic: string; devices: number }> {
    return sdkPost(this.http, "/sdk/push/topic/unsubscribe", buildPushTopicChangePayload(input), env);
  }

  /** A project's topics with their subscribed devices. */
  async topics(identity: string, env?: EnvValues): Promise<{ topics: { topic: string; devices: number; last_subscribed_at: string }[] }> {
    return sdkPost(this.http, "/sdk/push/topics", { identity: str(identity, "identity", 200) }, env);
  }
}
