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

// src/push.ts
var push_exports = {};
__export(push_exports, {
  PushDevicesApi: () => PushDevicesApi,
  buildRegisterDevicePayload: () => buildRegisterDevicePayload,
  generateDeviceKeys: () => generateDeviceKeys,
  isSealedPush: () => isSealedPush,
  openPushPayload: () => openPushPayload,
  pushTopics: () => pushTopics
});
module.exports = __toCommonJS(push_exports);
var import_libsodium_wrappers_sumo = __toESM(require("libsodium-wrappers-sumo"));

// src/core/http.ts
var CatzApiError = class _CatzApiError extends Error {
  constructor(status, message, body, code) {
    super(message);
    this.name = "CatzApiError";
    this.status = status;
    this.code = code;
    this.body = body;
    try {
      const j = JSON.parse(body);
      if (j && typeof j === "object" && !Array.isArray(j)) this.details = j;
    } catch {
    }
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
var LOCAL_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "::1", "[::1]", "10.0.2.2"]);
function checkBaseUrl(raw, allowInsecure = false, what = "CATZCONNECT_BASE_URL") {
  const url = raw.trim().replace(/\/+$/, "");
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`${what} is not a valid URL: ${JSON.stringify(url)}`);
  }
  const scheme = u.protocol.toLowerCase();
  if (scheme === "https:" || scheme === "wss:") return url;
  if (scheme !== "http:" && scheme !== "ws:") {
    throw new Error(`${what} must start with https:// (got ${JSON.stringify(u.protocol)})`);
  }
  if (allowInsecure || LOCAL_HOSTS.has(u.hostname.toLowerCase())) return url;
  throw new Error(
    `${what} uses plain ${scheme.slice(0, -1)}:// to ${u.hostname}: the API key and tokens would travel unencrypted. Use https://, or set CATZCONNECT_ALLOW_INSECURE_HTTP=1 / catzconnect.setAllowInsecureHttp(true) to allow it anyway.`
  );
}
function insecureHttpFromEnv() {
  const v = (typeof process !== "undefined" ? process.env?.CATZCONNECT_ALLOW_INSECURE_HTTP : void 0) ?? "";
  return ["1", "true", "yes"].includes(v.trim().toLowerCase());
}
var DEFAULT_BASE_URL = "https://api.catzconnect.com";
function baseUrlFromEnv() {
  const v = (typeof process !== "undefined" ? process.env?.CATZCONNECT_BASE_URL : void 0) ?? "";
  return v.trim() === "" ? DEFAULT_BASE_URL : v;
}
async function postPublic(path, body, baseUrl, allowInsecure = false) {
  const base = checkBaseUrl(baseUrl ?? baseUrlFromEnv(), allowInsecure || insecureHttpFromEnv());
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) throw CatzApiError.from(res.status, text);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new CatzApiError(res.status, `The server sent a response that is not JSON: ${text.slice(0, 200)}`, text);
  }
  if (json && typeof json === "object" && json.success === false) throw CatzApiError.from(res.status, text);
  return json;
}

// src/devices.ts
var PUSH_TOPIC_NAME = /^[A-Za-z0-9_.~-]{1,64}$/;
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(v, field) {
  if (typeof v !== "string" || !UUID_RE.test(v.trim())) throw new Error(`'${field}' must be a message id (UUID)`);
  return v.trim();
}
function pk(v) {
  if (typeof v !== "string" || v.trim().length < 10 || v.trim().length > 100) throw new Error("'publishableKey' is required");
  return v.trim();
}
function checkToken(v) {
  if (typeof v !== "string" || v.trim().length < 32 || v.trim().length > 4096) {
    throw new Error("'token' must be the device's FCM registration token");
  }
  return v.trim();
}
function buildRegisterDevicePayload(input) {
  if (!["ios", "android", "web"].includes(input.platform)) throw new Error("'platform' must be ios, android or web");
  const out = { publishable_key: pk(input.publishableKey), token: checkToken(input.token), platform: input.platform };
  if (input.externalUserId !== void 0) {
    const u = input.externalUserId;
    if (typeof u !== "string" || u.length < 1 || [...u].length > 128 || /[\u0000-\u001f\u007f]/.test(u)) {
      throw new Error("'externalUserId' must be 1\u2013128 characters");
    }
    out.external_user_id = u;
  }
  if (input.userHash !== void 0) out.user_hash = input.userHash;
  if (input.appVersion !== void 0) {
    if (typeof input.appVersion !== "string" || input.appVersion.length > 40) throw new Error("'appVersion' is at most 40 characters");
    out.app_version = input.appVersion;
  }
  if (input.deviceKey !== void 0) out.device_key = input.deviceKey;
  return out;
}
var PushDevicesApi = class {
  constructor(options = {}) {
    this.options = options;
  }
  post(path, body) {
    return postPublic(path, body, this.options.baseUrl, this.options.allowInsecureHttp);
  }
  /** Register or refresh a device. Resolves `{ device_id, created }`. */
  async register(input) {
    const res = await this.post("/push/register", buildRegisterDevicePayload(input));
    return res?.data ?? res;
  }
  /** Forget a token (sign-out, uninstall). Never fails for an unknown token. */
  async unregister(publishableKey, deviceToken) {
    const res = await this.post("/push/unregister", { publishable_key: pk(publishableKey), token: checkToken(deviceToken) });
    return res?.data ?? res;
  }
  /**
   * Subscribe this registered device to push topics (1–20 names of
   * `A-Z a-z 0-9 _ . ~ -`). Fails with 404 when the token was not
   * registered first. Resolves `{ topics }`.
   */
  async subscribeTopics(publishableKey, deviceToken, topics) {
    const res = await this.post("/push/topics/subscribe", { publishable_key: pk(publishableKey), token: checkToken(deviceToken), topics: pushTopics(topics) });
    return res?.data ?? res;
  }
  /** Unsubscribe this registered device from push topics. */
  async unsubscribeTopics(publishableKey, deviceToken, topics) {
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
  async opened(publishableKey, messageId, deviceToken) {
    const body = { publishable_key: pk(publishableKey), message_id: uuid(messageId, "messageId") };
    if (deviceToken !== void 0 && deviceToken !== null && String(deviceToken).trim() !== "") body.token = checkToken(deviceToken);
    const res = await this.post("/push/opened", body);
    return res?.data ?? res;
  }
};
function pushTopics(v, max = 20) {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) throw new Error(`'topics' must list 1\u2013${max} topic names`);
  return v.map((t) => pushTopic(t));
}
function pushTopic(t) {
  if (typeof t !== "string" || !PUSH_TOPIC_NAME.test(t.trim())) throw new Error("A push topic is 1\u201364 characters of letters, digits, _ . ~ -");
  return t.trim();
}

// src/push.ts
var ready = null;
async function lib() {
  if (!ready) ready = import_libsodium_wrappers_sumo.default.ready;
  await ready;
  return import_libsodium_wrappers_sumo.default;
}
var toB64 = (u) => import_libsodium_wrappers_sumo.default.to_base64(u, import_libsodium_wrappers_sumo.default.base64_variants.ORIGINAL);
var fromB64 = (s) => import_libsodium_wrappers_sumo.default.from_base64(s, import_libsodium_wrappers_sumo.default.base64_variants.ORIGINAL);
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PushDevicesApi,
  buildRegisterDevicePayload,
  generateDeviceKeys,
  isSealedPush,
  openPushPayload,
  pushTopics
});
