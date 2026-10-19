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

export interface EnvValues {
  api_key: string;
  private_key: string;
  server_public_key: string;
}
