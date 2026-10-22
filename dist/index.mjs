import {
  PushDevicesApi,
  buildRegisterDevicePayload,
  checkToken,
  generateDeviceKeys,
  isSealedPush,
  openPushPayload,
  pushTopic,
  pushTopics
} from "./chunk-E6EHTNV5.mjs";
import {
  CatzApiError,
  HttpClient,
  checkBaseUrl
} from "./chunk-E2QWHFFB.mjs";

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

// src/utils/whatsapp.ts
var WHATSAPP_TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;
var isHttps = (v) => typeof v === "string" && /^https:\/\/\S+$/.test(v) && v.length <= 2048;
var isMediaId = (v) => typeof v === "string" && /^\d{1,64}$/.test(v);
function checkMediaRef(kind, m, where) {
  const hasLink = m.link !== void 0 && m.link !== null;
  const hasId = m.id !== void 0 && m.id !== null;
  if (hasLink === hasId) throw new Error(`${where}: give exactly one of 'link' (https) or 'id' (Meta media id)`);
  if (hasLink && !isHttps(m.link)) throw new Error(`${where}.link must be an https:// URL`);
  if (hasId && !isMediaId(m.id)) throw new Error(`${where}.id must be a Meta media id (digits)`);
  if (m.filename !== void 0) {
    if (kind !== "document") throw new Error(`${where}.filename is for documents only`);
    if (typeof m.filename !== "string" || m.filename.length > 240 || /[\\/]/.test(m.filename)) {
      throw new Error(`${where}.filename must be up to 240 characters without slashes`);
    }
  }
}
function verifyWhatsAppMedia(m) {
  if (!m || typeof m !== "object") throw new Error("'whatsapp.media' must be an object");
  if (!["image", "document", "video", "audio"].includes(m.type)) {
    throw new Error("'whatsapp.media.type' must be image, document, video or audio");
  }
  checkMediaRef(m.type, m, "'whatsapp.media'");
  if (m.caption !== void 0) {
    if (m.type === "audio") throw new Error("'whatsapp.media.caption' is not allowed for audio");
    if (typeof m.caption !== "string" || m.caption.length > 1024) throw new Error("'whatsapp.media.caption' is at most 1024 characters");
  }
}
function checkParam(v, where) {
  if (typeof v !== "string" || v.trim() === "" || v.length > 1024 || /[\n\t]/.test(v) || / {5,}/.test(v)) {
    throw new Error(`${where} must be non-empty text of up to 1024 characters without new lines, tabs or 5+ spaces in a row`);
  }
}
function verifyWhatsAppOptions(o) {
  if (o === void 0 || o === null) return;
  if (typeof o !== "object") throw new Error("'whatsapp' must be an object");
  if (o.language !== void 0 && (typeof o.language !== "string" || !/^[A-Za-z]{2,3}(_[A-Za-z0-9]{2,4})?$/.test(o.language))) {
    throw new Error("'whatsapp.language' must be a Meta language code such as en, en_US or es_419");
  }
  if (o.header !== void 0) {
    const h = o.header;
    if (h.type === "text") {
      if (typeof h.text !== "string" || h.text.trim() === "" || h.text.length > 60) throw new Error("'whatsapp.header.text' must be 1\u201360 characters");
    } else if (h.type === "image" || h.type === "video" || h.type === "document") {
      checkMediaRef(h.type, h, "'whatsapp.header'");
    } else if (h.type === "location") {
      if (typeof h.latitude !== "number" || typeof h.longitude !== "number") throw new Error("'whatsapp.header' location needs latitude and longitude");
    } else {
      throw new Error("'whatsapp.header.type' must be text, image, video, document or location");
    }
  }
  if (o.body !== void 0) {
    if (Array.isArray(o.body)) o.body.forEach((v, i) => checkParam(v, `'whatsapp.body[${i}]'`));
    else if (o.body && typeof o.body === "object") for (const [k, v] of Object.entries(o.body)) checkParam(v, `'whatsapp.body.${k}'`);
    else throw new Error("'whatsapp.body' must be an array or an object of strings");
  }
  if (o.buttons !== void 0) {
    if (!Array.isArray(o.buttons)) throw new Error("'whatsapp.buttons' must be an array");
    const seen = /* @__PURE__ */ new Set();
    for (const b of o.buttons) {
      if (!Number.isInteger(b.index) || b.index < 0 || b.index > 9) throw new Error("'whatsapp.buttons[].index' must be 0\u20139");
      if (seen.has(b.index)) throw new Error(`'whatsapp.buttons' lists index ${b.index} twice`);
      seen.add(b.index);
      if (b.type === "url") {
        if (typeof b.text !== "string" || b.text === "" || /\s/.test(b.text) || b.text.length > 2e3) throw new Error("A url button needs 'text': the URL suffix without spaces");
      } else if (b.type === "quick_reply") {
        if (b.payload !== void 0 && (typeof b.payload !== "string" || b.payload.length > 256)) throw new Error("A quick_reply 'payload' is at most 256 characters");
      } else if (b.type === "copy_code") {
        if (typeof b.code !== "string" || b.code === "" || b.code.length > 20) throw new Error("A copy_code button needs 'code' of up to 20 characters");
      } else if (b.type === "otp") {
        if (typeof b.code !== "string" || !/^[A-Za-z0-9]{1,15}$/.test(b.code)) throw new Error("An otp button needs 'code': up to 15 letters or digits");
      } else {
        throw new Error("'whatsapp.buttons[].type' must be url, quick_reply, copy_code or otp");
      }
    }
  }
  if (o.media !== void 0) verifyWhatsAppMedia(o.media);
}
function verifyTracking(t, channel) {
  if (t === void 0 || t === null) return;
  if (channel !== "Email") throw new Error("'tracking' applies to the Email channel only");
  if (typeof t !== "object") throw new Error("'tracking' must be an object { opens?, clicks? }");
  for (const k of Object.keys(t)) {
    if (k !== "opens" && k !== "clicks") throw new Error(`'tracking.${k}' is not a tracking option (opens, clicks)`);
    const v = t[k];
    if (v !== void 0 && typeof v !== "boolean") throw new Error(`'tracking.${k}' must be true or false`);
  }
}

// src/core/payload.ts
var EMAIL_TOPIC_KEY = /^[a-z0-9][a-z0-9_-]{0,39}$/;
var PUSH_TOPIC_NAME = /^[A-Za-z0-9_.~-]{1,64}$/;
function pushSendAt(v) {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new Error("'push.send_at' is not a valid date");
    return v.toISOString();
  }
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i.test(v.trim()) || Number.isNaN(Date.parse(v))) {
    throw new Error("'push.send_at' must be an RFC 3339 time with a time zone, e.g. 2026-11-02T09:00:00Z");
  }
  return v.trim();
}
function verifyTopicAndPush(input) {
  const { channel, payload } = input;
  if (payload.topic !== void 0 && payload.topic !== null) {
    if (channel !== "Email") throw new Error("'topic' applies to the Email channel only \u2014 for push topics use push.topic");
    if (typeof payload.topic !== "string" || !EMAIL_TOPIC_KEY.test(payload.topic)) {
      throw new Error("'topic' must be a topic key: lower-case letters, digits, _ and -, up to 40 characters");
    }
  }
  const p = payload.push;
  if (p === void 0 || p === null) return;
  if (channel !== "Push") throw new Error("'push' applies to the Push channel only");
  if (typeof p !== "object") throw new Error("'push' must be an object");
  const many = p.broadcast === true || p.topic !== void 0 && p.topic !== null;
  if (p.broadcast === true && p.topic !== void 0 && p.topic !== null) throw new Error("Give push.broadcast or push.topic, not both");
  if (p.topic !== void 0 && p.topic !== null && (typeof p.topic !== "string" || !PUSH_TOPIC_NAME.test(p.topic))) {
    throw new Error("'push.topic' must be 1\u201364 characters of letters, digits, _ . ~ -");
  }
  if (p.send_at !== void 0 && p.send_at !== null) pushSendAt(p.send_at);
  const hasTo = payload.to !== void 0 && payload.to !== null && payload.to !== "";
  const hasUser = payload.external_user_id !== void 0 && payload.external_user_id !== null && payload.external_user_id !== "";
  if (many && (hasTo || hasUser)) {
    throw new Error("push.broadcast and push.topic send to many devices: leave 'to' and 'external_user_id' out");
  }
  if (many && payload.device_key !== void 0) {
    throw new Error("'device_key' is only for one device token \u2014 registered devices use their own keys");
  }
}
function verifyPayload(input) {
  const { type, channel, template, identity, payload } = input;
  verifyTracking(payload.tracking, channel);
  verifyTopicAndPush(input);
  if (payload.whatsapp !== void 0 && channel !== "WhatsApp") {
    throw new Error("'whatsapp' applies to the WhatsApp channel only");
  }
  if (channel === "WhatsApp" && template === "Custom" && payload.whatsapp?.media !== void 0) {
    if (!identity) throw new Error("Missing 'identity'");
    if (!payload.to || typeof payload.to !== "string") throw new Error("Missing 'to' in payload");
    validatePhone(payload.to);
    verifyWhatsAppMedia(payload.whatsapp.media);
    return;
  }
  if (channel === "WhatsApp" && template !== "Otp" && template !== "Custom") {
    if (!["Transactional", "Verification", "Promotional", "Notification"].includes(type)) {
      throw new Error(`Unsupported combination: ${type}.${channel}.${template}`);
    }
    if (typeof template !== "string" || !WHATSAPP_TEMPLATE_NAME.test(template)) {
      throw new Error("A WhatsApp template name is lower-case letters, digits and underscores (the name approved at Meta)");
    }
    if (!identity) throw new Error("Missing 'identity'");
    if (!payload.to || typeof payload.to !== "string") throw new Error("Missing 'to' in payload");
    validatePhone(payload.to);
    if (payload.otp !== void 0 && (typeof payload.otp !== "string" || !/^[A-Za-z0-9]{1,15}$/.test(payload.otp))) {
      throw new Error("'otp' must be up to 15 letters or digits");
    }
    verifyWhatsAppOptions(payload.whatsapp);
    if (payload.whatsapp?.media !== void 0) throw new Error("'whatsapp.media' goes with template Custom; use 'whatsapp.header' for a template's media");
    return;
  }
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
    const many = payload.push?.broadcast === true || payload.push?.topic !== void 0 && payload.push?.topic !== null;
    if (hasTo && hasUser) {
      throw new Error("Give either 'to' (one device token) or 'external_user_id' (a user's registered devices), not both");
    }
    if (!hasTo && !hasUser && !many) {
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

// src/devapi.ts
var ErrorCodes = {
  // Organization / platform
  ORGANIZATION_SUSPENDED: "organization_suspended",
  SENDING_PAUSED: "sending_paused",
  FEATURE_NOT_IN_PLAN: "feature_not_in_plan",
  PLAN_REQUIRED: "plan_required",
  CHANNEL_LIMIT_REACHED: "channel_limit_reached",
  DAILY_LIMIT_REACHED: "daily_limit_reached",
  MONTHLY_LIMIT_REACHED: "monthly_limit_reached",
  MINUTES_CAP_REACHED: "minutes_cap_reached",
  // API key policy
  KEY_EXPIRED: "key_expired",
  IP_NOT_ALLOWED: "ip_not_allowed",
  KEY_RATE_LIMITED: "key_rate_limited",
  KEY_SEND_LIMIT: "key_send_limit",
  NOT_ALLOWED_FOR_APP_KEYS: "not_allowed_for_app_keys",
  NOT_ALLOWED_FOR_TEST_KEYS: "not_allowed_for_test_keys",
  MANAGEMENT_SCOPE_REQUIRED: "management_scope_required",
  // WhatsApp
  WHATSAPP_INVALID_TEMPLATE: "whatsapp_invalid_template",
  WHATSAPP_TEMPLATE_NOT_APPROVED: "whatsapp_template_not_approved",
  WHATSAPP_TEMPLATE_LANGUAGE_REQUIRED: "whatsapp_template_language_required",
  WHATSAPP_INVALID_TEMPLATE_PARAMS: "whatsapp_invalid_template_params",
  WHATSAPP_INVALID_MEDIA: "whatsapp_invalid_media",
  WHATSAPP_WINDOW_CLOSED: "whatsapp_window_closed",
  // Idempotency and references
  IDEMPOTENCY_CONFLICT: "idempotency_conflict",
  IDEMPOTENCY_IN_PROGRESS: "idempotency_in_progress",
  INVALID_IDEMPOTENCY_KEY: "invalid_idempotency_key",
  INVALID_REFERENCE: "invalid_reference",
  // Lookups
  MESSAGE_NOT_FOUND: "message_not_found",
  // Hosted OTP
  OTP_INVALID: "otp_invalid",
  OTP_EXPIRED: "otp_expired",
  OTP_NOT_FOUND: "otp_not_found",
  OTP_ALREADY_VERIFIED: "otp_already_verified",
  OTP_ATTEMPTS_EXCEEDED: "otp_attempts_exceeded",
  OTP_RESEND_COOLDOWN: "otp_resend_cooldown",
  OTP_SEND_LIMIT: "otp_send_limit",
  // Management API
  UNSUPPORTED_CHANNEL: "unsupported_channel",
  UNKNOWN_OPERATION: "unknown_operation",
  INVALID_REQUEST: "invalid_request",
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  // Opt-outs, topics, push broadcasts, resends
  INVALID_TOPIC: "invalid_topic",
  TOPIC_EMAIL_ONLY: "topic_email_only",
  RECIPIENT_SUPPRESSED: "recipient_suppressed",
  WHATSAPP_OPTED_OUT: "whatsapp_opted_out",
  NOT_CANCELABLE: "not_cancelable",
  NOT_RESENDABLE: "not_resendable",
  CONTENT_GONE: "content_gone"
};
function isRetryableCode(code) {
  return code === ErrorCodes.SENDING_PAUSED || code === ErrorCodes.KEY_RATE_LIMITED || code === ErrorCodes.KEY_SEND_LIMIT || code === ErrorCodes.IDEMPOTENCY_IN_PROGRESS || code === ErrorCodes.OTP_RESEND_COOLDOWN;
}
async function sdkPost(http, path, body, env) {
  const enc = await encrypt(body, env);
  if (!enc) throw new Error("Encryption failed");
  const res = await http.request(path, enc, env);
  return res && typeof res === "object" && "data" in res ? res.data : res;
}
function str(v, field2, max = 320) {
  if (typeof v !== "string" || v.trim() === "") throw new Error(`Missing '${field2}'`);
  if (v.length > max) throw new Error(`'${field2}' must be at most ${max} characters`);
  return v.trim();
}
function optInt(v, field2, min, max) {
  if (v === void 0 || v === null) return void 0;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(`'${field2}' must be a whole number from ${min} to ${max}`);
  }
  return v;
}
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(v, field2) {
  if (typeof v !== "string" || !UUID_RE.test(v.trim())) throw new Error(`'${field2}' must be a message id (UUID)`);
  return v.trim();
}
function validateReference(v) {
  if (v === void 0 || v === null) return void 0;
  if (typeof v !== "string") throw new Error("'reference' must be a string");
  const t = v.trim();
  if (t === "") return void 0;
  if ([...t].length > 128 || /[\u0000-\u001f\u007f]/.test(t)) {
    throw new Error("'reference' must be up to 128 characters without line breaks or control characters");
  }
  return t;
}
function validateIdempotencyKey(v) {
  if (v === void 0 || v === null) return void 0;
  if (typeof v !== "string" || !/^[\x21-\x7e]{1,255}$/.test(v.trim())) {
    throw new Error("'idempotencyKey' must be 1\u2013255 visible ASCII characters without spaces");
  }
  return v.trim();
}
var CHANNELS = ["email", "sms", "whatsapp", "push", "voice"];
function buildListMessagesPayload(input) {
  const out = {};
  if (input.recipient !== void 0) out.recipient = str(input.recipient, "recipient");
  if (input.reference !== void 0) out.reference = validateReference(input.reference);
  if (input.broadcastId !== void 0) out.broadcast_id = uuid(input.broadcastId, "broadcastId");
  if (out.recipient === void 0 && out.reference === void 0 && out.broadcast_id === void 0) {
    throw new Error("Give 'recipient', 'reference' or 'broadcastId'");
  }
  if (input.channel !== void 0) {
    const c = String(input.channel).toLowerCase();
    if (!CHANNELS.includes(c)) throw new Error("'channel' must be email, sms, whatsapp, push or voice");
    out.channel = c;
  }
  const limit = optInt(input.limit, "limit", 1, 100);
  if (limit !== void 0) out.limit = limit;
  if (input.before !== void 0) out.before = str(input.before, "before", 64);
  return out;
}
var MessagesApi = class {
  constructor(http = new HttpClient()) {
    this.http = http;
  }
  /** One message by the `message_id` a send returned, with its event timeline. */
  async get(messageId, env) {
    return sdkPost(this.http, "/sdk/messages/get", { message_id: uuid(messageId, "messageId") }, env);
  }
  /** Recent messages to a recipient and/or with a `reference`, newest first. */
  async list(input, env) {
    const d = await sdkPost(this.http, "/sdk/messages/list", buildListMessagesPayload(input), env);
    return { messages: Array.isArray(d?.messages) ? d.messages : [], next_before: d?.next_before ?? null };
  }
};
var OTP_CHANNELS = { email: "Email", sms: "SMS", whatsapp: "WhatsApp", voice: "Voice" };
function buildOtpStartPayload(input) {
  const ch = OTP_CHANNELS[String(input.channel ?? "").toLowerCase()];
  if (!ch) throw new Error("'channel' must be Email, SMS, WhatsApp or Voice");
  const out = { channel: ch, to: str(input.to, "to") };
  const opt = (k, v) => {
    if (typeof v === "string" && v.trim() !== "") out[k] = v.trim();
  };
  opt("identity", input.identity);
  opt("template", input.template);
  opt("language", input.language);
  opt("gateway", input.gateway);
  opt("sender", input.sender);
  opt("dlt_template_id", input.dltTemplateId);
  opt("provider", input.provider);
  const nums = [
    ["code_length", input.codeLength, 4, 10],
    ["ttl_seconds", input.ttlSeconds, 60, 3600],
    ["max_attempts", input.maxAttempts, 1, 10],
    ["resend_cooldown_seconds", input.resendCooldownSeconds, 10, 3600]
  ];
  for (const [k, v, min, max] of nums) {
    const n = optInt(v, k, min, max);
    if (n !== void 0) out[k] = n;
  }
  if (input.whatsapp !== void 0) out.whatsapp = input.whatsapp;
  if (input.data !== void 0) {
    for (const [k, v] of Object.entries(input.data)) {
      if (typeof v !== "string") throw new Error(`'data.${k}' must be a string`);
    }
    out.data = input.data;
  }
  const ref = validateReference(input.reference);
  if (ref !== void 0) out.reference = ref;
  return out;
}
function buildOtpVerifyPayload(input) {
  const code = typeof input.code === "string" ? input.code.replace(/[\s-]/g, "") : "";
  if (!/^[A-Za-z0-9]{1,15}$/.test(code)) throw new Error("'code' must be the 1\u201315 letters or digits that were sent");
  if (input.verificationId !== void 0) {
    return { verification_id: uuid(input.verificationId, "verificationId"), code };
  }
  const ch = OTP_CHANNELS[String(input.channel ?? "").toLowerCase()];
  if (!ch || typeof input.to !== "string" || input.to.trim() === "") {
    throw new Error("Give 'verificationId', or 'channel' and 'to'");
  }
  return { channel: ch, to: input.to.trim(), code };
}
var OtpApi = class {
  constructor(http = new HttpClient()) {
    this.http = http;
  }
  /** Send a code (again: a resend replaces the code, after the cooldown). */
  async start(input, env) {
    return sdkPost(this.http, "/sdk/otp/start", buildOtpStartPayload(input), env);
  }
  /** Check a code. Resolves only when it is correct. */
  async verify(input, env) {
    return sdkPost(this.http, "/sdk/otp/verify", buildOtpVerifyPayload(input), env);
  }
};
function suppressionTopic(channel, topic) {
  if (topic === void 0 || topic === null) return void 0;
  if (String(channel).toLowerCase() !== "email") throw new Error("'topic' applies to email suppressions only");
  if (typeof topic !== "string" || !EMAIL_TOPIC_KEY.test(topic)) throw new Error("'topic' must be a topic key");
  return topic;
}
var ManageApi = class {
  constructor(http = new HttpClient()) {
    this.http = http;
    this.templates = {
      list: (channel, env) => this.call("templates", "list", channel ? { channel } : {}, env),
      get: (idOrName, env) => this.call("templates", "get", { ...idOrName }, env),
      save: (t, env) => {
        str(t.name, "name", 80);
        if (typeof t.body !== "string") throw new Error("Missing 'body'");
        return this.call("templates", "save", { ...t }, env);
      },
      delete: (id, env) => this.call("templates", "delete", { id }, env),
      /** A language version (`de`, `pt-BR`) of a template. */
      saveVariant: (v, env) => this.call("templates", "variant_save", { ...v }, env),
      deleteVariant: (templateId, language, env) => this.call("templates", "variant_delete", { template_id: templateId, language }, env)
    };
    this.webhooks = {
      list: (env) => this.call("webhooks", "list", {}, env),
      /** Create (no `id`; the answer has the signing `secret`, once) or update. */
      save: (w, env) => {
        str(w.url, "url", 2048);
        if (!Array.isArray(w.events) || w.events.length === 0) throw new Error("Choose at least one event");
        return this.call("webhooks", "save", { ...w }, env);
      },
      delete: (id, env) => this.call("webhooks", "delete", { id }, env)
    };
    this.suppressions = {
      list: (q = {}, env) => this.call("suppressions", "list", { ...q }, env),
      /** `detail` as a string, or `{ detail?, topic? }` (topic: email only). */
      add: (channel, address, options, env) => {
        const o = typeof options === "string" ? { detail: options } : options ?? {};
        const topic = suppressionTopic(channel, o.topic);
        return this.call(
          "suppressions",
          "add",
          { channel, address: str(address, "address"), ...o.detail ? { detail: o.detail } : {}, ...topic ? { topic } : {} },
          env
        );
      },
      /** `remove("a@b.co")`, `remove("+15550100", "sms")` or `remove({ id })` / `remove({ channel, address, topic })`. */
      remove: (target, channel, env) => {
        const t = typeof target === "string" ? { address: target, channel } : target;
        if (t.id !== void 0) return this.call("suppressions", "remove", { id: uuid(t.id, "id") }, env);
        const body = { address: str(t.address, "address") };
        if (t.channel) body.channel = t.channel;
        const topic = suppressionTopic(String(t.channel ?? "email"), t.topic);
        if (topic) body.topic = topic;
        return this.call("suppressions", "remove", body, env);
      }
    };
    this.keys = {
      list: (env) => this.call("keys", "list", {}, env),
      create: (k, env) => {
        str(k.name, "name", 100);
        if (k.kind !== void 0 && k.kind !== "server" && k.kind !== "test") throw new Error("'kind' must be server or test");
        return this.call("keys", "create", { ...k }, env);
      },
      rotate: (id, rotateEte = false, env) => this.call("keys", "rotate", { id, rotate_ete: rotateEte }, env),
      revoke: (id, env) => this.call("keys", "revoke", { id }, env),
      /** Replaces the whole policy (omitted fields are cleared). */
      setPolicy: (id, policy, env) => this.call("keys", "policy", { id, ...policy }, env)
    };
  }
  call(resource, op, body, env) {
    return sdkPost(this.http, `/sdk/manage/${resource}/${op}`, body, env);
  }
};
function buildPushTopicChangePayload(input) {
  const out = { identity: str(input.identity, "identity", 200), topic: pushTopic(input.topic) };
  if (input.tokens !== void 0) {
    if (!Array.isArray(input.tokens) || input.tokens.length > 1e3) throw new Error("'tokens' must list at most 1000 tokens");
    out.tokens = input.tokens.map((t) => checkToken(t));
  }
  if (input.externalUserId !== void 0) out.external_user_id = str(input.externalUserId, "externalUserId", 128);
  const hasTokens = Array.isArray(out.tokens) && out.tokens.length > 0;
  if (!hasTokens && out.external_user_id === void 0) {
    throw new Error("Give 'tokens' (registered devices) or 'externalUserId'");
  }
  return out;
}
var PushApi = class {
  constructor(http = new HttpClient()) {
    this.http = http;
  }
  /** Status and counters of a broadcast or scheduled push. */
  async broadcast(broadcastId, env) {
    return sdkPost(this.http, "/sdk/push/broadcast", { broadcast_id: uuid(broadcastId, "broadcastId") }, env);
  }
  /** Stop one that has not finished (`not_cancelable` once it has). Devices already queued still get it. */
  async cancel(broadcastId, env) {
    return sdkPost(this.http, "/sdk/push/cancel", { broadcast_id: uuid(broadcastId, "broadcastId") }, env);
  }
  /** Subscribe registered devices to a topic. Resolves `{ topic, devices }` (devices matched). */
  async subscribe(input, env) {
    return sdkPost(this.http, "/sdk/push/topic/subscribe", buildPushTopicChangePayload(input), env);
  }
  async unsubscribe(input, env) {
    return sdkPost(this.http, "/sdk/push/topic/unsubscribe", buildPushTopicChangePayload(input), env);
  }
  /** A project's topics with their subscribed devices. */
  async topics(identity, env) {
    return sdkPost(this.http, "/sdk/push/topics", { identity: str(identity, "identity", 200) }, env);
  }
};

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
var WEBHOOK_EVENTS = [
  "email.sent",
  "email.failed",
  "email.bounced",
  "email.opened",
  "email.clicked",
  "email.received",
  "whatsapp.status",
  "whatsapp.inbound",
  "whatsapp.read",
  "push.sent",
  "push.failed",
  "sms.sent",
  "sms.delivered",
  "sms.failed",
  "sms.unknown",
  "call.ringing",
  "call.started",
  "call.ended",
  "call.missed",
  "call.declined",
  "call.canceled",
  "call.failed",
  "participant.joined",
  "participant.left",
  "voice.answered",
  "voice.completed",
  "voice.failed",
  "voice.unknown",
  "email.complained",
  "email.unsubscribed",
  "push.opened",
  "sms.inbound",
  "sms.opt_out",
  "whatsapp.opt_out"
];
function parseWebhookEvent(rawBody, header, secret, toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1e3)) {
  if (!verifyWebhookSignature(rawBody, header, secret, toleranceSeconds, nowSeconds)) {
    throw new Error("Invalid webhook signature");
  }
  const text = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8");
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("The webhook body is not JSON");
  }
  if (!j || typeof j !== "object" || typeof j.type !== "string" || typeof j.id !== "string") {
    throw new Error("The webhook body is not a Catz Connect event");
  }
  return { ...j, test: j.test === true || j?.data?.test === true, data: j.data ?? {} };
}
function computeUserHash(externalUserId, identitySecret) {
  if (!identitySecret) throw new Error("computeUserHash: identity secret is required");
  return createHmac("sha256", identitySecret).update(externalUserId, "utf8").digest("hex");
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
  if (out.push && typeof out.push === "object") {
    const p = { ...out.push };
    if (p.send_at !== void 0 && p.send_at !== null) p.send_at = pushSendAt(p.send_at);
    out.push = p;
  }
  if (input.language !== void 0 && input.language !== null) {
    out.language = normaliseLanguage(input.language);
  }
  const idem = validateIdempotencyKey(input.idempotencyKey);
  if (idem !== void 0) out.idempotency_key = idem;
  const ref = validateReference(input.reference);
  if (ref !== void 0) out.reference = ref;
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
    /** Status and event timeline of sent messages: `get`, `list`. */
    this.messages = new MessagesApi(this.http);
    /** Hosted one-time codes: `start`, `verify`. */
    this.otp = new OtpApi(this.http);
    /** Management API (key with the management scope): templates, webhooks, suppressions, keys. */
    this.manage = new ManageApi(this.http);
    /** Push device registry with the publishable key: `register`, `unregister`, `opened`, `subscribeTopics`, `unsubscribeTopics`. */
    this.pushDevices = new PushDevicesApi();
    /** Push broadcasts / scheduled pushes and topic subscriptions (server key): `broadcast`, `cancel`, `subscribe`, `unsubscribe`, `topics`. */
    this.push = new PushApi(this.http);
  }
  /**
   * The `language` used by every `send()` that does not set one (`en`,
   * `de`, `ja`, `ar`, `hi`, or a BCP-47 tag such as `"de-DE"`). Pass
   * `undefined` to clear it. Throws for an unsupported language.
   */
  setDefaultLanguage(language) {
    this.defaultLanguage = language === void 0 || language === null ? void 0 : normaliseLanguage(language);
  }
  /**
   * Allow a plain `http://` `CATZCONNECT_BASE_URL` to a host other than
   * localhost / 127.0.0.1 / ::1 / 10.0.2.2 (same as
   * `CATZCONNECT_ALLOW_INSECURE_HTTP=1`). Default false: such a URL throws,
   * since the API key would be sent unencrypted.
   */
  setAllowInsecureHttp(allow) {
    this.http.allowInsecureHttp = !!allow;
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
      const headers = {};
      if (typeof finalPayload.idempotency_key === "string") headers["Idempotency-Key"] = finalPayload.idempotency_key;
      const res = await this.http.post("/sdk/send", enc, env, headers);
      return res;
    } catch (err) {
      throw Object.assign(
        new Error(`Failed to send ${input.type}.${input.channel}.${input.template}: ${err.message}`),
        { status: err?.status, code: err?.code, details: err?.details, body: err?.body, cause: err }
      );
    }
  }
};
var catzconnect = new CatzConnect();
export {
  CALL_MAX_CALLEES,
  CALL_METADATA_MAX_BYTES,
  CALL_TOKEN_TTL_MAX,
  CALL_TOKEN_TTL_MIN,
  CALL_USER_ID_MAX,
  CallsApi,
  CatzApiError,
  ErrorCodes,
  ManageApi,
  MessagesApi,
  OtpApi,
  PushApi,
  PushDevicesApi,
  SMS_MAX_SEGMENTS,
  SUPPORTED_LANGUAGES,
  VOICE_MAX_CHARS,
  VOICE_MAX_REPEAT,
  WEBHOOK_EVENTS,
  WHATSAPP_TEMPLATE_NAME,
  analyseSms,
  buildCallTokenPayload,
  buildCreateCallPayload,
  buildListMessagesPayload,
  buildOtpStartPayload,
  buildOtpVerifyPayload,
  buildPushTopicChangePayload,
  buildRegisterDevicePayload,
  buildSendPayload,
  catzconnect,
  checkBaseUrl,
  computeUserHash,
  generateDeviceKeys,
  isRetryableCode,
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
  parseWebhookEvent,
  pushTopics,
  validateCallUserId,
  validateIdempotencyKey,
  validateReference,
  validateVoiceText,
  verifyVoice,
  verifyWebhookSignature,
  verifyWhatsAppMedia,
  verifyWhatsAppOptions
};
