import sodium from "libsodium-wrappers-sumo";

/**
 * Device-side helpers for end-to-end encrypted push.
 *
 * These run in the app that RECEIVES notifications — a web service worker or
 * a React Native app — not on your server. The private key is generated here
 * and must never leave the device: that is what makes the encryption
 * end-to-end.
 *
 * Android (Kotlin) and iOS (Swift) apps use the same libsodium primitive,
 * `crypto_box_seal_open`; see the Push section of the CatzConnect docs.
 */

let ready: Promise<void> | null = null;
async function lib() {
  if (!ready) ready = sodium.ready;
  await ready;
  return sodium;
}

const toB64 = (u: Uint8Array) => sodium.to_base64(u, sodium.base64_variants.ORIGINAL);
const fromB64 = (s: string) => sodium.from_base64(s, sodium.base64_variants.ORIGINAL);

export interface DeviceKeys {
  /** Send this to your backend with the FCM token; pass it as `device_key`. */
  publicKey: string;
  /** Keep this on the device only — secure storage, never your server. */
  privateKey: string;
}

/**
 * Generate this device's keypair. Do it once, store the private key in the
 * platform's secure storage, and send the public key to your backend along
 * with the FCM token.
 */
export async function generateDeviceKeys(): Promise<DeviceKeys> {
  const s = await lib();
  const kp = s.crypto_box_keypair();
  return { publicKey: toB64(kp.publicKey), privateKey: toB64(kp.privateKey) };
}

export interface PushContent {
  title?: string;
  body: string;
  data: Record<string, string>;
  image?: string;
  link?: string;
}

/**
 * True when an FCM data message came from CatzConnect with sealed content.
 * Pass it the message's `data` object.
 */
export function isSealedPush(data: Record<string, string> | undefined): boolean {
  return !!data && data.catz_v === "1" && typeof data.catz_sealed === "string";
}

/**
 * Open a sealed notification. Pass the message's `data` object and this
 * device's keys; returns the readable title, body, data, image and link.
 *
 * Throws if the message was sealed to a different device — for example after
 * the app was reinstalled and generated new keys without telling the backend.
 */
export async function openPushPayload(
  data: Record<string, string>,
  keys: DeviceKeys,
): Promise<PushContent> {
  if (!isSealedPush(data)) {
    throw new Error("Not a sealed CatzConnect notification");
  }

  const s = await lib();
  const opened = s.crypto_box_seal_open(
    fromB64(data.catz_sealed),
    fromB64(keys.publicKey),
    fromB64(keys.privateKey),
  );

  const parsed = JSON.parse(s.to_string(opened));
  return {
    title: parsed.title ?? undefined,
    body: parsed.body,
    data: parsed.data ?? {},
    image: parsed.image ?? undefined,
    link: parsed.link ?? undefined,
  };
}
