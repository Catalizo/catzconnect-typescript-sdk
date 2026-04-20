export type MessageType = "Verification";

export type Channel = "Email";

export type Template = "Otp";

export interface SendInput {
  channel: Channel;
  type: MessageType;
  template: Template;
  payload: SendPayload;
}

export interface SendPayload {
  to?: string;
  otp?: string;
}

export interface EnvValues {
  api_key: string;
  private_key: string;
  server_public_key: string;
}
