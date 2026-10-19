// Server SDK: calls.* and send() channel "Voice". Run after `npm run build`: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import sodium from "libsodium-wrappers-sumo";
import {
  catzconnect,
  buildSendPayload,
  buildCreateCallPayload,
  buildCallTokenPayload,
  CatzApiError,
  verifyVoice,
} from "../dist/index.mjs";

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
function serverSeal(obj) {
  const nonce = sodium.randombytes_buf(12);
  const ct = sodium.crypto_aead_chacha20poly1305_ietf_encrypt(sodium.from_string(JSON.stringify(obj)), null, null, nonce, key());
  return { nonce: b64(nonce), ciphertext: b64(ct) };
}

let calls = [];
function mockFetch(status, json) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: serverOpen(JSON.parse(init.body)) });
    const text = typeof json === "string" ? json : JSON.stringify(json);
    return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
  };
}
process.env.CATZCONNECT_BASE_URL = "https://api.test/";

const CALL = { id: "c1", engine: "catz", mode: "video", status: "ringing", room: "c1",
  participants: [{ user_id: "alice", role: "caller", state: "joined" }, { user_id: "bob", role: "callee", state: "ringing" }],
  created_at: "2026-10-18T00:00:00Z" };

test("calls.create posts the encrypted body with the send() headers", async () => {
  mockFetch(200, { success: true, call: CALL });
  const call = await catzconnect.calls.create(
    { mode: "video", from: "alice", to: ["bob"], engine: "catz", ring: true, metadata: { order: 7 }, maxParticipants: 4 }, env);
  assert.equal(call.id, "c1");
  assert.equal(calls[0].url, "https://api.test/sdk/calls/create");
  assert.equal(calls[0].init.headers.Authorization, "Bearer live_test");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  const b = calls[0].body;
  assert.deepEqual({ ...b, ts: undefined }, { mode: "video", from: "alice", to: ["bob"], engine: "catz", ring: true,
    metadata: { order: 7 }, max_participants: 4, ts: undefined });
  assert.equal(typeof b.ts, "number");
});

test("results are read from the top level, from data, and from an encrypted data envelope", async () => {
  mockFetch(200, { success: true, message: "ok", data: { call: CALL } });
  assert.equal((await catzconnect.calls.get("c1", env)).status, "ringing");
  assert.deepEqual({ ...calls[0].body, ts: 0 }, { call_id: "c1", ts: 0 });

  mockFetch(200, { success: true, message: "ok", data: serverSeal({ token: "ct1.a.b", expires_at: 99, ws_url: "wss://x/rtc/v1/ws" }) });
  const t = await catzconnect.calls.token("alice", 600, env);
  assert.deepEqual(t, { token: "ct1.a.b", expires_at: 99, ws_url: "wss://x/rtc/v1/ws" });
  assert.equal(calls[0].url, "https://api.test/sdk/calls/token");
  assert.equal(calls[0].body.user_id, "alice");
  assert.equal(calls[0].body.ttl_seconds, 600);

  mockFetch(200, { success: true, message: "Call ended" });
  assert.deepEqual(await catzconnect.calls.end("c1", "done", env), { success: true, message: "Call ended" });
  assert.equal(calls[0].body.reason, "done");
});

test("API refusals carry status, message and code", async () => {
  mockFetch(402, { success: false, message: "Your plan has used its call minutes.", code: "minutes_cap_reached" });
  await assert.rejects(catzconnect.calls.create({ mode: "audio", from: "a", to: ["b"] }, env), (e) => {
    assert.ok(e instanceof CatzApiError);
    assert.equal(e.status, 402);
    assert.equal(e.code, "minutes_cap_reached");
    assert.equal(e.message, "Your plan has used its call minutes.");
    return true;
  });
  mockFetch(200, { success: false, message: "Calls are not enabled for this key", code: "plan_required" });
  await assert.rejects(catzconnect.calls.token("a", undefined, env), /not enabled/);
});

test("create validation mirrors the server", () => {
  const ok = { mode: "audio", from: "a", to: ["b"] };
  const bad = [
    [{ ...ok, mode: "screen" }, /mode/],
    [{ ...ok, from: "" }, /from/],
    [{ ...ok, from: "x".repeat(129) }, /128/],
    [{ ...ok, from: "a\u0001" }, /control/],
    [{ ...ok, to: [] }, /at least one/],
    [{ ...ok, to: Array.from({ length: 50 }, (_, i) => `u${i}`) }, /at most 49/],
    [{ ...ok, to: ["b", "b"] }, /twice/],
    [{ ...ok, to: ["a"] }, /caller/],
    [{ ...ok, metadata: { blob: "x".repeat(4100) } }, /4 KB/],
    [{ ...ok, metadata: [1] }, /object/],
    [{ ...ok, to: ["b", "c", "d"], maxParticipants: 3 }, /do not fit/],
    [{ ...ok, maxParticipants: 51 }, /2 to 50/],
  ];
  for (const [input, re] of bad) assert.throws(() => buildCreateCallPayload(input), re, JSON.stringify(input).slice(0, 60));
  assert.deepEqual(buildCreateCallPayload({ ...ok, to: Array.from({ length: 49 }, (_, i) => `u${i}`) }).to.length, 49);
  assert.throws(() => buildCallTokenPayload("a", 59), /60 to 86400/);
  assert.throws(() => buildCallTokenPayload("a", 86401), /60 to 86400/);
  assert.deepEqual(buildCallTokenPayload("a"), { user_id: "a" });
});

test("send() channel Voice: validation and payload", async () => {
  const otp = { channel: "voice", type: "Verification", template: "otp", identity: "",
    payload: { to: "+1 (415) 555-0100", otp: "123456", data: { language: "en-US", voice: "female", repeat: "2" } } };
  assert.deepEqual(buildSendPayload(otp), { message_type: "Verification", channel: "Voice", template: "Otp", identity: "",
    to: "+14155550100", otp: "123456", data: { language: "en-US", voice: "female", repeat: "2" } });

  const custom = { channel: "Voice", type: "Notification", template: "Custom", identity: "",
    payload: { to: "+919876543210", body: "Your order has shipped.", provider: "Twilio main" } };
  verifyVoice(custom);
  assert.equal(buildSendPayload(custom).provider, "Twilio main");

  const bad = [
    [{ ...custom, payload: { ...custom.payload, to: "4155550100" } }, /E\.164/],
    [{ ...custom, payload: { ...custom.payload, body: "x".repeat(1001) } }, /1000/],
    [{ ...custom, payload: { ...custom.payload, body: " " } }, /body/],
    [{ ...custom, payload: { ...custom.payload, data: { repeat: "4" } } }, /repeat/],
    [{ ...custom, payload: { ...custom.payload, data: { repeat: "0" } } }, /repeat/],
    [{ ...custom, payload: { ...custom.payload, data: { language: "english" } } }, /language/],
    [{ ...otp, payload: { to: "+14155550100" } }, /otp/],
  ];
  for (const [input, re] of bad) assert.throws(() => verifyVoice({ ...input, channel: "Voice" }), re);
  assert.doesNotThrow(() => verifyVoice({ ...custom, payload: { ...custom.payload, body: "é".repeat(1000) } }));

  mockFetch(200, { success: true, message: "Queued", data: { message_id: "v1" } });
  const res = await catzconnect.send(otp, env);
  assert.equal(res.data.message_id, "v1");
  assert.equal(calls[0].url, "https://api.test/sdk/send");
  assert.equal(calls[0].body.channel, "Voice");
});

test("other channels are unchanged", () => {
  const sms = { channel: "SMS", type: "Verification", template: "Otp", identity: "", payload: { to: "+14155550100", otp: "1234" } };
  assert.deepEqual(buildSendPayload(sms), { message_type: "Verification", channel: "SMS", template: "Otp", identity: "", to: "+14155550100", otp: "1234" });
  const email = { channel: "Email", type: "Verification", template: "Otp", identity: "me@x.com", payload: { to: "a@b.com", otp: "123456" } };
  assert.deepEqual(buildSendPayload(email), { message_type: "Verification", channel: "Email", template: "Otp", identity: "me@x.com", to: "a@b.com", otp: "123456" });
});

test("call.provider is the server's {id, label, name} object", async () => {
  const withProvider = { ...CALL, engine: "livekit", provider: { id: "6f1c", label: "LK main", name: "livekit" } };
  mockFetch(200, { success: true, call: withProvider });
  const call = await catzconnect.calls.get("c2", env);
  assert.deepEqual(call.provider, { id: "6f1c", label: "LK main", name: "livekit" });
});
