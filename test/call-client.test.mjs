// Browser call client against fake WebSocket / RTCPeerConnection. Run after `npm run build`.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CatzCallClient, readStats, tokenExpiry, backoffDelay } from "../dist/call.mjs";
import { CALL_ICE, Clock, FakePC, FakeWS, FakeMediaStream, FakeTrack, HELLO, flush, makePlatform } from "./fakes.mjs";

beforeEach(() => {
  FakePC.all = [];
  FakeWS.all = [];
});

function record(client) {
  const events = [];
  for (const e of ["incoming", "state", "peer-joined", "peer-left", "track", "local-stream", "connection", "quality",
    "reconnecting", "reconnected", "provider", "error", "closed"]) {
    client.on(e, (p) => events.push([e, p]));
  }
  return events;
}

async function connected(opts = {}) {
  const clock = new Clock();
  const platform = makePlatform(clock, opts.platform);
  const client = new CatzCallClient({ token: "ct1.x.y", url: "wss://api.test/rtc/v1/ws", ...opts, platform });
  const events = record(client);
  const p = client.connect();
  await flush();
  const ws = FakeWS.all.at(-1);
  ws.receive(HELLO);
  await p;
  return { clock, platform, client, events, ws };
}

async function joinedAsCaller(o = {}) {
  const ctx = await connected(o);
  const jp = ctx.client.join("c1", { audio: true, video: true });
  await flush();
  ctx.ws.receive({ t: "joined", pid: "p1", call: { id: "c1", mode: "video", engine: "catz" },
    peers: [{ pid: "p2", user_id: "bob" }], polite_for: { p2: false }, resume: false, ice_servers: CALL_ICE, ice_ttl: 3600 });
  const res = await jp;
  await flush();
  return { ...ctx, res, pc: FakePC.all.at(-1) };
}

test("connect: token in the URL, ping answered with pong", async () => {
  const { ws, client } = await connected();
  assert.equal(ws.url, "wss://api.test/rtc/v1/ws?token=ct1.x.y");
  assert.equal(client.connected, true);
  ws.receive({ t: "ping", ts: 42 });
  assert.deepEqual(ws.sentOf("pong"), [{ t: "pong", ts: 42 }]);
});

test("join: newly joined peer offers, ICE servers from joined (TURN per call), policy all", async () => {
  const { ws, res, pc, events, platform } = await joinedAsCaller();
  assert.deepEqual(ws.sentOf("join"), [{ t: "join", call_id: "c1", media: { audio: true, video: true }, platform: "web" }]);
  assert.equal(res.pid, "p1");
  assert.deepEqual(res.peers, [{ pid: "p2", user_id: "bob" }]);
  assert.equal(pc.config.iceTransportPolicy, "all");
  assert.equal(pc.config.iceServers.length, 2);
  assert.equal(pc.config.iceServers[1].username, "u");
  assert.ok(events.some(([e]) => e === "local-stream"));
  assert.equal(platform.mediaDevices.gumCalls.length, 1);
  const offers = ws.sentOf("signal").filter((m) => m.data.sdp?.type === "offer");
  assert.equal(offers.length, 1);
  assert.equal(offers[0].to, "p2");
  assert.equal(offers[0].call_id, "c1");

  // answer + candidates both ways
  ws.receive({ t: "signal", call_id: "c1", from: "p2", data: { candidate: { candidate: "early" } } }); // before answer: buffered
  ws.receive({ t: "signal", call_id: "c1", from: "p2", data: { sdp: { type: "answer", sdp: "a" } } });
  await flush();
  assert.equal(pc.signalingState, "stable");
  assert.deepEqual(pc.candidates, [{ candidate: "early" }]);
  pc.emitCandidate({ candidate: "mine" });
  assert.deepEqual(ws.sentOf("signal").at(-1).data, { candidate: { candidate: "mine" } });

  const remote = pc.emitTrack("video");
  const tr = events.find(([e]) => e === "track")[1];
  assert.equal(tr.pid, "p2");
  assert.equal(tr.userId, "bob");
  assert.ok(tr.stream.getTracks().includes(remote));
});

test("existing peer answers (does not offer first) and glare is resolved by the polite side", async () => {
  const { ws, client } = await connected();
  const jp = client.join("c1", { audio: true, video: false });
  await flush();
  ws.receive({ t: "joined", pid: "p9", call: { id: "c1", mode: "audio", engine: "catz" }, peers: [] });
  await jp;
  ws.receive({ t: "peer_joined", call_id: "c1", pid: "p5", user_id: "carol" });
  await flush();
  const pc = FakePC.all.at(-1);
  assert.equal(ws.sentOf("signal").length, 0, "the existing peer waits for the newcomer's offer");

  ws.receive({ t: "signal", call_id: "c1", from: "p5", data: { sdp: { type: "offer", sdp: "o" } } });
  await flush();
  const answer = ws.sentOf("signal").find((m) => m.data.sdp?.type === "answer");
  assert.ok(answer, "answered");
  assert.ok(pc.getSenders().some((s) => s.track?.kind === "audio"), "tracks attached before answering");

  // Glare: we are polite toward p5 (p9 > p5). Make our own offer, then theirs arrives.
  pc.addTransceiver("video", { direction: "recvonly" });
  await flush();
  assert.equal(pc.signalingState, "have-local-offer");
  ws.receive({ t: "signal", call_id: "c1", from: "p5", data: { sdp: { type: "offer", sdp: "o2" } } });
  await flush();
  assert.ok(pc.log.includes("rollback"));
  assert.equal(pc.signalingState, "stable");
});

test("impolite side ignores a colliding offer", async () => {
  const { ws, pc } = await joinedAsCaller(); // polite_for p2 = false
  assert.equal(pc.signalingState, "have-local-offer");
  const before = ws.sentOf("signal").length;
  ws.receive({ t: "signal", call_id: "c1", from: "p2", data: { sdp: { type: "offer", sdp: "glare" } } });
  await flush();
  assert.ok(!pc.log.includes("rollback"));
  assert.equal(pc.signalingState, "have-local-offer");
  assert.equal(ws.sentOf("signal").length, before);
});

test("ICE: disconnected > 2 s restarts (offerer), reconnecting/reconnected, tracks kept", async () => {
  const { pc, clock, events, ws } = await joinedAsCaller();
  ws.receive({ t: "signal", call_id: "c1", from: "p2", data: { sdp: { type: "answer", sdp: "a" } } });
  await flush();
  pc.setIce("connected");
  const senders = pc.getSenders().map((s) => s.track);
  pc.setIce("disconnected");
  await clock.tick(1500);
  assert.equal(pc.restartIceCalls, 0, "a short blip is not restarted");
  await clock.tick(600);
  await flush();
  assert.equal(pc.restartIceCalls, 1);
  assert.ok(events.some(([e, p]) => e === "reconnecting" && p.scope === "peer" && p.pid === "p2"));
  const restartOffer = ws.sentOf("signal").at(-1);
  assert.match(restartOffer.data.sdp.sdp, /icerestart/);
  assert.deepEqual(pc.getSenders().map((s) => s.track), senders);

  // still failing after 10 s → another restart with backoff
  pc.signalingState = "stable";
  await clock.tick(10_000);
  await clock.tick(1_000);
  assert.equal(pc.restartIceCalls, 2);

  pc.setIce("connected");
  assert.ok(events.some(([e, p]) => e === "reconnected" && p.scope === "peer"));
});

test("ICE restart over a path that stays connected ends with reconnected once negotiated", async () => {
  const { pc, ws, events, client } = await joinedAsCaller();
  ws.receive({ t: "signal", call_id: "c1", from: "p2", data: { sdp: { type: "answer", sdp: "a" } } });
  await flush();
  pc.setIce("connected");
  client["links"].get("p2").restartNow(); // e.g. a network change
  await flush();
  assert.ok(events.some(([e, p]) => e === "reconnecting" && p.scope === "peer"));
  assert.equal(pc.signalingState, "have-local-offer");
  assert.ok(!events.some(([e, p]) => e === "reconnected" && p.scope === "peer"), "not before the answer");
  ws.receive({ t: "signal", call_id: "c1", from: "p2", data: { sdp: { type: "answer", sdp: "a2" } } });
  await flush();
  assert.ok(events.some(([e, p]) => e === "reconnected" && p.scope === "peer"), "ICE never left connected: done when stable");
});

test("ICE failed on the answering side asks the offerer to restart", async () => {
  const { ws, client, clock } = await connected();
  const jp = client.join("c1", { audio: true });
  await flush();
  ws.receive({ t: "joined", pid: "p1", call: { id: "c1", mode: "audio", engine: "catz" }, peers: [] });
  await jp;
  ws.receive({ t: "peer_joined", call_id: "c1", pid: "p2", user_id: "bob" });
  await flush();
  const pc = FakePC.all.at(-1);
  pc.setIce("failed");
  await clock.tick(1);
  assert.deepEqual(ws.sentOf("signal").at(-1), { t: "signal", call_id: "c1", to: "p2", data: { restart: true } });
});

test("restart request from the peer makes the offerer restart now", async () => {
  const { ws, pc } = await joinedAsCaller();
  ws.receive({ t: "signal", call_id: "c1", from: "p2", data: { restart: true } });
  await flush();
  assert.equal(pc.restartIceCalls, 1);
});

test("network change (online) restarts ICE on a connected link", async () => {
  const { pc, platform, ws } = await joinedAsCaller();
  ws.receive({ t: "signal", call_id: "c1", from: "p2", data: { sdp: { type: "answer", sdp: "a" } } });
  await flush();
  pc.setIce("connected");
  platform.window.fire("online");
  await flush();
  assert.equal(pc.restartIceCalls, 1);
});

test("stats: relay detected from the selected pair, quality emitted, stats frame sent", async () => {
  const { pc, client, ws, events } = await joinedAsCaller();
  pc.stats = new Map([
    ["T", { type: "transport", selectedCandidatePairId: "CP" }],
    ["CP", { type: "candidate-pair", localCandidateId: "L", remoteCandidateId: "R", currentRoundTripTime: 0.12, bytesSent: 1000, bytesReceived: 1000 }],
    ["L", { type: "local-candidate", candidateType: "relay" }],
    ["R", { type: "remote-candidate", candidateType: "srflx" }],
    ["IN", { type: "inbound-rtp", kind: "audio", jitter: 0.02, packetsLost: 1, packetsReceived: 99 }],
  ]);
  await client.collectStats();
  assert.deepEqual(events.find(([e]) => e === "connection")[1], { callId: "c1", pid: "p2", userId: "bob", type: "relay" });
  const q = events.find(([e]) => e === "quality")[1];
  assert.equal(q.rttMs, 120);
  assert.equal(q.jitterMs, 20);
  assert.equal(q.lossPct, 1);
  const s = ws.sentOf("stats").at(-1);
  assert.equal(s.connection, "relay");
  assert.equal(s.rtt_ms, 120);
  assert.equal(s.call_id, "c1");
});

test("readStats: direct path and interval bitrate/loss", () => {
  const mk = (bytes, lost, recv) => new Map([
    ["CP", { type: "candidate-pair", selected: true, localCandidateId: "L", remoteCandidateId: "R", bytesSent: bytes, bytesReceived: 0 }],
    ["L", { type: "local-candidate", candidateType: "host" }],
    ["R", { type: "remote-candidate", candidateType: "prflx" }],
    ["IN", { type: "inbound-rtp", packetsLost: lost, packetsReceived: recv }],
  ]);
  const a = readStats(mk(0, 0, 0), 0);
  const b = readStats(mk(125_000, 10, 90), 10_000, a.cursor);
  assert.equal(b.connection, "direct");
  assert.equal(b.bitrateKbps, 100);
  assert.equal(b.lossPct, 10);
});

test("WS drop: reconnect with backoff, resume within grace, queued signals flushed after resume", async () => {
  const { ws, clock, events, pc } = await joinedAsCaller();
  ws.drop(1006);
  assert.ok(events.some(([e, p]) => e === "reconnecting" && p.scope === "signaling" && p.attempt === 1));
  pc.emitCandidate({ candidate: "while-down" }); // queued
  await clock.tick(backoffDelay(0, () => 0.5));
  const ws2 = FakeWS.all.at(-1);
  assert.notEqual(ws2, ws);
  ws2.receive(HELLO);
  await flush();
  assert.deepEqual(ws2.sent[0], { t: "resume", call_id: "c1", pid: "p1" });
  assert.deepEqual(ws2.sent[1].data, { candidate: { candidate: "while-down" } });
  assert.ok(events.some(([e, p]) => e === "reconnected" && p.scope === "signaling"));
  assert.equal(pc.closed, false, "the peer connection survives a signaling drop");
});

test("WS drop beyond the grace: rejoin with the same media", async () => {
  const { ws, clock } = await joinedAsCaller({ resumeGraceMs: 1000 });
  ws.drop(1006);
  await clock.tick(5_000);
  const ws2 = FakeWS.all.at(-1);
  ws2.receive(HELLO);
  await flush();
  assert.deepEqual(ws2.sentOf("join"), [{ t: "join", call_id: "c1", media: { audio: true, video: true }, platform: "web" }]);
  assert.equal(ws2.sentOf("resume").length, 0);
});

test("silence for 45 s closes the socket and reconnects", async () => {
  const { clock } = await connected();
  const n = FakeWS.all.length;
  await clock.tick(51_000);
  assert.ok(FakeWS.all.length > n);
});

test("auth failure: a fresh token from getToken", async () => {
  let n = 0;
  const getToken = async () => `ct1.t${++n}.s`;
  const clock = new Clock();
  const client = new CatzCallClient({ getToken, platform: makePlatform(clock) });
  const p = client.connect();
  await flush();
  assert.equal(FakeWS.all[0].url, "wss://api.catzconnect.com/rtc/v1/ws?token=ct1.t1.s");
  FakeWS.all[0].receive(HELLO);
  await p;
  FakeWS.all[0].drop(4401);
  await clock.tick(1000);
  await flush();
  assert.equal(FakeWS.all.at(-1).url, "wss://api.catzconnect.com/rtc/v1/ws?token=ct1.t2.s");
});

test("expired static token without getToken: error + closed", async () => {
  const exp = Math.floor(1_000_000 / 1000) - 10; // the fake clock's now is 1,000,000 ms
  const payload = Buffer.from(JSON.stringify({ v: 1, exp })).toString("base64url");
  const token = `ct1.${payload}.mac`;
  assert.equal(tokenExpiry(token), exp);
  const clock = new Clock();
  const client = new CatzCallClient({ token, platform: makePlatform(clock) });
  const events = record(client);
  await assert.rejects(client.connect(), /expired/);
  assert.ok(events.some(([e, p]) => e === "error" && p.code === "token_expired"));
  assert.ok(events.some(([e]) => e === "closed"));
});

test("incoming → accept sends accept; decline and cancel", async () => {
  const { ws, client, events } = await connected();
  ws.receive({ t: "incoming", call: { id: "c7", mode: "video", engine: "catz", from: "bob", participants: [], metadata: { a: 1 } } });
  const inc = events.find(([e]) => e === "incoming")[1];
  assert.equal(inc.callId, "c7");
  assert.equal(inc.from, "bob");
  const ap = client.accept("c7");
  await flush();
  assert.deepEqual(ws.sentOf("accept"), [{ t: "accept", call_id: "c7", media: { audio: true, video: true }, platform: "web" }]);
  ws.receive({ t: "joined", pid: "p3", call: { id: "c7", mode: "video", engine: "catz" }, peers: [{ pid: "p1", user_id: "bob" }] });
  const r = await ap;
  assert.equal(r.call.id, "c7");
  client.leave();
  assert.deepEqual(ws.sentOf("leave"), [{ t: "leave", call_id: "c7" }]);
  client.decline("c8");
  client.cancel("c9");
  assert.deepEqual(ws.sentOf("decline"), [{ t: "decline", call_id: "c8" }]);
  assert.deepEqual(ws.sentOf("cancel"), [{ t: "cancel", call_id: "c9" }]);
});

test("join error rejects the promise", async () => {
  const { ws, client } = await connected();
  const jp = client.join("c1");
  await flush();
  ws.receive({ t: "error", code: "too_many_participants", message: "The call is full", call_id: "c1" });
  await assert.rejects(jp, /full/);
});

test("provider engine: hand-off event, no peer connections", async () => {
  const { ws, client, events, platform } = await connected();
  const jp = client.join("c2", { audio: true, video: true });
  await flush();
  ws.receive({ t: "joined", pid: "p1", call: { id: "c2", mode: "video", engine: "livekit" }, peers: [{ pid: "p2", user_id: "b" }],
    provider: { name: "livekit", room: "r1", token: "jwt", url: "wss://lk" } });
  const r = await jp;
  assert.equal(r.provider.name, "livekit");
  assert.equal(events.find(([e]) => e === "provider")[1].provider.token, "jwt");
  assert.equal(FakePC.all.length, 0);
  assert.equal(platform.mediaDevices.gumCalls.length, 0, "the provider's SDK opens the camera");
});

test("ice_refresh applies new servers with setConfiguration (matching call only)", async () => {
  const { ws, pc } = await joinedAsCaller();
  ws.receive({ t: "ice_refresh", call_id: "other", ice_servers: [{ urls: ["turn:x:3478"], username: "ux", credential: "px" }], ice_ttl: 60 });
  assert.ok(!pc.log.includes("setConfiguration"), "a refresh for another call is ignored");
  ws.receive({ t: "ice_refresh", call_id: "c1", ice_servers: [{ urls: ["turn:new:3478"], username: "u2", credential: "p2" }], ice_ttl: 3600 });
  assert.ok(pc.log.includes("setConfiguration"));
  assert.equal(pc.config.iceServers[0].username, "u2");
  assert.equal(pc.config.iceTransportPolicy, "all");
});

test("a reconnect's STUN-only hello keeps the call's TURN servers; resume's joined renews them", async () => {
  const { ws, clock, pc } = await joinedAsCaller();
  ws.drop(1006);
  await clock.tick(backoffDelay(0, () => 0.5));
  const ws2 = FakeWS.all.at(-1);
  ws2.receive({ ...HELLO, resume: { call_id: "c1", pid: "p1" }, resume_all: [{ call_id: "c1", pid: "p1" }] });
  await flush();
  assert.equal(pc.config.iceServers[1].username, "u", "TURN kept");
  ws2.receive({ t: "joined", pid: "p1", call: { id: "c1", mode: "video", engine: "catz" }, peers: [{ pid: "p2", user_id: "bob" }],
    polite_for: { p2: false }, resume: true, ice_servers: [{ urls: ["turn:turn.test:3478?transport=udp"], username: "u3", credential: "p3" }], ice_ttl: 3600 });
  await flush();
  assert.equal(pc.config.iceServers[0].username, "u3");
  assert.equal(FakePC.all.length, 1, "no new peer connection on resume");
});

test("answered_elsewhere stops ringing; joined_elsewhere tears the call down here", async () => {
  const { ws, client, events } = await connected();
  ws.receive({ t: "incoming", call: { id: "c5", mode: "audio", engine: "catz", from: "bob", participants: [] } });
  ws.receive({ t: "state", call_id: "c5", status: "ringing", reason: "answered_elsewhere" });
  assert.ok(events.some(([e, p]) => e === "state" && p.reason === "answered_elsewhere"));
  const jp = client.join("c6", { audio: true });
  await flush();
  ws.receive({ t: "joined", pid: "p1", call: { id: "c6", mode: "audio", engine: "catz" }, peers: [], ice_servers: CALL_ICE });
  await jp;
  assert.equal(client.callId, "c6");
  ws.receive({ t: "state", call_id: "c6", status: "active", reason: "joined_elsewhere" });
  assert.equal(client.callId, null);
  assert.equal(ws.sentOf("leave").length, 0, "the call goes on on the other device");
});

test("mute, switch camera, share screen and stop via replaceTrack", async () => {
  const { client, pc, events } = await joinedAsCaller();
  client.setMuted("audio", true);
  assert.equal(client.localMediaStream.getAudioTracks()[0].enabled, false);
  assert.equal(client.isMuted("audio"), true);

  await client.switchCamera();
  assert.ok(pc.log.includes("replaceTrack:video:cam-back"));
  assert.equal(client.localMediaStream.getVideoTracks()[0].deviceId, "cam-back");

  await client.shareScreen();
  assert.ok(pc.log.includes("replaceTrack:video:screen"));
  assert.ok(events.some(([e, p]) => e === "local-stream" && p.screen));
  await client.stopShare();
  assert.equal(pc.log.at(-1), "replaceTrack:video:cam-back");
});

test("peer_left and terminal state tear down; close emits closed", async () => {
  const { ws, client, pc, events } = await joinedAsCaller();
  ws.receive({ t: "peer_left", call_id: "c1", pid: "p2", user_id: "bob", reason: "left" });
  assert.equal(pc.closed, true);
  assert.ok(events.some(([e, p]) => e === "peer-left" && p.pid === "p2"));
  const cam = client.localMediaStream.getVideoTracks()[0];
  ws.receive({ t: "state", call_id: "c1", status: "ended", reason: "hangup" });
  assert.equal(client.callId, null);
  assert.equal(cam.stopped, true, "camera released");
  assert.ok(events.some(([e, p]) => e === "state" && p.status === "ended"));
  client.close();
  assert.ok(events.some(([e]) => e === "closed"));
});

test("an offer that overtakes peer_joined still opens a link", async () => {
  const { ws, client } = await connected();
  const jp = client.join("c1", { audio: true });
  await flush();
  ws.receive({ t: "joined", pid: "p1", call: { id: "c1", mode: "audio", engine: "catz" }, peers: [] });
  await jp;
  ws.receive({ t: "signal", call_id: "c1", from: "p4", data: { sdp: { type: "offer", sdp: "o" } } });
  await flush();
  assert.ok(ws.sentOf("signal").some((m) => m.to === "p4" && m.data.sdp?.type === "answer"));
  ws.receive({ t: "peer_joined", call_id: "c1", pid: "p4", user_id: "dave" });
  assert.deepEqual(client.peers, [{ pid: "p4", user_id: "dave" }]);
});

test("close 1008 / 4008 are not auth failures: same token, reconnect (4008 backs off harder)", async () => {
  let n = 0;
  const getToken = async () => `ct1.t${++n}.s`;
  const clock = new Clock();
  const client = new CatzCallClient({ getToken, platform: makePlatform(clock) });
  const events = record(client);
  const p = client.connect();
  await flush();
  FakeWS.all[0].receive(HELLO);
  await p;
  FakeWS.all[0].drop(1008);
  await clock.tick(1000);
  await flush();
  assert.equal(FakeWS.all.length, 2);
  assert.equal(FakeWS.all.at(-1).url, "wss://api.catzconnect.com/rtc/v1/ws?token=ct1.t1.s", "no new token after 1008");
  FakeWS.all.at(-1).receive(HELLO);
  await flush();
  FakeWS.all.at(-1).drop(4008);
  await clock.tick(1000);
  await flush();
  assert.equal(FakeWS.all.length, 2, "4008: not reconnected within 1 s");
  await clock.tick(8000);
  await flush();
  assert.equal(FakeWS.all.length, 3);
  assert.equal(FakeWS.all.at(-1).url, "wss://api.catzconnect.com/rtc/v1/ws?token=ct1.t1.s", "no new token after 4008");
  assert.ok(!events.some(([e]) => e === "closed"));
  client.close();
});

test("close 4401 with a static token: fatal token_expired", async () => {
  const clock = new Clock();
  const client = new CatzCallClient({ token: "ct1.x.y", platform: makePlatform(clock) });
  const events = record(client);
  const p = client.connect();
  await flush();
  FakeWS.all[0].receive(HELLO);
  await p;
  FakeWS.all[0].drop(4401);
  await clock.tick(1000);
  await flush();
  assert.ok(events.some(([e, p]) => e === "error" && p.code === "token_expired"));
  assert.ok(events.some(([e]) => e === "closed"));
});

test("peer_joined with a new epoch for a known pid replaces the link (moved device)", async () => {
  const { ws, client, events } = await connected();
  const jp = client.join("c1", { audio: true });
  await flush();
  ws.receive({ t: "joined", pid: "p1", call: { id: "c1", mode: "audio", engine: "catz" }, peers: [] });
  await jp;
  ws.receive({ t: "peer_joined", call_id: "c1", pid: "p4", user_id: "dave", epoch: 1 });
  await flush();
  const first = FakePC.all.at(-1);
  ws.receive({ t: "signal", call_id: "c1", from: "p4", data: { sdp: { type: "offer", sdp: "o1" } } });
  await flush();
  // Same epoch again: kept.
  ws.receive({ t: "peer_joined", call_id: "c1", pid: "p4", user_id: "dave", epoch: 1 });
  await flush();
  assert.equal(FakePC.all.at(-1), first);
  assert.equal(first.closed, false);
  // Dave moved to his phone: epoch 2 → old connection closed, a new one answers the new offer.
  ws.receive({ t: "peer_joined", call_id: "c1", pid: "p4", user_id: "dave", epoch: 2 });
  await flush();
  const second = FakePC.all.at(-1);
  assert.notEqual(second, first);
  assert.equal(first.closed, true);
  ws.receive({ t: "signal", call_id: "c1", from: "p4", data: { sdp: { type: "offer", sdp: "o2" } } });
  await flush();
  assert.equal(second.remoteDescription?.sdp, "o2");
  assert.equal(client.peers.length, 1);
  assert.equal(events.filter(([e]) => e === "peer-joined").length, 3);
});

test("joined after a resume: a peer with a new epoch is re-offered on a new link", async () => {
  const { ws, client, pc } = await joinedAsCaller();
  // The fixture's peer p2 had no epoch; a resume reply now names epoch 1 → learned, kept.
  ws.receive({ t: "joined", pid: "p1", call: { id: "c1", mode: "video", engine: "catz" }, peers: [{ pid: "p2", user_id: "bob", epoch: 1 }], resume: true });
  await flush();
  assert.equal(FakePC.all.at(-1), pc);
  ws.receive({ t: "joined", pid: "p1", call: { id: "c1", mode: "video", engine: "catz" }, peers: [{ pid: "p2", user_id: "bob", epoch: 2 }], resume: true });
  await flush();
  const npc = FakePC.all.at(-1);
  assert.notEqual(npc, pc);
  assert.equal(pc.closed, true);
  assert.ok(ws.sentOf("signal").filter((m) => m.to === "p2" && m.data.sdp?.type === "offer").length >= 2);
  assert.equal(client.peers.length, 1);
});
