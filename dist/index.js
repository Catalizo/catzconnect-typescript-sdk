"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  catzconnect: () => catzconnect,
  generateDeviceKeys: () => generateDeviceKeys,
  isSealedPush: () => isSealedPush,
  openPushPayload: () => openPushPayload
});
module.exports = __toCommonJS(index_exports);

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
var import_libsodium_wrappers_sumo = __toESM(require("libsodium-wrappers-sumo"));
var _ready = null;
async function init() {
  if (!_ready) _ready = import_libsodium_wrappers_sumo.default.ready;
  await _ready;
  return import_libsodium_wrappers_sumo.default;
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
    if (!payload.to || typeof payload.to !== "string") {
      throw new Error("Missing 'to' in payload \u2014 the device's FCM registration token");
    }
    if (payload.to.includes("@")) {
      throw new Error("'to' must be an FCM registration token, not an email address");
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
  throw new Error(`Unsupported combination: ${type}.${channel}.${template}`);
}

// src/push.ts
var import_libsodium_wrappers_sumo2 = __toESM(require("libsodium-wrappers-sumo"));
var ready = null;
async function lib() {
  if (!ready) ready = import_libsodium_wrappers_sumo2.default.ready;
  await ready;
  return import_libsodium_wrappers_sumo2.default;
}
var toB64 = (u) => import_libsodium_wrappers_sumo2.default.to_base64(u, import_libsodium_wrappers_sumo2.default.base64_variants.ORIGINAL);
var fromB64 = (s) => import_libsodium_wrappers_sumo2.default.from_base64(s, import_libsodium_wrappers_sumo2.default.base64_variants.ORIGINAL);
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  catzconnect,
  generateDeviceKeys,
  isSealedPush,
  openPushPayload
});
