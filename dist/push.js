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
  generateDeviceKeys: () => generateDeviceKeys,
  isSealedPush: () => isSealedPush,
  openPushPayload: () => openPushPayload
});
module.exports = __toCommonJS(push_exports);
var import_libsodium_wrappers_sumo = __toESM(require("libsodium-wrappers-sumo"));
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
  generateDeviceKeys,
  isSealedPush,
  openPushPayload
});
