// Base URL policy (https only, http to local hosts or with the opt-in). Run after `npm run build`.
import { test } from "node:test";
import assert from "node:assert/strict";
import sodium from "libsodium-wrappers-sumo";
import { checkBaseUrl, catzconnect } from "../dist/index.mjs";
import { CatzCallClient } from "../dist/call.mjs";

test("https is accepted and trailing slashes dropped", () => {
  assert.equal(checkBaseUrl("https://api.example.com/ "), "https://api.example.com");
});

test("http to a remote host is refused unless allowed", () => {
  assert.throws(() => checkBaseUrl("http://api.example.com"), /plain http:\/\/ to api\.example\.com/);
  assert.throws(() => checkBaseUrl("http://localhost.example.com"), /plain http/);
  assert.equal(checkBaseUrl("http://api.example.com", true), "http://api.example.com");
});

test("http to localhost-like hosts is accepted", () => {
  for (const u of ["http://localhost:8080", "http://127.0.0.1:8080", "http://[::1]:8080", "http://10.0.2.2:8080"]) {
    assert.equal(checkBaseUrl(u), u);
  }
});

test("garbage and other schemes are refused", () => {
  assert.throws(() => checkBaseUrl("api.example.com"), /not a valid URL/);
  assert.throws(() => checkBaseUrl("ftp://api.example.com"), /must start with https/);
});

test("API calls refuse an http CATZCONNECT_BASE_URL before sending anything, opt-in allows it", async () => {
  await sodium.ready;
  const b64 = (u) => Buffer.from(u).toString("base64");
  const env = {
    api_key: "live_k",
    private_key: b64(sodium.crypto_box_keypair().privateKey),
    server_public_key: b64(sodium.crypto_box_keypair().publicKey),
  };
  const saved = { base: process.env.CATZCONNECT_BASE_URL, allow: process.env.CATZCONNECT_ALLOW_INSECURE_HTTP };
  const realFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return { ok: false, status: 503, text: async () => "down", json: async () => ({}) };
  };
  try {
    process.env.CATZCONNECT_BASE_URL = "http://api.example.com";
    delete process.env.CATZCONNECT_ALLOW_INSECURE_HTTP;
    await assert.rejects(catzconnect.calls.end("call_1", undefined, env), /plain http/);
    assert.deepEqual(urls, []);
    process.env.CATZCONNECT_ALLOW_INSECURE_HTTP = "1";
    await assert.rejects(catzconnect.calls.end("call_1", undefined, env), (e) => e.status === 503);
    assert.equal(urls.length, 1);
    delete process.env.CATZCONNECT_ALLOW_INSECURE_HTTP;
    catzconnect.setAllowInsecureHttp(true);
    await assert.rejects(catzconnect.calls.end("call_1", undefined, env), (e) => e.status === 503);
    assert.equal(urls.length, 2);
  } finally {
    catzconnect.setAllowInsecureHttp(false);
    globalThis.fetch = realFetch;
    if (saved.base === undefined) delete process.env.CATZCONNECT_BASE_URL;
    else process.env.CATZCONNECT_BASE_URL = saved.base;
    if (saved.allow === undefined) delete process.env.CATZCONNECT_ALLOW_INSECURE_HTTP;
    else process.env.CATZCONNECT_ALLOW_INSECURE_HTTP = saved.allow;
  }
});

test("call client: ws:// signaling URL only to local hosts or with allowInsecureHttp", () => {
  assert.throws(() => new CatzCallClient({ url: "ws://rtc.example.com/rtc/v1/ws" }), /plain ws:\/\//);
  new CatzCallClient({ url: "ws://127.0.0.1:8080/rtc/v1/ws" });
  new CatzCallClient({ url: "ws://rtc.example.com/rtc/v1/ws", allowInsecureHttp: true });
  new CatzCallClient({ url: "wss://rtc.example.com/rtc/v1/ws" });
});

test("a blank CATZCONNECT_BASE_URL means the default API (K8)", async () => {
  await sodium.ready;
  const b64 = (u) => Buffer.from(u).toString("base64");
  const env = {
    api_key: "live_k",
    private_key: b64(sodium.crypto_box_keypair().privateKey),
    server_public_key: b64(sodium.crypto_box_keypair().publicKey),
  };
  const saved = process.env.CATZCONNECT_BASE_URL;
  const realFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return { ok: false, status: 503, text: async () => "down", json: async () => ({}) };
  };
  try {
    for (const blank of ["", "   "]) {
      process.env.CATZCONNECT_BASE_URL = blank;
      await assert.rejects(catzconnect.calls.end("call_1", undefined, env), (e) => e.status === 503);
    }
    assert.equal(urls.length, 2);
    for (const u of urls) assert.ok(String(u).startsWith("https://api.catzconnect.com/"), String(u));
  } finally {
    globalThis.fetch = realFetch;
    if (saved === undefined) delete process.env.CATZCONNECT_BASE_URL;
    else process.env.CATZCONNECT_BASE_URL = saved;
  }
});
