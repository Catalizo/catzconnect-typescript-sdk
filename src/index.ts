import { HttpClient } from "./core/http";
import { encrypt } from "./core/crypto";
import { EnvValues, SendInput, SendResponse, SmsSendData, VoiceSendData } from "./types";
import { pushSendAt, verifyPayload } from "./core/payload";
import { buildVoicePayload, isVoiceChannel } from "./utils/voice";
import { CallsApi } from "./calls";
import { normaliseLanguage } from "./utils/language";
import { ManageApi, MessagesApi, OtpApi, PushApi, PushDevicesApi, validateIdempotencyKey, validateReference } from "./devapi";

/** `"voice"` → `"Voice"`; every other channel is passed through unchanged. */
function canonicalChannel(input: SendInput): SendInput {
  if (isVoiceChannel(input.channel) && input.channel !== "Voice") {
    return { ...input, channel: "Voice" };
  }
  return input;
}

/**
 * The JSON body (before encryption) that `send` posts to `/sdk/send` for a
 * validated input. SMS sends only its own fields; the other channels pass
 * the payload through as they always have.
 */
export function buildSendPayload(input: SendInput): Record<string, unknown> {
  const out = buildChannelPayload(canonicalChannel(input));
  // Push options: a Date send_at goes as RFC 3339.
  if (out.push && typeof out.push === "object") {
    const p = { ...(out.push as Record<string, unknown>) };
    if (p.send_at !== undefined && p.send_at !== null) p.send_at = pushSendAt(p.send_at);
    out.push = p;
  }
  // Top-level `language`, next to channel/template; left out when unset so
  // older servers and existing sends see the same body as before.
  if (input.language !== undefined && input.language !== null) {
    out.language = normaliseLanguage(input.language);
  }
  // Left out when unset, so existing sends post the same body as before.
  const idem = validateIdempotencyKey(input.idempotencyKey);
  if (idem !== undefined) out.idempotency_key = idem;
  const ref = validateReference(input.reference);
  if (ref !== undefined) out.reference = ref;
  return out;
}

function buildChannelPayload(input: SendInput): Record<string, unknown> {
  if (input.channel === "Voice") {
    return buildVoicePayload(input);
  }
  if (input.channel === "SMS") {
    const p = input.payload;
    const out: Record<string, unknown> = {
      message_type: input.type,
      channel: "SMS",
      template: input.template,
      identity: input.identity ?? "", // required by the server, ignored for SMS
      to: p.to,
    };
    for (const k of ["otp", "body", "gateway", "sender", "dlt_template_id"] as const) {
      const v = p[k];
      if (typeof v === "string" && v.trim() !== "") out[k] = v;
    }
    if (p.data !== undefined && Object.keys(p.data).length > 0) out.data = p.data;
    return out;
  }

  return {
    message_type: input.type,
    channel: input.channel,
    template: input.template,
    identity: input.identity,
    ...input.payload,
  };
}

class CatzConnect {
  private http = new HttpClient();
  private defaultLanguage?: string;

  /**
   * The `language` used by every `send()` that does not set one (`en`,
   * `de`, `ja`, `ar`, `hi`, or a BCP-47 tag such as `"de-DE"`). Pass
   * `undefined` to clear it. Throws for an unsupported language.
   */
  setDefaultLanguage(language: string | undefined): void {
    this.defaultLanguage = language === undefined || language === null ? undefined : normaliseLanguage(language);
  }

  /**
   * Allow a plain `http://` `CATZCONNECT_BASE_URL` to a host other than
   * localhost / 127.0.0.1 / ::1 / 10.0.2.2 (same as
   * `CATZCONNECT_ALLOW_INSECURE_HTTP=1`). Default false: such a URL throws,
   * since the API key would be sent unencrypted.
   */
  setAllowInsecureHttp(allow: boolean): void {
    this.http.allowInsecureHttp = !!allow;
  }

  /** The default set with {@link setDefaultLanguage}, normalised (`"de"`), or `undefined`. */
  getDefaultLanguage(): string | undefined {
    return this.defaultLanguage;
  }

  /** Voice & Video calls: `create`, `token`, `get`, `end`. */
  readonly calls = new CallsApi(this.http);

  /** Status and event timeline of sent messages: `get`, `list`. */
  readonly messages = new MessagesApi(this.http);

  /** Hosted one-time codes: `start`, `verify`. */
  readonly otp = new OtpApi(this.http);

  /** Management API (key with the management scope): templates, webhooks, suppressions, keys. */
  readonly manage = new ManageApi(this.http);

  /** Push device registry with the publishable key: `register`, `unregister`, `opened`, `subscribeTopics`, `unsubscribeTopics`. */
  readonly pushDevices = new PushDevicesApi();

  /** Push broadcasts / scheduled pushes and topic subscriptions (server key): `broadcast`, `cancel`, `subscribe`, `unsubscribe`, `topics`. */
  readonly push = new PushApi(this.http);

  /** SMS resolves to `{ success, message, data: { message_id, segments, encoding } }`. */
  async send(input: SendInput & { channel: "SMS" }, env?: EnvValues): Promise<SendResponse<SmsSendData>>;
  /** Voice resolves to `{ success, message, data: { message_id, … } }`. */
  async send(input: SendInput & { channel: "Voice" }, env?: EnvValues): Promise<SendResponse<VoiceSendData>>;
  async send(input: SendInput, env?: EnvValues): Promise<any>;
  async send(input: SendInput, env?: EnvValues): Promise<any> {
    input = canonicalChannel(input);
    if ((input.language === undefined || input.language === null) && this.defaultLanguage !== undefined) {
      input = { ...input, language: this.defaultLanguage };
    }
    if (input.language !== undefined && input.language !== null) {
      input = { ...input, language: normaliseLanguage(input.language) };
    }
    verifyPayload(input);

    const finalPayload = buildSendPayload(input);

    const enc = await encrypt(finalPayload, env);
    if (!enc) {
      throw new Error("Encryption failed");
    }

    try {
      const headers: Record<string, string> = {};
      if (typeof finalPayload.idempotency_key === "string") headers["Idempotency-Key"] = finalPayload.idempotency_key;
      const res = await this.http.post("/sdk/send", enc, env, headers);

      return res;
    } catch (err: any) {
      // Same message as before; the server's status and `code` (plan_required,
      // minutes_cap_reached, provider_not_allowed, …) are kept on the error,
      // and so are its `details` (retry_after, idempotency info, …).
      throw Object.assign(
        new Error(`Failed to send ${input.type}.${input.channel}.${input.template}: ${err.message}`),
        { status: err?.status, code: err?.code, details: err?.details, body: err?.body, cause: err },
      );
    }
  }
}

export const catzconnect = new CatzConnect();

export type {
  Channel,
  EnvValues,
  PushOptions,
  SendData,
  TrackingOverride,
  WhatsAppButton,
  WhatsAppHeader,
  WhatsAppMedia,
  WhatsAppOptions,
  MessageType,
  SendInput,
  SendPayload,
  SendResponse,
  SmsSendData,
  Template,
  VoiceSendData,
} from "./types";

// Voice & Video calls from your backend (also on catzconnect.calls).
export {
  CallsApi,
  buildCreateCallPayload,
  buildCallTokenPayload,
  validateCallUserId,
  CALL_MAX_CALLEES,
  CALL_USER_ID_MAX,
  CALL_METADATA_MAX_BYTES,
  CALL_TOKEN_TTL_MIN,
  CALL_TOKEN_TTL_MAX,
} from "./calls";
export type {
  Call,
  CallMode,
  CallParticipant,
  CallProvider,
  CallStatus,
  CallToken,
  CreateCallInput,
  EndCallResult,
  ParticipantState,
} from "./calls";
export { CatzApiError, checkBaseUrl } from "./core/http";

// Phone calls via send({ channel: "Voice" }): the server's checks.
export {
  verifyVoice,
  validateVoiceText,
  isValidVoiceLanguage,
  isValidVoiceName,
  parseVoiceRepeat,
  VOICE_MAX_CHARS,
  VOICE_MAX_REPEAT,
} from "./utils/voice";

// send() `language`: the languages of the built-in Otp/Verification templates.
export { normaliseLanguage, isValidLanguage, SUPPORTED_LANGUAGES } from "./utils/language";
export type { Language } from "./utils/language";

// SMS helpers: the same E.164, sender and length checks the server applies.
export {
  analyseSms,
  normaliseE164,
  isValidSmsSender,
  isValidDltId,
  SMS_MAX_SEGMENTS,
} from "./utils/sms";
export type { SmsAnalysis, SmsEncoding } from "./utils/sms";

// Check the Catz-Signature header on webhook deliveries.
export { verifyWebhookSignature } from "./core/webhook";

// Server-side: the user_hash that lets an app link a push device to a user.
export { computeUserHash } from "./core/webhook";

// Device-side helpers for end-to-end encrypted push. Used in the app that
// receives notifications, not on your server.
export { generateDeviceKeys, openPushPayload, isSealedPush } from "./push";
export type { DeviceKeys, PushContent } from "./push";

// Message status, hosted OTP, management API, push device registry, error codes.
export {
  ErrorCodes,
  isRetryableCode,
  MessagesApi,
  OtpApi,
  ManageApi,
  PushDevicesApi,
  PushApi,
  buildPushTopicChangePayload,
  pushTopics,
  buildListMessagesPayload,
  buildOtpStartPayload,
  buildOtpVerifyPayload,
  buildRegisterDevicePayload,
  validateReference,
  validateIdempotencyKey,
} from "./devapi";
export type {
  ErrorCode,
  MessageChannel,
  MessageEvent,
  MessageStatus,
  MessageStatusName,
  ListMessagesInput,
  OtpChannel,
  OtpStartInput,
  OtpStartResult,
  OtpVerifyInput,
  OtpVerifyResult,
  TemplateInput,
  WebhookInput,
  KeyPolicy,
  CreateKeyInput,
  CreatedKey,
  SuppressionChannel,
  Suppression,
  SuppressionAddOptions,
  SuppressionRemoveInput,
  PushBroadcast,
  PushTopicChangeInput,
  PushPlatform,
  RegisterDeviceInput,
  PushDevicesOptions,
} from "./devapi";

// WhatsApp template / media checks (also applied by send()).
export { verifyWhatsAppOptions, verifyWhatsAppMedia, WHATSAPP_TEMPLATE_NAME } from "./utils/whatsapp";

// Webhook events: names and a verify-and-parse helper.
export { WEBHOOK_EVENTS, parseWebhookEvent } from "./core/webhook";
export type { WebhookEvent, WebhookEventType } from "./core/webhook";
