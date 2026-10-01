export type MessageType = "Verification" | "Transactional" | "Notification";

export type Channel = "Email" | "WhatsApp" | "Push";

/**
 * The built-in templates, or the name of an email template created in the
 * panel (Email → Templates). A panel template is filled from `payload.data`.
 */
export type Template = "Otp" | "Custom" | "Notification" | (string & {});

export interface SendInput {
  channel: Channel;
  type: MessageType;
  template: Template;
  identity: string;
  payload: SendPayload;
}

export interface SendPayload {
  /** An email address for Email; a phone number with country code for WhatsApp. */
  to?: string;
  otp?: string;
  /** Email: required. WhatsApp: optional — sent as a bold first line. */
  subject?: string;
  body?: string;

  /** Push: notification title. */
  title?: string;
  /**
   * Push: key/value pairs delivered to the app. Email with a panel template:
   * the values for its {{variables}}. Values must be strings.
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
}

export interface EnvValues {
  api_key: string;
  private_key: string;
  server_public_key: string;
}
