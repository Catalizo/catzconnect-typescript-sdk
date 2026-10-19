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
  CALL_MAX_CALLEES: () => CALL_MAX_CALLEES,
  CALL_METADATA_MAX_BYTES: () => CALL_METADATA_MAX_BYTES,
  CALL_TOKEN_TTL_MAX: () => CALL_TOKEN_TTL_MAX,
  CALL_TOKEN_TTL_MIN: () => CALL_TOKEN_TTL_MIN,
  CALL_USER_ID_MAX: () => CALL_USER_ID_MAX,
  CallsApi: () => CallsApi,
  CatzApiError: () => CatzApiError,
  SMS_MAX_SEGMENTS: () => SMS_MAX_SEGMENTS,
  SUPPORTED_LANGUAGES: () => SUPPORTED_LANGUAGES,
  VOICE_MAX_CHARS: () => VOICE_MAX_CHARS,
  VOICE_MAX_REPEAT: () => VOICE_MAX_REPEAT,
  analyseSms: () => analyseSms,
  buildCallTokenPayload: () => buildCallTokenPayload,
  buildCreateCallPayload: () => buildCreateCallPayload,
  buildSendPayload: () => buildSendPayload,
  catzconnect: () => catzconnect,
  computeUserHash: () => computeUserHash,
  generateDeviceKeys: () => generateDeviceKeys,
  isSealedPush: () => isSealedPush,
  isValidDltId: () => isValidDltId,
  isValidLanguage: () => isValidLanguage,
  isValidSmsSender: () => isValidSmsSender,
  isValidVoiceLanguage: () => isValidVoiceLanguage,
  isValidVoiceName: () => isValidVoiceName,
  normaliseE164: () => normaliseE164,
  normaliseLanguage: () => normaliseLanguage,
  openPushPayload: () => openPushPayload,
  parseVoiceRepeat: () => parseVoiceRepeat,
  validateCallUserId: () => validateCallUserId,
  validateVoiceText: () => validateVoiceText,
  verifyVoice: () => verifyVoice,
  verifyWebhookSignature: () => verifyWebhookSignature
});
module.exports = __toCommonJS(index_exports);

// src/core/http.ts
var CatzApiError = class _CatzApiError extends Error {
  constructor(status, message, body, code) {
    super(message);
    this.name = "CatzApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
  /** Builds the error from a response body, reading `message` and `code` when it is JSON. */
  static from(status, body) {
    let message = `HTTP ${status}: ${body}`;
    let code;
    try {
      const j = JSON.parse(body);
      if (j && typeof j === "object") {
        if (typeof j.message === "string" && j.message !== "") message = j.message;
        if (typeof j.code === "string" && j.code !== "") code = j.code;
      }
    } catch {
    }
    return new _CatzApiError(status, message, body, code);
  }
};
var HttpClient = class {
  /**
   * POSTs an encrypted body and returns the decoded JSON. Non-2xx answers,
   * and 2xx answers with `success: false`, throw a {@link CatzApiError}.
   */
  async request(path, body, env) {
    const baseURL = (process.env.CATZCONNECT_BASE_URL ?? "https://api.catzconnect.com").trim().replace(/\/+$/, "");
    const apiKey = (env ? env.api_key : process.env.CATZCONNECT_API_KEY)?.trim();
    if (!apiKey) {
      throw new Error("Missing API key in environment");
    }
    const res = await fetch(`${baseURL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    if (!res.ok) {
      throw CatzApiError.from(res.status, text);
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new CatzApiError(res.status, `The server sent a response that is not JSON: ${text.slice(0, 200)}`, text);
    }
    if (json && typeof json === "object" && json.success === false) {
      throw CatzApiError.from(res.status, text);
    }
    return json;
  }
  async post(path, body, env) {
    const baseURL = (process.env.CATZCONNECT_BASE_URL ?? "https://api.catzconnect.com").trim().replace(/\/+$/, "");
    const apiKey = (env ? env.api_key : process.env.CATZCONNECT_API_KEY)?.trim();
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
      throw new CatzApiError(res.status, `HTTP ${res.status}: ${text}`, text, CatzApiError.from(res.status, text).code);
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
  const keyEnc = deriveKey(s, env);
  const fp = {
    ...payload,
    ts: Date.now()
  };
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
function deriveKey(s, env) {
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
  return s.crypto_generichash(32, km, null);
}
function isSealed(v) {
  return !!v && typeof v === "object" && typeof v.nonce === "string" && typeof v.ciphertext === "string" && Object.keys(v).length === 2;
}
async function openResponse(res, env) {
  const sealedTop = isSealed(res);
  const sealed = sealedTop ? res : res && isSealed(res.data) ? res.data : null;
  if (!sealed) return res;
  const s = await init();
  let plain;
  try {
    plain = s.crypto_aead_chacha20poly1305_ietf_decrypt(
      null,
      b64ToU8(sealed.ciphertext),
      null,
      b64ToU8(sealed.nonce),
      deriveKey(s, env)
    );
  } catch {
    throw new Error("The response is encrypted with a key this SDK cannot open");
  }
  const opened = JSON.parse(s.to_string(plain));
  if (sealedTop) return opened;
  const { data: _sealed, ...rest } = res;
  return opened && typeof opened === "object" && !Array.isArray(opened) ? { ...rest, ...opened, data: opened } : { ...rest, data: opened };
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

// src/utils/voice.ts
var VOICE_MAX_CHARS = 1e3;
var VOICE_MAX_REPEAT = 3;
var VOICE_TYPES = ["Verification", "Transactional", "Notification", "Promotional"];
function isValidVoiceLanguage(s) {
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(s);
}
function isValidVoiceName(s) {
  return /^[A-Za-z0-9._:\- ]{1,64}$/.test(s) && s.trim() === s;
}
function validateVoiceText(text) {
  const t = text.trim();
  if (t === "") {
    throw new Error("The text to speak is empty");
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(t)) {
    throw new Error("The text to speak contains control characters");
  }
  const n = Array.from(t).length;
  if (n > VOICE_MAX_CHARS) {
    throw new Error(`The text to speak is ${n} characters; the limit is ${VOICE_MAX_CHARS}`);
  }
  return t;
}
function parseVoiceRepeat(v) {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!/^\d+$/.test(s)) {
    throw new Error("'data.repeat' must be a whole number from 1 to 3");
  }
  const n = Number(s);
  if (n < 1 || n > VOICE_MAX_REPEAT) {
    throw new Error("'data.repeat' must be a whole number from 1 to 3");
  }
  return n;
}
function isVoiceChannel(channel) {
  return typeof channel === "string" && channel.trim().toLowerCase() === "voice";
}
function verifyVoice(input) {
  const { type, template, payload } = input;
  if (!payload || typeof payload !== "object") {
    throw new Error("Missing 'payload'");
  }
  if (typeof payload.to !== "string" || payload.to.trim() === "") {
    throw new Error("Missing 'to' in payload \u2014 the number to call in E.164, e.g. +14155550100");
  }
  validateE164(payload.to);
  if (!VOICE_TYPES.includes(type)) {
    throw new Error(`Voice supports type Verification, Transactional, Notification or Promotional \u2014 not ${type}`);
  }
  if (payload.provider !== void 0 && payload.provider !== null) {
    if (typeof payload.provider !== "string" || payload.provider.trim() === "") {
      throw new Error("'provider' must be a phone provider's id or label");
    }
  }
  if (payload.data !== void 0 && payload.data !== null) {
    if (typeof payload.data !== "object" || Array.isArray(payload.data)) {
      throw new Error("'data' must be an object of strings");
    }
    for (const [k, v] of Object.entries(payload.data)) {
      if (k === "repeat") {
        parseVoiceRepeat(v);
        continue;
      }
      if (typeof v !== "string") {
        throw new Error(`'data.${k}' must be a string`);
      }
      if (k === "language" && !isValidVoiceLanguage(v)) {
        throw new Error("'data.language' must be a language tag such as en-US");
      }
      if (k === "voice" && !isValidVoiceName(v)) {
        throw new Error("'data.voice' must be female, male or a provider voice name");
      }
    }
  }
  const name = typeof template === "string" ? template.trim() : "";
  if (name === "") {
    throw new Error("Missing 'template' \u2014 Otp, Custom, or the name of a Voice template");
  }
  if (name.toLowerCase() === "otp") {
    if (typeof payload.otp !== "string" || payload.otp.trim() === "") {
      throw new Error("Missing 'otp' in payload");
    }
    if (!/^[A-Za-z0-9]{1,15}$/.test(payload.otp.trim())) {
      throw new Error("'otp' must be up to 15 letters or digits");
    }
    return;
  }
  if (name.toLowerCase() === "custom") {
    if (typeof payload.body !== "string" || payload.body.trim() === "") {
      throw new Error("Missing 'body' in payload \u2014 the text to speak");
    }
    validateVoiceText(payload.body);
  }
}
function buildVoicePayload(input) {
  const p = input.payload;
  const name = input.template.trim();
  const lower = name.toLowerCase();
  const out = {
    message_type: input.type,
    channel: "Voice",
    template: lower === "otp" ? "Otp" : lower === "custom" ? "Custom" : name,
    identity: input.identity ?? "",
    // required by the server, ignored for Voice
    to: validateE164(p.to)
  };
  if (typeof p.otp === "string" && p.otp.trim() !== "") out.otp = p.otp.trim();
  if (typeof p.body === "string" && p.body.trim() !== "") out.body = p.body.trim();
  if (typeof p.provider === "string" && p.provider.trim() !== "") out.provider = p.provider.trim();
  if (p.data && Object.keys(p.data).length > 0) {
    const data = {};
    for (const [k, v] of Object.entries(p.data)) {
      data[k] = k === "repeat" ? String(parseVoiceRepeat(v)) : String(v);
    }
    out.data = data;
  }
  return out;
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
    for (const field2 of ["image", "link"]) {
      const value = payload[field2];
      if (value !== void 0 && (typeof value !== "string" || !value.startsWith("https://"))) {
        throw new Error(`'${field2}' must be an https:// URL`);
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
  if (isVoiceChannel(channel)) {
    verifyVoice(input);
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
function optionalString(v, field2) {
  if (v === void 0 || v === null) return void 0;
  if (typeof v !== "string") {
    throw new Error(`'${field2}' must be a string`);
  }
  const t = v.trim();
  return t === "" ? void 0 : t;
}

// src/calls.ts
var CALL_MAX_CALLEES = 49;
var CALL_USER_ID_MAX = 128;
var CALL_METADATA_MAX_BYTES = 4096;
var CALL_TOKEN_TTL_MIN = 60;
var CALL_TOKEN_TTL_MAX = 86400;
var CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
function validateCallUserId(id, field2 = "user id") {
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(`Missing ${field2}`);
  }
  if (Array.from(id).length > CALL_USER_ID_MAX) {
    throw new Error(`${field2} must be at most ${CALL_USER_ID_MAX} characters`);
  }
  if (CONTROL.test(id)) {
    throw new Error(`${field2} contains control characters`);
  }
  return id;
}
function validateCallId(id) {
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error("Missing call id");
  }
  if (id.length > 128 || CONTROL.test(id)) {
    throw new Error("Invalid call id");
  }
  return id.trim();
}
function utf8Length(s) {
  return new TextEncoder().encode(s).length;
}
function buildCreateCallPayload(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Missing call input");
  }
  if (input.mode !== "audio" && input.mode !== "video") {
    throw new Error(`'mode' must be "audio" or "video"`);
  }
  const from = validateCallUserId(input.from, "'from'");
  if (!Array.isArray(input.to) || input.to.length === 0) {
    throw new Error("'to' must list at least one user id");
  }
  if (input.to.length > CALL_MAX_CALLEES) {
    throw new Error(`'to' can list at most ${CALL_MAX_CALLEES} user ids`);
  }
  const seen = /* @__PURE__ */ new Set();
  for (const u of input.to) {
    validateCallUserId(u, "'to' entry");
    if (u === from) {
      throw new Error("'to' must not include the caller ('from')");
    }
    if (seen.has(u)) {
      throw new Error(`'to' lists '${u}' twice`);
    }
    seen.add(u);
  }
  const out = { mode: input.mode, from, to: [...input.to] };
  if (input.engine !== void 0 && input.engine !== null) {
    if (typeof input.engine !== "string" || input.engine.trim() === "") {
      throw new Error(`'engine' must be "auto", "catz" or a provider id or label`);
    }
    out.engine = input.engine.trim();
  }
  if (input.ring !== void 0 && input.ring !== null) {
    if (typeof input.ring !== "boolean") throw new Error("'ring' must be a boolean");
    out.ring = input.ring;
  }
  if (input.metadata !== void 0 && input.metadata !== null) {
    if (typeof input.metadata !== "object" || Array.isArray(input.metadata)) {
      throw new Error("'metadata' must be a JSON object");
    }
    let json;
    try {
      json = JSON.stringify(input.metadata);
    } catch {
      throw new Error("'metadata' must be serialisable as JSON");
    }
    if (utf8Length(json) > CALL_METADATA_MAX_BYTES) {
      throw new Error("'metadata' must be at most 4 KB as JSON");
    }
    out.metadata = input.metadata;
  }
  if (input.maxParticipants !== void 0 && input.maxParticipants !== null) {
    const n = input.maxParticipants;
    if (!Number.isInteger(n) || n < 2 || n > CALL_MAX_CALLEES + 1) {
      throw new Error(`'maxParticipants' must be a whole number from 2 to ${CALL_MAX_CALLEES + 1}`);
    }
    if (input.to.length + 1 > n) {
      throw new Error(`${input.to.length + 1} participants do not fit 'maxParticipants' ${n}`);
    }
    out.max_participants = n;
  }
  return out;
}
function buildCallTokenPayload(userId, ttlSeconds) {
  const out = { user_id: validateCallUserId(userId, "'userId'") };
  if (ttlSeconds !== void 0 && ttlSeconds !== null) {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < CALL_TOKEN_TTL_MIN || ttlSeconds > CALL_TOKEN_TTL_MAX) {
      throw new Error(`'ttlSeconds' must be a whole number from ${CALL_TOKEN_TTL_MIN} to ${CALL_TOKEN_TTL_MAX}`);
    }
    out.ttl_seconds = ttlSeconds;
  }
  return out;
}
function field(res, name) {
  if (res && typeof res === "object") {
    if (res[name] !== void 0) return res[name];
    if (res.data && typeof res.data === "object" && res.data[name] !== void 0) return res.data[name];
  }
  return void 0;
}
function needCall(res) {
  const call = field(res, "call");
  if (!call || typeof call !== "object" || typeof call.id !== "string") {
    throw new Error(`Unexpected response: no call in ${JSON.stringify(res).slice(0, 200)}`);
  }
  if (!Array.isArray(call.participants)) call.participants = [];
  return call;
}
var CallsApi = class {
  constructor(http = new HttpClient()) {
    this.http = http;
  }
  async post(path, body, env) {
    const enc = await encrypt(body, env);
    if (!enc) throw new Error("Encryption failed");
    const res = await this.http.request(path, enc, env);
    return openResponse(res, env);
  }
  /**
   * Creates a call and (unless `ring: false`) rings the callees. Then call
   * `calls.token(from)` and hand the token to the caller's client, which
   * joins with `client.join(call.id)`.
   */
  async create(input, env) {
    const res = await this.post("/sdk/calls/create", buildCreateCallPayload(input), env);
    return needCall(res);
  }
  /** Mints a user token for the browser/app client. `ttlSeconds` 60–86400, default 3600 on the server. */
  async token(userId, ttlSeconds, env) {
    const res = await this.post("/sdk/calls/token", buildCallTokenPayload(userId, ttlSeconds), env);
    const token = field(res, "token");
    if (typeof token !== "string" || token === "") {
      throw new Error("Unexpected response: no token");
    }
    return {
      token,
      expires_at: field(res, "expires_at") ?? "",
      ws_url: field(res, "ws_url") ?? ""
    };
  }
  /** Reads a call with its participants, duration, billed minutes and end reason. */
  async get(callId, env) {
    const res = await this.post("/sdk/calls/get", { call_id: validateCallId(callId) }, env);
    return needCall(res);
  }
  /** Ends a call for everyone. */
  async end(callId, reason, env) {
    const body = { call_id: validateCallId(callId) };
    if (reason !== void 0 && reason !== null) {
      if (typeof reason !== "string") throw new Error("'reason' must be a string");
      if (reason.trim() !== "") body.reason = reason.trim();
    }
    const res = await this.post("/sdk/calls/end", body, env);
    return { success: res?.success !== false, message: typeof res?.message === "string" ? res.message : "" };
  }
};

// src/utils/language.ts
var SUPPORTED_LANGUAGES = ["en", "de", "ja", "ar", "hi"];
function normaliseLanguage(value) {
  if (typeof value !== "string") {
    throw new Error("'language' must be a string: one of en, de, ja, ar, hi (or a BCP-47 tag such as de-DE)");
  }
  const tag = value.trim();
  const primary = tag.split(/[-_]/)[0].toLowerCase();
  if (!/^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/.test(tag) || !SUPPORTED_LANGUAGES.includes(primary)) {
    throw new Error(
      `Unsupported 'language' "${value}": use one of en, de, ja, ar, hi (or a BCP-47 tag such as de-DE)`
    );
  }
  return primary;
}
function isValidLanguage(value) {
  try {
    normaliseLanguage(value);
    return true;
  } catch {
    return false;
  }
}

// src/core/webhook.ts
var import_node_crypto = require("crypto");
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
  const expected = (0, import_node_crypto.createHmac)("sha256", secret).update(`${t}.`).update(body).digest();
  return v1.some((sig) => {
    if (!/^[0-9a-fA-F]{64}$/.test(sig)) return false;
    return (0, import_node_crypto.timingSafeEqual)(expected, Buffer.from(sig, "hex"));
  });
}
function computeUserHash(externalUserId, identitySecret) {
  if (!identitySecret) throw new Error("computeUserHash: identity secret is required");
  return (0, import_node_crypto.createHmac)("sha256", identitySecret).update(externalUserId, "utf8").digest("hex");
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
function canonicalChannel(input) {
  if (isVoiceChannel(input.channel) && input.channel !== "Voice") {
    return { ...input, channel: "Voice" };
  }
  return input;
}
function buildSendPayload(input) {
  const out = buildChannelPayload(canonicalChannel(input));
  if (input.language !== void 0 && input.language !== null) {
    out.language = normaliseLanguage(input.language);
  }
  return out;
}
function buildChannelPayload(input) {
  if (input.channel === "Voice") {
    return buildVoicePayload(input);
  }
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
    /** Voice & Video calls: `create`, `token`, `get`, `end`. */
    this.calls = new CallsApi(this.http);
  }
  /**
   * The `language` used by every `send()` that does not set one (`en`,
   * `de`, `ja`, `ar`, `hi`, or a BCP-47 tag such as `"de-DE"`). Pass
   * `undefined` to clear it. Throws for an unsupported language.
   */
  setDefaultLanguage(language) {
    this.defaultLanguage = language === void 0 || language === null ? void 0 : normaliseLanguage(language);
  }
  /** The default set with {@link setDefaultLanguage}, normalised (`"de"`), or `undefined`. */
  getDefaultLanguage() {
    return this.defaultLanguage;
  }
  async send(input, env) {
    input = canonicalChannel(input);
    if ((input.language === void 0 || input.language === null) && this.defaultLanguage !== void 0) {
      input = { ...input, language: this.defaultLanguage };
    }
    if (input.language !== void 0 && input.language !== null) {
      input = { ...input, language: normaliseLanguage(input.language) };
    }
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
      throw Object.assign(
        new Error(`Failed to send ${input.type}.${input.channel}.${input.template}: ${err.message}`),
        { status: err?.status, code: err?.code, body: err?.body, cause: err }
      );
    }
  }
};
var catzconnect = new CatzConnect();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CALL_MAX_CALLEES,
  CALL_METADATA_MAX_BYTES,
  CALL_TOKEN_TTL_MAX,
  CALL_TOKEN_TTL_MIN,
  CALL_USER_ID_MAX,
  CallsApi,
  CatzApiError,
  SMS_MAX_SEGMENTS,
  SUPPORTED_LANGUAGES,
  VOICE_MAX_CHARS,
  VOICE_MAX_REPEAT,
  analyseSms,
  buildCallTokenPayload,
  buildCreateCallPayload,
  buildSendPayload,
  catzconnect,
  computeUserHash,
  generateDeviceKeys,
  isSealedPush,
  isValidDltId,
  isValidLanguage,
  isValidSmsSender,
  isValidVoiceLanguage,
  isValidVoiceName,
  normaliseE164,
  normaliseLanguage,
  openPushPayload,
  parseVoiceRepeat,
  validateCallUserId,
  validateVoiceText,
  verifyVoice,
  verifyWebhookSignature
});
