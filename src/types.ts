/** `Promotional` is accepted by the SMS channel only. */
export type MessageType = "Verification" | "Transactional" | "Promotional" | "Notification";

/** `"Voice"` (phone call, text-to-speech) is also accepted as `"voice"`. */
export type Channel = "Email" | "WhatsApp" | "Push" | "SMS" | "Voice";

/**
 * The built-in templates, or the name of a template created in the panel
 * (Email → Templates, or an SMS template for the SMS channel). A panel
 * template is filled from `payload.data`.
 */
export type Template = "Otp" | "Custom" | "Notification" | (string & {});

export interface SendInput {
  channel: Channel;
  type: MessageType;
  template: Template;
  /** The sender identity. Ignored by the SMS and Voice channels — pass `""`. */
  identity: string;
  payload: SendPayload;
  /**
   * Language of the built-in (default) Otp/Verification templates: `en`,
   * `de`, `ja`, `ar` or `hi`. A BCP-47 tag such as `"de-DE"` is accepted
   * and sent as its primary subtag (`"de"`). Omitted → the server's default
   * (English). Panel templates are not affected. Voice `data.language`
   * still overrides the text-to-speech language; WhatsApp needs the
   * Authentication template approved in that language.
   */
  language?: string;
  /**
   * Retry-safe sends: the same key with the same request within 24 hours
   * returns the first answer instead of sending again (sent as the
   * `Idempotency-Key` header and the `idempotency_key` field). 1–255
   * visible ASCII characters. A different request with a used key fails
   * with `idempotency_conflict`.
   */
  idempotencyKey?: string;
  /** Your own id for the message (≤ 128 chars), to find it with `messages.list`. */
  reference?: string;
}

/** WhatsApp template header: text, media (by `link` or Meta media `id`) or a location. */
export interface WhatsAppHeader {
  type: "text" | "image" | "video" | "document" | "location";
  text?: string;
  link?: string;
  id?: string;
  /** Documents only. */
  filename?: string;
  latitude?: number;
  longitude?: number;
  name?: string;
  address?: string;
}

/** A dynamic button parameter of an approved template. `index` is 0-based. */
export interface WhatsAppButton {
  index: number;
  type: "url" | "quick_reply" | "copy_code" | "otp";
  /** `url`: the dynamic URL suffix. */
  text?: string;
  /** `quick_reply`. */
  payload?: string;
  /** `copy_code` / `otp`. */
  code?: string;
}

/** A media message (`template: "Custom"`): exactly one of `link` (https) or `id`. */
export interface WhatsAppMedia {
  type: "image" | "document" | "video" | "audio";
  link?: string;
  id?: string;
  /** Not for audio; `body` is used when absent. */
  caption?: string;
  /** Documents only. */
  filename?: string;
}

/**
 * WhatsApp options: approved-template parameters (`template` = the Meta
 * template name) or a media message (`template: "Custom"`).
 */
export interface WhatsAppOptions {
  /** Meta language code (`en`, `en_US`, `es_419`). */
  language?: string;
  header?: WhatsAppHeader;
  /** Positional `{{1}}…` values, or named values for NAMED templates. */
  body?: string[] | Record<string, string>;
  buttons?: WhatsAppButton[];
  media?: WhatsAppMedia;
}

/** Email: per-message open / click tracking; omitted = the domain / organization setting. */
export interface TrackingOverride {
  opens?: boolean;
  clicks?: boolean;
}

/**
 * Push: send to many devices or later (`/sdk/send` with channel Push).
 * With any of these set the answer is `data: { broadcast_id, audience,
 * status: "scheduled", send_at }` and nothing is sent synchronously; follow
 * it with `catzconnect.push.broadcast(id)` / `cancel(id)` and list its
 * deliveries with `messages.list({ broadcastId })`. Server keys only (app
 * and test keys are refused).
 */
export interface PushOptions {
  /** Every active registered device of the project (leave `to` / `external_user_id` out). */
  broadcast?: boolean;
  /** Every device subscribed to this topic: 1–64 of `A-Z a-z 0-9 _ . ~ -`. */
  topic?: string;
  /**
   * RFC 3339 with a zone (`2026-11-02T09:00:00Z`) or a `Date`; up to
   * `PUSH_SCHEDULE_MAX_DAYS` (30) ahead. Works with `broadcast`, `topic`,
   * `to` or `external_user_id`.
   */
  send_at?: string | Date;
}

export interface SendPayload {
  /**
   * An email address for Email; a phone number with country code for
   * WhatsApp; an E.164 number (`+919876543210`) for SMS and Voice.
   */
  to?: string;
  otp?: string;
  /** Email: required. WhatsApp: optional — sent as a bold first line. */
  subject?: string;
  body?: string;

  /** Push: notification title. */
  title?: string;
  /**
   * Push: key/value pairs delivered to the app. Email or SMS with a panel
   * template: the values for its {{variables}}. Values must be strings.
   * Voice: `language` (e.g. `"en-US"`), `voice` (`"female"`, `"male"` or a
   * provider voice name), `repeat` (`"1"`–`"3"`), plus a panel template's
   * variables.
   */
  data?: Record<string, string>;
  /** Push: https URL of an image to show. */
  image?: string;
  /** Push: https URL to open when the notification is tapped. */
  link?: string;
  /**
   * Push: the device's public key from `generateDeviceKeys()`. When present,
   * the notification is sealed so only that device can read it — Google,
   * Apple and CatzConnect see ciphertext.
   */
  device_key?: string;
  /**
   * Push: send to every device your app registered for this user (with
   * `POST /push/register`) instead of one token in `to`. Give one of `to`
   * or `external_user_id`. Each device's registered key is used for
   * end-to-end encryption, so `device_key` is not allowed with it.
   */
  external_user_id?: string;

  /**
   * SMS: send through this gateway (its id or label) instead of routing. It
   * must be one of the API key's SMS gateways.
   */
  gateway?: string;
  /**
   * SMS: sender override — an E.164 number or a 2–11 character sender ID.
   * Only together with `gateway`, and only when that gateway allows it.
   */
  sender?: string;
  /**
   * SMS: India DLT content template id (digits) for Custom bodies and the
   * default OTP text. Required for +91 numbers unless the panel template
   * carries one.
   */
  dlt_template_id?: string;

  /**
   * Voice: call through this phone provider (its id or label) instead of
   * routing. It must be one of the API key's call providers.
   */
  provider?: string;

  /** WhatsApp: template parameters or media (see {@link WhatsAppOptions}). */
  whatsapp?: WhatsAppOptions;
  /** Email: open / click tracking for this message. */
  tracking?: TrackingOverride;
  /**
   * Email: a subscription topic key of your organization (Email →
   * Preferences in the panel): its opt-outs apply and the message's
   * unsubscribe link unsubscribes from that topic only. Errors
   * `invalid_topic`, `topic_email_only`.
   */
  topic?: string;
  /** Push: broadcast, topic or scheduled send (see {@link PushOptions}). */
  push?: PushOptions;
}

/** The server's answer: `{ success, message, data }`. */
export interface SendResponse<T = unknown> {
  success: boolean;
  message: string;
  data: T;
}

/** `data` of a successful SMS send. The message is queued, not yet delivered. */
export interface SmsSendData {
  /**
   * UUID of the queued message; webhook events (`sms.sent`, `sms.delivered`, `sms.failed`,
   * `sms.unknown` — the provider was called but did not answer, so it is not resent) carry it.
   */
  message_id: string;
  /** Billable parts. */
  segments: number;
  encoding: "gsm7" | "ucs2";
}

/** `data` of a successful Voice send. The call is queued, not yet placed. */
export interface VoiceSendData {
  /** UUID of the queued phone call; `voice.*` webhook events carry it. */
  message_id: string;
  [key: string]: unknown;
}

/**
 * `data` every successful send now carries (servers from October 2026):
 * the queued message's id (look it up with `messages.get`), `test: true`
 * for a test (sandbox) key, `message_ids` when several were queued.
 */
export interface SendData {
  message_id?: string;
  message_ids?: string[];
  status?: string;
  channel?: string;
  test?: boolean;
  /** Push with `push` options: the broadcast / scheduled send created. */
  broadcast_id?: string;
  audience?: "all" | "topic" | "token" | "user";
  send_at?: string;
  [key: string]: unknown;
}

export interface EnvValues {
  api_key: string;
  private_key: string;
  server_public_key: string;
}
