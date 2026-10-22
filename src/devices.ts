/**
 * Push device registry — `POST /push/register`, `/push/unregister`,
 * `/push/topics/{subscribe,unsubscribe}`, `/push/opened`.
 *
 * Browser / React Native safe: this module imports no Node built-ins (no
 * `node:crypto`, no `Buffer`), so an app can use it through
 * `import { PushDevicesApi } from "catzconnect/push"`. The main
 * "catzconnect" entry re-exports the same class for server code.
 */
import { postPublic } from "./core/http";

/** Push topic names: 1–64 of `A-Z a-z 0-9 _ . ~ -` (same as core/payload). */
const PUSH_TOPIC_NAME = /^[A-Za-z0-9_.~-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(v: unknown, field: string): string {
  if (typeof v !== "string" || !UUID_RE.test(v.trim())) throw new Error(`'${field}' must be a message id (UUID)`);
  return v.trim();
}


export type PushPlatform = "ios" | "android" | "web";

export interface RegisterDeviceInput {
  /** The project's publishable key (`pk_push_…`, safe to ship in the app). */
  publishableKey: string;
  /** The FCM registration token. */
  token: string;
  platform: PushPlatform;
  externalUserId?: string;
  /** From your server: `computeUserHash(externalUserId, identitySecret)`. */
  userHash?: string;
  appVersion?: string;
  /** `generateDeviceKeys().publicKey`, for end-to-end encrypted push. */
  deviceKey?: string;
}

export interface PushDevicesOptions {
  /** Default: CATZCONNECT_BASE_URL or https://api.catzconnect.com. */
  baseUrl?: string;
  allowInsecureHttp?: boolean;
}

function pk(v: unknown): string {
  if (typeof v !== "string" || v.trim().length < 10 || v.trim().length > 100) throw new Error("'publishableKey' is required");
  return v.trim();
}
/** @internal */
export function checkToken(v: unknown): string {
  if (typeof v !== "string" || v.trim().length < 32 || v.trim().length > 4096) {
    throw new Error("'token' must be the device's FCM registration token");
  }
  return v.trim();
}

export function buildRegisterDevicePayload(input: RegisterDeviceInput): Record<string, unknown> {
  if (!["ios", "android", "web"].includes(input.platform)) throw new Error("'platform' must be ios, android or web");
  const out: Record<string, unknown> = { publishable_key: pk(input.publishableKey), token: checkToken(input.token), platform: input.platform };
  if (input.externalUserId !== undefined) {
    const u = input.externalUserId;
    if (typeof u !== "string" || u.length < 1 || [...u].length > 128 || /[\u0000-\u001f\u007f]/.test(u)) {
      throw new Error("'externalUserId' must be 1–128 characters");
    }
    out.external_user_id = u;
  }
  if (input.userHash !== undefined) out.user_hash = input.userHash;
  if (input.appVersion !== undefined) {
    if (typeof input.appVersion !== "string" || input.appVersion.length > 40) throw new Error("'appVersion' is at most 40 characters");
    out.app_version = input.appVersion;
  }
  if (input.deviceKey !== undefined) out.device_key = input.deviceKey;
  return out;
}

/**
 * Register app devices for push — `POST /push/register`, `/push/unregister`,
 * `/push/opened`. These use the project's publishable key (no API key), so
 * they can run in the app itself or on your server.
 */
export class PushDevicesApi {
  constructor(private options: PushDevicesOptions = {}) {}

  private post(path: string, body: Record<string, unknown>) {
    return postPublic(path, body, this.options.baseUrl, this.options.allowInsecureHttp);
  }

  /** Register or refresh a device. Resolves `{ device_id, created }`. */
  async register(input: RegisterDeviceInput): Promise<{ device_id: string; created: boolean }> {
    const res = await this.post("/push/register", buildRegisterDevicePayload(input));
    return res?.data ?? res;
  }

  /** Forget a token (sign-out, uninstall). Never fails for an unknown token. */
  async unregister(publishableKey: string, deviceToken: string): Promise<{ removed: boolean }> {
    const res = await this.post("/push/unregister", { publishable_key: pk(publishableKey), token: checkToken(deviceToken) });
    return res?.data ?? res;
  }

  /**
   * Subscribe this registered device to push topics (1–20 names of
   * `A-Z a-z 0-9 _ . ~ -`). Fails with 404 when the token was not
   * registered first. Resolves `{ topics }`.
   */
  async subscribeTopics(publishableKey: string, deviceToken: string, topics: string[]): Promise<{ topics: string[] }> {
    const res = await this.post("/push/topics/subscribe", { publishable_key: pk(publishableKey), token: checkToken(deviceToken), topics: pushTopics(topics) });
    return res?.data ?? res;
  }

  /** Unsubscribe this registered device from push topics. */
  async unsubscribeTopics(publishableKey: string, deviceToken: string, topics: string[]): Promise<{ topics: string[] }> {
    const res = await this.post("/push/topics/unsubscribe", { publishable_key: pk(publishableKey), token: checkToken(deviceToken), topics: pushTopics(topics) });
    return res?.data ?? res;
  }

  /**
   * Report that a notification was opened; `messageId` is its `catz_id` data
   * field. Pass the device's FCM registration token whenever the app has it:
   * the open is then verified (only the device the notification was
   * delivered to can report it) and the first verified report fires the
   * `push.opened` webhook. Without a token the open is still recorded (as
   * in apps built before the token was sent) but no webhook fires.
   * Resolves `{ recorded, verified }`.
   */
  async opened(publishableKey: string, messageId: string, deviceToken?: string): Promise<{ recorded: boolean; verified?: boolean }> {
    const body: Record<string, unknown> = { publishable_key: pk(publishableKey), message_id: uuid(messageId, "messageId") };
    if (deviceToken !== undefined && deviceToken !== null && String(deviceToken).trim() !== "") body.token = checkToken(deviceToken);
    const res = await this.post("/push/opened", body);
    return res?.data ?? res;
  }
}

/** 1–20 push topic names. */
export function pushTopics(v: unknown, max = 20): string[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) throw new Error(`'topics' must list 1–${max} topic names`);
  return v.map((t) => pushTopic(t));
}

/** @internal */
export function pushTopic(t: unknown): string {
  if (typeof t !== "string" || !PUSH_TOPIC_NAME.test(t.trim())) throw new Error("A push topic is 1–64 characters of letters, digits, _ . ~ -");
  return t.trim();
}
