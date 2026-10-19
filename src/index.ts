import { HttpClient } from "./core/http";
import { encrypt } from "./core/crypto";
import { EnvValues, SendInput, SendResponse, SmsSendData, VoiceSendData } from "./types";
import { verifyPayload } from "./core/payload";
import { buildVoicePayload, isVoiceChannel } from "./utils/voice";
import { CallsApi } from "./calls";
import { normaliseLanguage } from "./utils/language";

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
  // Top-level `language`, next to channel/template; left out when unset so
  // older servers and existing sends see the same body as before.
  if (input.language !== undefined && input.language !== null) {
    out.language = normaliseLanguage(input.language);
  }
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

  /** The default set with {@link setDefaultLanguage}, normalised (`"de"`), or `undefined`. */
  getDefaultLanguage(): string | undefined {
    return this.defaultLanguage;
  }

  /** Voice & Video calls: `create`, `token`, `get`, `end`. */
  readonly calls = new CallsApi(this.http);

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
      const res = await this.http.post("/sdk/send", enc, env);

      return res;
    } catch (err: any) {
      // Same message as before; the server's status and `code` (plan_required,
      // minutes_cap_reached, provider_not_allowed, …) are kept on the error.
      throw Object.assign(
        new Error(`Failed to send ${input.type}.${input.channel}.${input.template}: ${err.message}`),
        { status: err?.status, code: err?.code, body: err?.body, cause: err },
      );
    }
  }
}

export const catzconnect = new CatzConnect();

export type {
  Channel,
  EnvValues,
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
export { CatzApiError } from "./core/http";

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
