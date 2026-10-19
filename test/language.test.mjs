// send() `language`. Run after `npm run build`: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import sodium from "libsodium-wrappers-sumo";
import { catzconnect, buildSendPayload, normaliseLanguage, isValidLanguage, SUPPORTED_LANGUAGES } from "../dist/index.mjs";

await sodium.ready;
const b64 = (u) => Buffer.from(u).toString("base64");
const client = sodium.crypto_box_keypair();
const server = sodium.crypto_box_keypair();
const env = { api_key: "live_test", private_key: b64(client.privateKey), server_public_key: b64(server.publicKey) };

function key() {
  const shared = sodium.crypto_scalarmult(server.privateKey, client.publicKey);
  const master = sodium.crypto_generichash(32, shared, null);
  return sodium.crypto_generichash(32, new Uint8Array([...master, ...sodium.from_string("CONNECT-@-2026-HS-@-CATZ")]), null);
}
function serverOpen(body) {
  const plain = sodium.crypto_aead_chacha20poly1305_ietf_decrypt(
    null, Buffer.from(body.ciphertext, "base64"), null, Buffer.from(body.nonce, "base64"), key());
  return JSON.parse(sodium.to_string(plain));
}
let bodies = [];
globalThis.fetch = async (url, init) => {
  bodies.push(serverOpen(JSON.parse(init.body)));
  const text = JSON.stringify({ success: true, message: "ok", data: { message_id: "m1" } });
  return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
};
process.env.CATZCONNECT_BASE_URL = "https://api.test/";

const EMAIL_OTP = { type: "Verification", channel: "Email", template: "Otp", identity: "a@b.co", payload: { to: "u@x.co", otp: "123456" } };

test("normaliseLanguage keeps supported codes and reduces BCP-47 tags to the primary subtag", () => {
  assert.deepEqual([...SUPPORTED_LANGUAGES], ["en", "de", "ja", "ar", "hi"]);
  for (const [input, want] of [["en", "en"], ["DE", "de"], ["de-DE", "de"], ["ja_JP", "ja"], [" ar-EG ", "ar"], ["hi-Latn-IN", "hi"], ["en-US", "en"]]) {
    assert.equal(normaliseLanguage(input), want, input);
  }
});

test("normaliseLanguage rejects unknown languages with a clear message", () => {
  for (const bad of ["fr", "fr-FR", "", "de--DE", "english", "d e", 7]) {
    assert.throws(() => normaliseLanguage(bad), /'language'.*en, de, ja, ar, hi/, String(bad));
    assert.equal(isValidLanguage(bad), false);
  }
});

test("buildSendPayload omits language when unset and adds the normalised value at the top level", () => {
  assert.equal("language" in buildSendPayload(EMAIL_OTP), false);
  assert.equal(buildSendPayload({ ...EMAIL_OTP, language: "de-DE" }).language, "de");
  const sms = buildSendPayload({ type: "Verification", channel: "SMS", template: "Otp", identity: "", language: "hi", payload: { to: "+14155550100", otp: "1234" } });
  assert.equal(sms.language, "hi");
  const voice = buildSendPayload({ type: "Verification", channel: "voice", template: "Otp", identity: "", language: "ja-JP",
    payload: { to: "+14155550100", otp: "1234", data: { language: "en-US" } } });
  assert.equal(voice.language, "ja");
  assert.equal(voice.data.language, "en-US"); // still sent: overrides the TTS language
  assert.throws(() => buildSendPayload({ ...EMAIL_OTP, language: "fr" }), /Unsupported 'language'/);
});

test("send posts language, uses the default language, and fails before any request on a bad one", async () => {
  bodies = [];
  await catzconnect.send(EMAIL_OTP, env);
  assert.equal("language" in bodies[0], false);

  await catzconnect.send({ ...EMAIL_OTP, language: "AR" }, env);
  assert.equal(bodies[1].language, "ar");

  catzconnect.setDefaultLanguage("de-AT");
  assert.equal(catzconnect.getDefaultLanguage(), "de");
  await catzconnect.send(EMAIL_OTP, env);
  assert.equal(bodies[2].language, "de");
  await catzconnect.send({ ...EMAIL_OTP, language: "ja" }, env);
  assert.equal(bodies[3].language, "ja");
  catzconnect.setDefaultLanguage(undefined);
  await catzconnect.send(EMAIL_OTP, env);
  assert.equal("language" in bodies[4], false);

  assert.throws(() => catzconnect.setDefaultLanguage("xx"), /Unsupported 'language'/);
  await assert.rejects(catzconnect.send({ ...EMAIL_OTP, language: "fr-FR" }, env), /Unsupported 'language' "fr-FR"/);
  assert.equal(bodies.length, 5);
});
