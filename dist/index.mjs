import {
  generateDeviceKeys,
  isSealedPush,
  openPushPayload
} from "./chunk-NRHGKW5X.mjs";

// src/core/http.ts
var HttpClient = class {
  async post(path, body, env) {
    const baseURL = process.env.CATZCONNECT_BASE_URL ?? "https://api.catzconnect.com";
    const apiKey = env ? env.api_key : process.env.CATZCONNECT_API_KEY;
    if (!apiKey) {
      throw new Error("Missing API key in environment");
    }
    const res = await fetch(`${baseURL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  }
};

// src/core/crypto.ts
import sodium from "libsodium-wrappers-sumo";
var _ready = null;
async function init() {
  if (!_ready) _ready = sodium.ready;
  await _ready;
  return sodium;
}
var b64ToU8 = (b64) => new Uint8Array(Buffer.from(b64, "base64"));
var u8ToB64 = (u) => Buffer.from(u).toString("base64");
async function encrypt(payload, env) {
  if (!env && (!process.env.CATZCONNECT_PRIVATE_KEY || !process.env.CATZCONNECT_SERVER_PUBLIC_KEY)) {
    throw new Error("Missing keys, Make sure keys exists at Environment");
  }
  const s = await init();
  const fp = {
    ...payload,
    ts: Date.now()
  };
  const pk = env ? env.private_key : process.env.CATZCONNECT_PRIVATE_KEY ?? "";
  const spk = env ? env.server_public_key : process.env.CATZCONNECT_SERVER_PUBLIC_KEY ?? "";
  const clientPriv = b64ToU8(pk);
  const serverPub = b64ToU8(spk);
  const shared = s.crypto_scalarmult(clientPriv, serverPub);
  const master = s.crypto_generichash(32, shared, null);
  const label = s.from_string("CONNECT-@-2026-HS-@-CATZ");
  const km = new Uint8Array(master.length + label.length);
  km.set(master, 0);
  km.set(label, master.length);
  const keyEnc = s.crypto_generichash(32, km, null);
  const nonce = s.randombytes_buf(
    s.crypto_aead_chacha20poly1305_ietf_NPUBBYTES
  );
  const message = s.from_string(JSON.stringify(fp));
  const ciphertext = s.crypto_aead_chacha20poly1305_ietf_encrypt(
    message,
    null,
    null,
    nonce,
    keyEnc
  );
  return {
    nonce: u8ToB64(nonce),
    ciphertext: u8ToB64(ciphertext)
  };
}

// src/utils/validators.ts
var EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validateEmail(email) {
  if (!EMAIL_REGEX.test(email)) {
    throw new Error(`Invalid email: ${email}`);
  }
}
function validatePhone(phone) {
  if (phone.includes("@")) {
    throw new Error(`WhatsApp messages go to phone numbers, not email addresses: ${phone}`);
  }
  if (!/^[\d\s()+\-]+$/.test(phone)) {
    throw new Error(`Invalid phone number: ${phone}`);
  }
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    throw new Error(`Invalid phone number: ${phone}`);
  }
}

// src/core/payload.ts
function verifyPayload(input) {
  const { type, channel, template, identity, payload } = input;
  if (channel === "Email" && type === "Verification" && template === "Otp") {
    if (!identity) {
      throw new Error("Missing 'identity'");
    }
    if (!payload.to) {
      throw new Error("Missing 'to' in payload");
    }
    if (payload.otp === void 0 || payload.otp === null) {
      throw new Error("Missing 'otp' in payload");
    }
    if (typeof payload.to !== "string") {
      throw new Error("'to' must be a string");
    }
    validateEmail(payload.to);
    if (typeof payload.otp !== "string") {
      throw new Error("'otp' must be a string");
    }
    if (!/^\d+$/.test(payload.otp)) {
      throw new Error("'otp' must contain only digits");
    }
    if (payload.otp.length !== 6) {
      throw new Error("'otp' must be exactly 6 digits");
    }
    return;
  }
  if (channel === "Email" && type === "Transactional" && template === "Custom") {
    if (!identity) {
      throw new Error("Missing 'identity'");
    }
    if (!payload.to) {
      throw new Error("Missing 'to' in payload");
    }
    if (payload.subject === void 0 || payload.subject === null) {
      throw new Error("Missing 'subject' in payload");
    }
    if (payload.body === void 0 || payload.body === null) {
      throw new Error("Missing 'body' in payload");
    }
    if (typeof payload.to !== "string") {
      throw new Error("'to' must be a string");
    }
    validateEmail(payload.to);
    return;
  }
  if (channel === "WhatsApp" && type === "Verification" && template === "Otp") {
    if (!identity) {
      throw new Error("Missing 'identity'");
    }
    if (!payload.to) {
      throw new Error("Missing 'to' in payload");
    }
    if (typeof payload.to !== "string") {
      throw new Error("'to' must be a string");
    }
    validatePhone(payload.to);
    if (payload.otp === void 0 || payload.otp === null) {
      throw new Error("Missing 'otp' in payload");
    }
    if (typeof payload.otp !== "string") {
      throw new Error("'otp' must be a string");
    }
    if (!/^[A-Za-z0-9]{1,15}$/.test(payload.otp)) {
      throw new Error("'otp' must be up to 15 letters or digits");
    }
    return;
  }
  if (channel === "WhatsApp" && type === "Transactional" && template === "Custom") {
    if (!identity) {
      throw new Error("Missing 'identity'");
    }
    if (!payload.to) {
      throw new Error("Missing 'to' in payload");
    }
    if (typeof payload.to !== "string") {
      throw new Error("'to' must be a string");
    }
    validatePhone(payload.to);
    if (payload.body === void 0 || payload.body === null || payload.body === "") {
      throw new Error("Missing 'body' in payload");
    }
    const length = (payload.subject ? payload.subject.length + 6 : 0) + payload.body.length;
    if (length > 4096) {
      throw new Error("WhatsApp messages are limited to 4096 characters");
    }
    return;
  }
  if (channel === "Push" && type === "Notification" && template === "Notification") {
    if (!identity) {
      throw new Error("Missing 'identity' \u2014 the Firebase project ID");
    }
    const hasTo = payload.to !== void 0 && payload.to !== null && payload.to !== "";
    const hasUser = payload.external_user_id !== void 0 && payload.external_user_id !== null && payload.external_user_id !== "";
    if (hasTo && hasUser) {
      throw new Error("Give either 'to' (one device token) or 'external_user_id' (a user's registered devices), not both");
    }
    if (!hasTo && !hasUser) {
      throw new Error(
        "Missing 'to' in payload \u2014 the device's FCM registration token \u2014 or 'external_user_id' for a user's registered devices"
      );
    }
    if (hasTo) {
      if (typeof payload.to !== "string") {
        throw new Error("'to' must be a string");
      }
      if (payload.to.includes("@")) {
        throw new Error("'to' must be an FCM registration token, not an email address");
      }
    }
    if (hasUser) {
      if (typeof payload.external_user_id !== "string" || payload.external_user_id.length > 128) {
        throw new Error("'external_user_id' must be a string of up to 128 characters");
      }
      if (payload.device_key !== void 0) {
        throw new Error("'device_key' cannot be used with 'external_user_id' \u2014 each registered device's own key is used");
      }
    }
    if (!payload.body || typeof payload.body !== "string") {
      throw new Error("Missing 'body' in payload");
    }
    for (const field of ["image", "link"]) {
      const value = payload[field];
      if (value !== void 0 && (typeof value !== "string" || !value.startsWith("https://"))) {
        throw new Error(`'${field}' must be an https:// URL`);
      }
    }
    if (payload.data !== void 0) {
      for (const [k, v] of Object.entries(payload.data)) {
        if (typeof v !== "string") {
          throw new Error(`'data.${k}' must be a string \u2014 FCM only carries string values`);
        }
      }
    }
    if (payload.device_key !== void 0 && typeof payload.device_key !== "string") {
      throw new Error("'device_key' must be the base64 public key from generateDeviceKeys()");
    }
    return;
  }
  if (channel === "Email" && !["Otp", "Custom", "Notification"].includes(template)) {
    if (!identity) {
      throw new Error("Missing 'identity'");
    }
    if (!payload.to || typeof payload.to !== "string") {
      throw new Error("Missing 'to' in payload");
    }
    validateEmail(payload.to);
    if (payload.data !== void 0) {
      for (const [k, v] of Object.entries(payload.data)) {
        if (typeof v !== "string") {
          throw new Error(`'data.${k}' must be a string`);
        }
      }
    }
    return;
  }
  throw new Error(`Unsupported combination: ${type}.${channel}.${template}`);
}

// src/core/webhook.ts
import { createHmac, timingSafeEqual } from "crypto";
function verifyWebhookSignature(rawBody, header, secret, toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1e3)) {
  if (!header || !secret) return false;
  let t;
  const v1 = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") v1.push(v);
  }
  if (!t || !/^\d+$/.test(t) || v1.length === 0) return false;
  if (toleranceSeconds > 0 && Math.abs(nowSeconds - Number(t)) > toleranceSeconds) return false;
  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : Buffer.from(rawBody);
  const expected = createHmac("sha256", secret).update(`${t}.`).update(body).digest();
  return v1.some((sig) => {
    if (!/^[0-9a-fA-F]{64}$/.test(sig)) return false;
    return timingSafeEqual(expected, Buffer.from(sig, "hex"));
  });
}
function computeUserHash(externalUserId, identitySecret) {
  if (!identitySecret) throw new Error("computeUserHash: identity secret is required");
  return createHmac("sha256", identitySecret).update(externalUserId, "utf8").digest("hex");
}

// src/index.ts
var CatzConnect = class {
  constructor() {
    this.http = new HttpClient();
  }
  async send(input, env) {
    verifyPayload(input);
    const finalPayload = {
      message_type: input.type,
      channel: input.channel,
      template: input.template,
      identity: input.identity,
      ...input.payload
    };
    const enc = await encrypt(finalPayload, env);
    if (!enc) {
      throw new Error("Encryption failed");
    }
    try {
      const res = await this.http.post("/sdk/send", enc, env);
      return res;
    } catch (err) {
      throw new Error(
        `Failed to send ${input.type}.${input.channel}.${input.template}: ${err.message}`
      );
    }
  }
};
var catzconnect = new CatzConnect();
export {
  catzconnect,
  computeUserHash,
  generateDeviceKeys,
  isSealedPush,
  openPushPayload,
  verifyWebhookSignature
};
