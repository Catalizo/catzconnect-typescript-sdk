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
  const keyEnc = deriveKey(s, env);

  const fp = {
    ...payload,
    ts: Date.now(),
  };

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

type Sodium = typeof sodium;

/** X25519 → BLAKE2b-256 → BLAKE2b-256(master ‖ label); the same key the server derives. */
function deriveKey(s: Sodium, env?: EnvValues): Uint8Array {
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
  return s.crypto_generichash(32, km, null);
}

function isSealed(v: unknown): v is { nonce: string; ciphertext: string } {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as any).nonce === "string" &&
    typeof (v as any).ciphertext === "string" &&
    Object.keys(v as object).length === 2
  );
}

/**
 * Opens a response that carries an encrypted `{nonce, ciphertext}` envelope
 * (at the top level or as `data`) with the same key as the request, and
 * merges the decrypted object in. A plain JSON response is returned as is —
 * which is what `/sdk/*` sends today.
 */
export async function openResponse(res: any, env?: EnvValues): Promise<any> {
  const sealedTop = isSealed(res);
  const sealed = sealedTop ? res : res && isSealed(res.data) ? res.data : null;
  if (!sealed) return res;

  const s = await init();
  let plain: Uint8Array;
  try {
    plain = s.crypto_aead_chacha20poly1305_ietf_decrypt(
      null,
      b64ToU8(sealed.ciphertext),
      null,
      b64ToU8(sealed.nonce),
      deriveKey(s, env),
    );
  } catch {
    throw new Error("The response is encrypted with a key this SDK cannot open");
  }
  const opened = JSON.parse(s.to_string(plain));
  if (sealedTop) return opened;
  const { data: _sealed, ...rest } = res;
  return opened && typeof opened === "object" && !Array.isArray(opened)
    ? { ...rest, ...opened, data: opened }
    : { ...rest, data: opened };
}
