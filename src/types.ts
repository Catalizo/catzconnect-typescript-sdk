export type MessageType = "Verification" | "Transactional" | "Notification";

export type Channel = "Email" | "WhatsApp" | "Push";

export type Template = "Otp" | "Custom" | "Notification";

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
  /** Push: key/value pairs delivered to the app. Values must be strings. */
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
}

export interface EnvValues {
  api_key: string;
  private_key: string;
  server_public_key: string;
}
