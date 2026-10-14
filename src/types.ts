/** `Promotional` is accepted by the SMS channel only. */
export type MessageType = "Verification" | "Transactional" | "Promotional" | "Notification";

export type Channel = "Email" | "WhatsApp" | "Push" | "SMS";

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
  /** The sender identity. Ignored by the SMS channel — pass `""`. */
  identity: string;
  payload: SendPayload;
}

export interface SendPayload {
  /**
   * An email address for Email; a phone number with country code for
   * WhatsApp; an E.164 number (`+919876543210`) for SMS.
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

export interface EnvValues {
  api_key: string;
  private_key: string;
  server_public_key: string;
}
