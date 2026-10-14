import { HttpClient } from "./core/http";
import { encrypt } from "./core/crypto";
import { EnvValues, SendInput, SendResponse, SmsSendData } from "./types";
import { verifyPayload } from "./core/payload";

/**
 * The JSON body (before encryption) that `send` posts to `/sdk/send` for a
 * validated input. SMS sends only its own fields; the other channels pass
 * the payload through as they always have.
 */
export function buildSendPayload(input: SendInput): Record<string, unknown> {
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

  /** SMS resolves to `{ success, message, data: { message_id, segments, encoding } }`. */
  async send(input: SendInput & { channel: "SMS" }, env?: EnvValues): Promise<SendResponse<SmsSendData>>;
  async send(input: SendInput, env?: EnvValues): Promise<any>;
  async send(input: SendInput, env?: EnvValues): Promise<any> {
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
      throw new Error(
        `Failed to send ${input.type}.${input.channel}.${input.template}: ${err.message}`,
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
} from "./types";

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
