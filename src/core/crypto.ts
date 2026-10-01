import sodium from "libsodium-wrappers-sumo";
import { EnvValues } from "../types";

let _ready: Promise<void> | null = null;
async function init() {
  if (!_ready) _ready = sodium.ready;
  await _ready;
  return sodium;
}

const b64ToU8 = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));
const u8ToB64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

export async function encrypt(
  payload: Record<string, unknown>,
  env?: EnvValues,
): Promise<{ nonce: string; ciphertext: string } | undefined> {
  if (!env && (!process.env.CATZCONNECT_PRIVATE_KEY || !process.env.CATZCONNECT_SERVER_PUBLIC_KEY)) {
    throw new Error("Missing keys, Make sure keys exists at Environment");
  }

  const s = await init();

  const fp = {
    ...payload,
    ts: Date.now(),
  };

  const pk = env ? env.private_key : (process.env.CATZCONNECT_PRIVATE_KEY ?? "");
  const spk = env
    ? env.server_public_key
    : (process.env.CATZCONNECT_SERVER_PUBLIC_KEY ?? "");

  const clientPriv = b64ToU8(pk); // 32 bytes
  const serverPub = b64ToU8(spk); // 32 bytes

  // ECDH: shared = scalarmult(client_priv, server_pub)
  const shared = s.crypto_scalarmult(clientPriv, serverPub);

  // master = BLAKE2b(shared, 32)
  const master = s.crypto_generichash(32, shared, null);

  // key = BLAKE2b(master || label, 32)
  const label = s.from_string("CONNECT-@-2026-HS-@-CATZ");
  const km = new Uint8Array(master.length + label.length);
  km.set(master, 0);
  km.set(label, master.length);
  const keyEnc = s.crypto_generichash(32, km, null);

  // AEAD encrypt
  const nonce = s.randombytes_buf(
    s.crypto_aead_chacha20poly1305_ietf_NPUBBYTES,
  ); // 12 bytes
  const message = s.from_string(JSON.stringify(fp));
  const ciphertext = s.crypto_aead_chacha20poly1305_ietf_encrypt(
    message,
    null,
    null,
    nonce,
    keyEnc,
  );

  return {
    nonce: u8ToB64(nonce),
    ciphertext: u8ToB64(ciphertext),
  };
}
