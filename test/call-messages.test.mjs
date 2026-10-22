// In-call chat and data messages: data channels first, signaling relay as
// fallback, caps, rate limit, de-duplication. Run after `npm run build`.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  CatzCallClient,
  CallMessageError,
  Dedup,
  RateBucket,
  checkChat,
  checkData,
  chooseRoute,
  decodeEnvelope,
  messageLimitsFrom,
  DEFAULT_MESSAGE_LIMITS,
} from "../dist/call.mjs";
import { CALL_ICE, Clock, FakePC, FakeWS, HELLO, flush, makePlatform } from "./fakes.mjs";

beforeEach(() => {
  FakePC.all = [];
  FakeWS.all = [];
});

const LIMITS = { chat_max_chars: 10, data_max_bytes: 40, messages_per_sec: 1, messages_burst: 3, messages_relay: true };

async function inCall({ limits = LIMITS, opts = {} } = {}) {
  const clock = new Clock();
  const platform = makePlatform(clock);
  const client = new CatzCallClient({ token: "ct1.x.y", url: "wss://api.test/rtc/v1/ws", ...opts, platform });
  const events = [];
  for (const e of ["chat", "data", "error"]) client.on(e, (p) => events.push([e, p]));
  const cp = client.connect();
  await flush();
  const ws = FakeWS.all.at(-1);
  ws.receive({ ...HELLO, limits: { ...HELLO.limits, ...limits } });
  await cp;
  const jp = client.join("c1", { audio: true, video: false });
  await flush();
  ws.receive({ t: "joined", pid: "p1", call: { id: "c1", mode: "audio", engine: "catz" },
    peers: [{ pid: "p2", user_id: "bob" }, { pid: "p3", user_id: "carol" }], resume: false, ice_servers: CALL_ICE });
  await jp;
  await flush();
  const [pc2, pc3] = FakePC.all;
  return { clock, client, ws, events, pc2, pc3 };
}

const chan = (pc, label = "catz-msg") => pc.channels.find((c) => c.label === label);

test("pure helpers: limits, caps, bucket, dedup, routes, envelope", () => {
  const l = messageLimitsFrom(LIMITS);
  assert.deepEqual(l, { chatMaxChars: 10, dataMaxBytes: 40, perSec: 1, burst: 3, relay: true });
  assert.deepEqual(messageLimitsFrom(undefined), { ...DEFAULT_MESSAGE_LIMITS });
  assert.equal(messageLimitsFrom({ messages_per_sec: 9, messages_burst: 2 }).burst, 9, "burst ≥ rate");

  assert.equal(checkChat("hello", l), null);
  assert.equal(checkChat("ääääääääää", l), null, "characters, not bytes");
  assert.equal(checkChat("01234567890", l).code, "message_too_large");
  assert.equal(checkChat("  ", l).code, "bad_request");
  assert.equal(checkChat("a\u0000b", l).code, "bad_request");
  assert.equal(checkChat("a\nb", l), null);
  assert.equal(checkData({ a: 1 }, l).error, null);
  assert.equal(checkData(null, l).error.code, "bad_request");
  assert.equal(checkData({ s: "é".repeat(17) }, l).error.code, "message_too_large", "UTF-8 bytes");
  assert.equal(checkData({ s: "e".repeat(32) }, l).error, null); // {"s":"…"} = 8 + 32 = 40 bytes

  const b = new RateBucket({ perSec: 1, burst: 3 });
  assert.deepEqual([b.take(0), b.take(0), b.take(0), b.take(0)], [true, true, true, false]);
  assert.equal(b.take(1000), true);
  assert.equal(b.take(1000), false);

  const d = new Dedup(2);
  assert.equal(d.seen("a"), false);
  assert.equal(d.seen("a"), true);
  d.seen("b");
  d.seen("c"); // evicts a
  assert.equal(d.seen("a"), false);

  const route = (opens, o = {}) => chooseRoute(opens.map((open) => ({ open })), { forceServer: false, serverRelay: true, ...o });
  assert.equal(route([true, true]), "p2p");
  assert.equal(route([true, false]), "relay");
  assert.equal(route([]), "relay");
  assert.equal(route([true], { forceServer: true }), "relay");
  assert.equal(route([true, false], { serverRelay: false }), "p2p");
  assert.equal(route([false], { serverRelay: false }), "none");

  assert.equal(decodeEnvelope("not json", l), null);
  assert.equal(decodeEnvelope(JSON.stringify({ v: 1, k: "chat", id: "bad id", ts: 1, text: "x" }), l), null);
  assert.equal(decodeEnvelope(JSON.stringify({ v: 1, k: "chat", id: "m", ts: 1, text: "01234567890" }), l), null);
  assert.equal(decodeEnvelope(JSON.stringify({ v: 2, k: "chat", id: "m", ts: 1, text: "x" }), l), null);
  assert.deepEqual(decodeEnvelope(JSON.stringify({ v: 1, k: "data", id: "m", ts: 5, to: "p1", payload: [1] }), l),
    { v: 1, k: "data", id: "m", ts: 5, to: "p1", payload: [1], reliable: true });
});

test("the initiator opens a reliable and an unreliable data channel before its offer", async () => {
  const { pc2 } = await inCall();
  const rel = chan(pc2);
  const unrel = chan(pc2, "catz-msg-u");
  assert.deepEqual(rel.init, { ordered: true });
  assert.deepEqual(unrel.init, { ordered: false, maxRetransmits: 0 });
});

test("sendChat: data channels when all are open, relay otherwise; no echo", async () => {
  const { client, ws, events, pc2, pc3, clock } = await inCall();
  // No channel open yet: through the server.
  const r1 = client.sendChat("hi all");
  assert.equal(r1.via, "relay");
  assert.equal(r1.to, null);
  const [f1] = ws.sentOf("chat");
  assert.deepEqual(f1, { t: "chat", call_id: "c1", id: r1.id, text: "hi all" });

  // Only bob's channel open: a broadcast still goes through the server.
  chan(pc2).open();
  assert.equal(client.sendChat("two").via, "relay");
  // Private to bob: his channel.
  const r3 = client.sendChat("psst", { to: "p2" });
  assert.equal(r3.via, "p2p");
  assert.deepEqual(JSON.parse(chan(pc2).sent.at(-1)), { v: 1, k: "chat", id: r3.id, ts: r3.ts, to: "p2", text: "psst" });
  assert.equal(chan(pc3).sent.length, 0);
  assert.equal(ws.sentOf("chat").length, 2);

  // All open, but carol's channel fails to send: the server delivers too
  // (bob drops the repeat by id).
  chan(pc3).open();
  chan(pc3).failSend = true;
  await clock.tick(3_000); // refill the send bucket
  const r4 = client.sendChat("four");
  assert.equal(r4.via, "relay");
  assert.equal(JSON.parse(chan(pc2).sent.at(-1)).id, r4.id);
  assert.equal(ws.sentOf("chat").at(-1).id, r4.id);
  assert.equal(events.filter(([e]) => e === "chat").length, 0, "own messages are not echoed");
});

test("sendData: unreliable channel when open, reliable flag honoured; server fallback not queued", async () => {
  const { client, ws, pc2, pc3, clock } = await inCall({ limits: { ...LIMITS, messages_burst: 20, messages_per_sec: 20 } });
  for (const pc of [pc2, pc3]) {
    chan(pc).open();
    chan(pc, "catz-msg-u").open();
  }
  const r = client.sendData({ x: 1 }, { reliable: false });
  assert.equal(r.via, "p2p");
  assert.equal(chan(pc2, "catz-msg-u").sent.length, 1);
  assert.equal(chan(pc2).sent.length, 0);
  assert.equal(JSON.parse(chan(pc3, "catz-msg-u").sent[0]).reliable, false);
  client.sendData([1, 2]);
  assert.equal(chan(pc2).sent.length, 1);

  // Bob's reliable channel fails: the whole broadcast also goes through the server.
  chan(pc2).failSend = true;
  const r2 = client.sendData({ y: 2 });
  assert.equal(r2.via, "relay");
  assert.deepEqual(ws.sentOf("data").at(-1), { t: "data", call_id: "c1", id: r2.id, payload: { y: 2 } });

  // Signaling down: unreliable data through the server is dropped, reliable data is queued.
  ws.drop();
  client.sendData({ lossy: 1 }, { reliable: false });
  const queued = client.sendData({ kept: 1 });
  assert.equal(queued.via, "relay");
  await clock.tick(2_000);
  const ws2 = FakeWS.all.at(-1);
  assert.notEqual(ws2, ws);
  ws2.receive({ ...HELLO, limits: { ...HELLO.limits, ...LIMITS, messages_burst: 20, messages_per_sec: 20 } });
  await flush();
  const sent = ws2.sentOf("data");
  assert.deepEqual(sent.map((m) => m.payload), [{ kept: 1 }]);
});

test("caps and client-side rate limit throw CallMessageError", async () => {
  const { client } = await inCall();
  assert.throws(() => client.sendChat("01234567890"), (e) => e instanceof CallMessageError && e.code === "message_too_large");
  assert.throws(() => client.sendChat(""), (e) => e.code === "bad_request");
  assert.throws(() => client.sendData({ s: "x".repeat(50) }), (e) => e.code === "message_too_large");
  assert.throws(() => client.sendChat("x", { to: "p1" }), (e) => e.code === "bad_request", "not to yourself");
  client.sendChat("1");
  client.sendChat("2");
  client.sendChat("3");
  assert.throws(() => client.sendChat("4"), (e) => e.code === "rate_limited");
});

test("receiving: relay and data channel, de-duplicated by (sender, id), private flag, room check", async () => {
  const { ws, events, pc2, pc3 } = await inCall();
  ws.receive({ t: "chat", call_id: "c1", id: "m1", from: "p2", user_id: "bob", to: null, text: "hello", ts: 123 });
  // The same message over bob's channel: dropped.
  chan(pc2).open();
  chan(pc2).receive(JSON.stringify({ v: 1, k: "chat", id: "m1", ts: 99, to: null, text: "hello" }));
  // Carol's data, private to us, over her channel.
  chan(pc3).open();
  chan(pc3).receive(JSON.stringify({ v: 1, k: "data", id: "d1", ts: 5, to: "p1", payload: { move: [3, 4] } }));
  // For someone else: dropped. Over the cap: dropped. Another call: dropped.
  chan(pc3).receive(JSON.stringify({ v: 1, k: "data", id: "d2", ts: 5, to: "p9", payload: 1 }));
  chan(pc3).receive(JSON.stringify({ v: 1, k: "chat", id: "d3", ts: 5, to: null, text: "01234567890" }));
  ws.receive({ t: "data", call_id: "other", id: "x", from: "p2", user_id: "bob", to: null, payload: 1, ts: 1 });
  // Same id from a different sender is a different message.
  ws.receive({ t: "chat", call_id: "c1", id: "m1", from: "p3", user_id: "carol", to: "p1", text: "yo", ts: 124 });

  const got = events.filter(([e]) => e !== "error").map(([e, p]) => [e, p]);
  assert.equal(got.length, 3);
  assert.deepEqual(got[0], ["chat", { callId: "c1", id: "m1", from: "p2", userId: "bob", to: null, private: false, ts: 123, via: "relay", text: "hello" }]);
  assert.deepEqual(got[1], ["data", { callId: "c1", id: "d1", from: "p3", userId: "carol", to: "p1", private: true, ts: 5, via: "p2p", payload: { move: [3, 4] } }]);
  assert.equal(got[2][1].private, true);
  assert.equal(got[2][1].userId, "carol");
});

test("a flooding peer is rate limited on the data channel", async () => {
  const { events, pc2 } = await inCall();
  chan(pc2).open();
  for (let i = 0; i < 10; i++) chan(pc2).receive(JSON.stringify({ v: 1, k: "chat", id: `f${i}`, ts: 1, to: null, text: "spam" }));
  assert.equal(events.filter(([e]) => e === "chat").length, 3, "burst of 3");
});

test("a server refusal arrives as an error with messageId and does not disturb the call", async () => {
  const { client, ws, events } = await inCall();
  const r = client.sendChat("hi");
  ws.receive({ t: "error", code: "rate_limited", message: "Too many messages — slow down", call_id: "c1", id: r.id });
  const errs = events.filter(([e]) => e === "error").map(([, p]) => p);
  assert.deepEqual(errs, [{ code: "rate_limited", message: "Too many messages — slow down", callId: "c1", messageId: r.id }]);
  assert.equal(client.callId, "c1");
  assert.equal(ws.sentOf("join").length, 1, "no rejoin");
});

test("messageTransport server and relay disabled", async () => {
  const a = await inCall({ opts: { messageTransport: "server" } });
  chan(a.pc2).open();
  chan(a.pc3).open();
  assert.equal(a.client.sendChat("x").via, "relay");
  assert.equal(chan(a.pc2).sent.length, 0);

  FakePC.all = [];
  const b = await inCall({ limits: { ...LIMITS, messages_relay: false } });
  assert.throws(() => b.client.sendChat("x"), (e) => e.code === "no_route");
  chan(b.pc2).open();
  // Bob's channel only: delivered to him, carol misses it (no relay).
  assert.equal(b.client.sendChat("y").via, "p2p");
  assert.equal(chan(b.pc2).sent.length, 1);
  assert.equal(b.ws.sentOf("chat").length, 0);
});

test("leaving the call clears de-duplication and closes channels", async () => {
  const { client, ws, events, pc2 } = await inCall();
  ws.receive({ t: "chat", call_id: "c1", id: "m1", from: "p2", user_id: "bob", to: null, text: "a", ts: 1 });
  client.leave();
  assert.equal(chan(pc2).closed, true);
  assert.throws(() => client.sendChat("x"), (e) => e.code === "not_in_call");
  assert.equal(events.filter(([e]) => e === "chat").length, 1);
});

test("a server that announces no messages_relay is treated as relay off", async () => {
  const { messages_relay, ...noRelayKey } = LIMITS;
  assert.equal(messageLimitsFrom(noRelayKey).relay, false);
  assert.equal(messageLimitsFrom({}).relay, false);
  assert.equal(DEFAULT_MESSAGE_LIMITS.relay, false);
  // An older server: hello.limits has none of the message keys.
  const { client, ws, pc2 } = await inCall({ limits: {} });
  assert.throws(() => client.sendChat("x"), (e) => e.code === "no_route");
  assert.equal(ws.sentOf("chat").length, 0, "nothing sent to a server that would refuse it");
  chan(pc2).open();
  assert.equal(client.sendChat("y").via, "p2p");
});

test("an 'Unknown message type' refusal never fails a pending join", async () => {
  const clock = new Clock();
  const platform = makePlatform(clock);
  const client = new CatzCallClient({ token: "ct1.x.y", url: "wss://api.test/rtc/v1/ws", platform });
  const errors = [];
  client.on("error", (p) => errors.push(p));
  const cp = client.connect();
  await flush();
  const ws = FakeWS.all.at(-1);
  ws.receive({ ...HELLO, limits: { ...HELLO.limits, ...LIMITS } });
  await cp;
  const jp = client.join("c1", { audio: true, video: false });
  await flush();
  ws.receive({ t: "error", code: "bad_request", message: 'Unknown message type "chat"', call_id: "c1" });
  ws.receive({ t: "joined", pid: "p1", call: { id: "c1", mode: "audio", engine: "catz" }, peers: [], resume: false, ice_servers: CALL_ICE });
  const joined = await jp;
  assert.equal(joined.call.id, "c1");
  assert.equal(client.callId, "c1");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "bad_request");
  // Relay is now off: with no open channel a chat has no route.
  assert.throws(() => client.sendChat("x"), (e) => e.code === "no_route");
});

test("a peer that leaves loses its receive bucket", async () => {
  const { client, ws, events, pc2 } = await inCall();
  chan(pc2).open();
  for (let i = 0; i < 5; i++) chan(pc2).receive(JSON.stringify({ v: 1, k: "chat", id: `a${i}`, ts: 1, to: null, text: "x" }));
  assert.equal(events.filter(([e]) => e === "chat").length, 3);
  assert.equal(client.recvBuckets.has("p2"), true);
  ws.receive({ t: "peer_left", call_id: "c1", pid: "p2", user_id: "bob", reason: "left" });
  // Internal state (TS-private): no entry kept for a participant that is gone.
  assert.equal(client.recvBuckets.has("p2"), false);
});
