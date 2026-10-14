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

// src/utils/sms.ts
var SMS_MAX_SEGMENTS = 10;
function normaliseE164(raw) {
  const cleaned = raw.trim().replace(/[ \-.()]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(cleaned) ? cleaned : null;
}
function validateE164(phone) {
  const n = normaliseE164(phone);
  if (n === null) {
    throw new Error(
      `'${phone.trim()}' is not an E.164 phone number \u2014 use + and the country code, e.g. +919876543210`
    );
  }
  return n;
}
function isValidSmsSender(s) {
  if (s.startsWith("+")) {
    return normaliseE164(s) === s;
  }
  return /^[A-Za-z0-9 ]{2,11}$/.test(s) && /[A-Za-z]/.test(s) && !s.startsWith(" ") && !s.endsWith(" ");
}
function isValidDltId(s) {
  return /^\d{6,30}$/.test(s);
}
var GSM_BASIC = `@\xA3$\xA5\xE8\xE9\xF9\xEC\xF2\xC7
\xD8\xF8\r\xC5\xE5\u0394_\u03A6\u0393\u039B\u03A9\u03A0\u03A8\u03A3\u0398\u039E\xC6\xE6\xDF\xC9 !"#\xA4%&'()*+,-./0123456789:;<=>?\xA1ABCDEFGHIJKLMNOPQRSTUVWXYZ\xC4\xD6\xD1\xDC\xA7\xBFabcdefghijklmnopqrstuvwxyz\xE4\xF6\xF1\xFC\xE0`;
var GSM_EXTENSION = "^{}\\[~]|\u20AC\f";
function gsmCost(c) {
  if (GSM_BASIC.includes(c)) return 1;
  if (GSM_EXTENSION.includes(c)) return 2;
  return null;
}
function countSegments(costs, total, single, multi) {
  if (total <= single) return 1;
  let parts = 1;
  let used = 0;
  for (const c of costs) {
    if (used + c > multi) {
      parts += 1;
      used = 0;
    }
    used += c;
  }
  return parts;
}
function analyseSms(text) {
  const chars = Array.from(text);
  const gsm = chars.map(gsmCost);
  if (gsm.every((c) => c !== null)) {
    const costs2 = gsm;
    const units2 = costs2.reduce((a, b) => a + b, 0);
    return { encoding: "gsm7", units: units2, segments: countSegments(costs2, units2, 160, 153), chars: chars.length };
  }
  const costs = chars.map((c) => c.length);
  const units = costs.reduce((a, b) => a + b, 0);
  return { encoding: "ucs2", units, segments: countSegments(costs, units, 70, 67), chars: chars.length };
}
function validateSmsBody(body) {
  if (body.trim() === "") {
    throw new Error("The message is empty");
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(body)) {
    throw new Error("The message contains control characters");
  }
  const a = analyseSms(body);
  if (a.segments > SMS_MAX_SEGMENTS) {
    throw new Error(
      `The message is ${a.segments} segments long; the limit is ${SMS_MAX_SEGMENTS} (${a.encoding === "gsm7" ? 1530 : 670} characters in ${a.encoding.toUpperCase()})`
    );
  }
  return a;
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
  if (channel === "SMS") {
    verifySms(input);
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
var SMS_TYPES = ["Verification", "Transactional", "Promotional"];
function verifySms(input) {
  const { type, template, payload } = input;
  if (typeof payload.to !== "string" || payload.to.trim() === "") {
    throw new Error("Missing 'to' in payload \u2014 the recipient's number in E.164, e.g. +919876543210");
  }
  const to = validateE164(payload.to);
  if (!SMS_TYPES.includes(type)) {
    throw new Error(`SMS supports type Verification (template Otp), Transactional or Promotional \u2014 not ${type}`);
  }
  const gateway = optionalString(payload.gateway, "gateway");
  const sender = optionalString(payload.sender, "sender");
  if (sender !== void 0) {
    if (gateway === void 0) {
      throw new Error("'sender' can only be used together with 'gateway'");
    }
    if (!isValidSmsSender(sender)) {
      throw new Error("'sender' must be an E.164 number or a 2\u201311 character sender ID");
    }
  }
  const dlt = optionalString(payload.dlt_template_id, "dlt_template_id");
  if (dlt !== void 0 && !isValidDltId(dlt)) {
    throw new Error("'dlt_template_id' must be the numeric DLT template ID");
  }
  if (payload.data !== void 0) {
    if (payload.data === null || typeof payload.data !== "object") {
      throw new Error("'data' must be an object of strings");
    }
    for (const [k, v] of Object.entries(payload.data)) {
      if (typeof v !== "string") {
        throw new Error(`'data.${k}' must be a string`);
      }
    }
  }
  const name = typeof template === "string" ? template.trim() : "";
  if (name === "") {
    throw new Error("Missing 'template' \u2014 Otp, Custom, or the name of an SMS template");
  }
  if (name.toLowerCase() === "otp") {
    if (type !== "Verification") {
      throw new Error("template Otp goes with type Verification");
    }
    if (typeof payload.otp !== "string" || payload.otp.trim() === "") {
      throw new Error("Missing 'otp' in payload");
    }
    if (!/^[A-Za-z0-9]{1,15}$/.test(payload.otp.trim())) {
      throw new Error("'otp' must be up to 15 letters or digits");
    }
    return;
  }
  if (name.toLowerCase() === "custom") {
    if (type === "Verification") {
      throw new Error("type Verification goes with template Otp; use Transactional for Custom");
    }
    if (typeof payload.body !== "string" || payload.body.trim() === "") {
      throw new Error("Missing 'body' in payload");
    }
    validateSmsBody(payload.body.trim());
    if (to.startsWith("+91") && dlt === void 0) {
      throw new Error("India (+91) requires a DLT template ID: pass 'dlt_template_id' for Custom messages");
    }
    return;
  }
}
function optionalString(v, field) {
  if (v === void 0 || v === null) return void 0;
  if (typeof v !== "string") {
    throw new Error(`'${field}' must be a string`);
  }
  const t = v.trim();
  return t === "" ? void 0 : t;
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
function buildSendPayload(input) {
  if (input.channel === "SMS") {
    const p = input.payload;
    const out = {
      message_type: input.type,
      channel: "SMS",
      template: input.template,
      identity: input.identity ?? "",
      // required by the server, ignored for SMS
      to: p.to
    };
    for (const k of ["otp", "body", "gateway", "sender", "dlt_template_id"]) {
      const v = p[k];
      if (typeof v === "string" && v.trim() !== "") out[k] = v;
    }
    if (p.data !== void 0 && Object.keys(p.data).length > 0) out.data = p.data;
    return out;
  }
  return {
    message_type: input.type,
    channel: input.channel,
    template: input.template,
    identity: input.identity,
    ...input.payload
  };
}
var CatzConnect = class {
  constructor() {
    this.http = new HttpClient();
  }
  async send(input, env) {
    verifyPayload(input);
    const finalPayload = buildSendPayload(input);
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
  SMS_MAX_SEGMENTS,
  analyseSms,
  buildSendPayload,
  catzconnect,
  computeUserHash,
  generateDeviceKeys,
  isSealedPush,
  isValidDltId,
  isValidSmsSender,
  normaliseE164,
  openPushPayload,
  verifyWebhookSignature
};
