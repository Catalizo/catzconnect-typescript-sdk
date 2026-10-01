// src/push.ts
import sodium from "libsodium-wrappers-sumo";
var ready = null;
async function lib() {
  if (!ready) ready = sodium.ready;
  await ready;
  return sodium;
}
var toB64 = (u) => sodium.to_base64(u, sodium.base64_variants.ORIGINAL);
var fromB64 = (s) => sodium.from_base64(s, sodium.base64_variants.ORIGINAL);
async function generateDeviceKeys() {
  const s = await lib();
  const kp = s.crypto_box_keypair();
  return { publicKey: toB64(kp.publicKey), privateKey: toB64(kp.privateKey) };
}
function isSealedPush(data) {
  return !!data && data.catz_v === "1" && typeof data.catz_sealed === "string";
}
async function openPushPayload(data, keys) {
  if (!isSealedPush(data)) {
    throw new Error("Not a sealed CatzConnect notification");
  }
  const s = await lib();
  const opened = s.crypto_box_seal_open(
    fromB64(data.catz_sealed),
    fromB64(keys.publicKey),
    fromB64(keys.privateKey)
  );
  const parsed = JSON.parse(s.to_string(opened));
  return {
    title: parsed.title ?? void 0,
    body: parsed.body,
    data: parsed.data ?? {},
    image: parsed.image ?? void 0,
    link: parsed.link ?? void 0
  };
}

export {
  generateDeviceKeys,
  isSealedPush,
  openPushPayload
};
