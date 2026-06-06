export type MessageType = "Verification" | "Transactional";

export type Channel = "Email";

export type Template = "Otp" | "Custom";

export interface SendInput {
  channel: Channel;
  type: MessageType;
  template: Template;
  identity: string;
  payload: SendPayload;
}

export interface SendPayload {
  to?: string;
  otp?: string;
  subject?: string;
  body?: string;
}

export interface EnvValues {
  api_key: string;
  private_key: string;
  server_public_key: string;
}
