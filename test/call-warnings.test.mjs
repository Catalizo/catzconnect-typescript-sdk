// Call warnings: server warning frames, client-side checks (hysteresis), and adaptive video. Run after `npm run build`.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  CatzCallClient,
  CallWarningCodes,
  SustainedFlag,
  VideoAdapter,
  VIDEO_PAUSED,
  levelFor,
  networkBad,
  parseWarning,
  parseWarningCleared,
  readStats,
  requiredKbps,
  videoBudget,
  videoTarget,
} from "../dist/call.mjs";
import { CALL_ICE, Clock, FakePC, FakeWS, HELLO, flush, makePlatform } from "./fakes.mjs";

beforeEach(() => {
  FakePC.all = [];
  FakeWS.all = [];
});

// ── pure helpers ────────────────────────────────────────────────────────

test("parseWarning: known code, participants, English default, unknown code passed through", () => {
  const w = parseWarning({ t: "warning", call_id: "c1", code: "large_call", participants: 7, message: "Many people" }, 5);
  assert.deepEqual(w, { code: "large_call", message: "Many people", callId: "c1", participants: 7, source: "server", severity: "warning", at: 5 });
  const d = parseWarning({ t: "warning", call_id: "c1", code: "relay_unavailable" }, 1);
  assert.equal(d.message, "Calls aren't available on this network right now");
  assert.equal("participants" in d, false);
  const u = parseWarning({ t: "warning", call_id: "c1", code: "brand_new_code", participants: "3" }, 1);
  assert.equal(u.code, "brand_new_code");
  assert.equal(u.participants, 3);
  assert.match(u.message, /brand_new_code/);
  // call_id falls back to the current call; garbage is null
  assert.equal(parseWarning({ t: "warning", code: "relay_busy" }, 1, "cX").callId, "cX");
  assert.equal(parseWarning({ t: "warning", code: "relay_busy" }, 1), null);
  assert.equal(parseWarning({ t: "warning", call_id: "c1" }, 1), null);
  assert.equal(parseWarning({ t: "state", call_id: "c1", code: "x" }, 1), null);
  assert.equal(parseWarning(null, 1), null);
  assert.equal(parseWarning({ t: "warning", call_id: "c1", code: "video_reduced" }, 1).severity, "info");
});

test("parseWarningCleared", () => {
  assert.deepEqual(parseWarningCleared({ t: "warning_cleared", call_id: "c1", code: "large_call" }, 9), {
    code: "large_call", callId: "c1", source: "server", at: 9,
  });
  assert.equal(parseWarningCleared({ t: "warning_cleared", code: "" }, 9, "c1"), null);
  assert.equal(parseWarningCleared({ t: "warning", call_id: "c1", code: "x" }, 9), null);
});

test("SustainedFlag: enters after 6 s bad, exits after 6 s good, once each, a blip resets", () => {
  const f = new SustainedFlag(6000, 6000);
  assert.equal(f.update(true, 0), null);
  assert.equal(f.update(true, 2000), null);
  assert.equal(f.update(false, 4000), null); // blip: start over
  assert.equal(f.update(true, 6000), null);
  assert.equal(f.update(true, 10000), null);
  assert.equal(f.update(true, 12000), "enter");
  assert.equal(f.update(true, 14000), null); // no repeat
  assert.equal(f.update(false, 16000), null);
  assert.equal(f.update(true, 18000), null); // still active, good streak broken
  assert.equal(f.update(false, 20000), null);
  assert.equal(f.update(false, 26000), "exit");
  assert.equal(f.update(false, 30000), null);
  assert.equal(f.active, false);
});

test("networkBad: enter thresholds and stricter exit thresholds (hysteresis)", () => {
  const base = { availableKbps: null, neededKbps: 0, lossPct: 0, rttMs: 100 };
  assert.equal(networkBad({ ...base, lossPct: 8.5 }, false), true);
  assert.equal(networkBad({ ...base, lossPct: 8 }, false), false);
  assert.equal(networkBad({ ...base, rttMs: 650 }, false), true);
  assert.equal(networkBad({ ...base, availableKbps: 300, neededKbps: 380 }, false), true);
  assert.equal(networkBad({ ...base, availableKbps: 400, neededKbps: 380 }, false), false);
  // active: 6 % loss / 500 ms / 1.1× still counts as bad
  assert.equal(networkBad({ ...base, lossPct: 6 }, true), true);
  assert.equal(networkBad({ ...base, rttMs: 500 }, true), true);
  assert.equal(networkBad({ ...base, availableKbps: 418, neededKbps: 380 }, true), true);
  assert.equal(networkBad({ ...base, lossPct: 3, rttMs: 300, availableKbps: 460, neededKbps: 380 }, true), false);
  assert.equal(networkBad({ availableKbps: null, neededKbps: 380, lossPct: null, rttMs: null }, false), false);
  assert.equal(requiredKbps(4, true), 760);
  assert.equal(requiredKbps(4, false), 160);
});

test("videoBudget: clamp(available / peers, 150, 1500) and resolution steps", () => {
  assert.deepEqual(videoBudget(20000, 2), { perPeerKbps: 10000, maxBitrateKbps: 1500, scaleResolutionDownBy: 1, paused: false, level: 0 });
  assert.deepEqual(videoBudget(4400, 4), { perPeerKbps: 1100, maxBitrateKbps: 1100, scaleResolutionDownBy: 1, paused: false, level: 1 });
  assert.equal(videoBudget(3000, 4).scaleResolutionDownBy, 1.5); // 750
  assert.equal(videoBudget(3000, 4).maxBitrateKbps, 750);
  assert.equal(videoBudget(2000, 5).scaleResolutionDownBy, 2); // 400
  assert.equal(videoBudget(1000, 5).scaleResolutionDownBy, 3); // 200
  const p = videoBudget(1000, 8); // 125 < 150
  assert.equal(p.paused, true);
  assert.equal(p.maxBitrateKbps, 150);
  assert.equal(videoBudget(0, 0).paused, true);
  assert.equal(levelFor(150), 4);
  assert.equal(levelFor(149.9), VIDEO_PAUSED);
  assert.equal(levelFor(NaN), VIDEO_PAUSED);
  // 1:1 at the best level keeps the browser's own limits
  assert.deepEqual(videoTarget(0, 1), { level: 0, maxBitrateKbps: null, scaleResolutionDownBy: 1, active: true });
  assert.deepEqual(videoTarget(0, 3), { level: 0, maxBitrateKbps: 1500, scaleResolutionDownBy: 1, active: true });
  assert.deepEqual(videoTarget(VIDEO_PAUSED, 3), { level: VIDEO_PAUSED, maxBitrateKbps: 150, scaleResolutionDownBy: 3, active: false });
});

test("VideoAdapter: warmup, step down after 4 s, hysteresis keeps a level, step up one at a time", () => {
  const a = new VideoAdapter();
  const s = (now, avail, peers = 4, lossPct = 0) => a.update({ now, peers, availableKbps: avail, lossPct, rttMs: 100 });
  assert.deepEqual(s(0, 1000), []); // warmup
  assert.deepEqual(s(8000, 1000), []);
  assert.equal(a.level, 0);
  assert.deepEqual(s(10000, 2400), []); // 600 per peer → level 2 wanted, not yet
  assert.deepEqual(s(12000, 2400), []);
  assert.deepEqual(s(14000, 2400), ["reduced"]);
  assert.equal(a.level, 2);
  // 500 per peer is ≥ 75 % of 600: stays at level 2
  for (let t = 16000; t <= 30000; t += 2000) assert.deepEqual(s(t, 2000), []);
  assert.equal(a.level, 2);
  // fills the cap (≥ 85 % of 600) with low loss for 10 s: one level up
  for (let t = 32000; t < 42000; t += 2000) assert.deepEqual(s(t, 2100), []);
  assert.deepEqual(s(42000, 2100), []);
  assert.equal(a.level, 1);
  // high loss blocks stepping up
  for (let t = 44000; t <= 70000; t += 2000) s(t, 4000, 4, 5);
  assert.equal(a.level, 1);
  for (let t = 72000; t <= 82000; t += 2000) s(t, 4000);
  assert.equal(a.level, 0);
});

test("VideoAdapter: pause under 150 kbps per peer, retry with backoff, resume", () => {
  const a = new VideoAdapter({ warmupMs: 0 });
  const s = (now, avail, peers = 3) => a.update({ now, peers, availableKbps: avail, lossPct: 0, rttMs: 100 });
  assert.deepEqual(s(0, 300), []);
  assert.deepEqual(s(4000, 300), ["reduced", "paused"]);
  assert.equal(a.paused, true);
  assert.deepEqual(s(10000, 300), []);
  assert.deepEqual(s(19000, 300), ["resumed"]); // retry at the lowest level after 15 s
  assert.equal(a.level, 4);
  assert.deepEqual(s(21000, 300), []);
  assert.deepEqual(s(25000, 300), ["paused"]); // still too little after 4 s: paused again
  assert.deepEqual(s(50000, 300), []); // next retry waits 30 s
  assert.deepEqual(s(55000, 3000), ["resumed"]);
  assert.equal(a.level, 4);
  // headroom: climbs back level by level
  for (let t = 57000; t <= 200000; t += 2000) s(t, 6000);
  assert.equal(a.level, 0);
  assert.equal(a.reduced, false);
});

test("VideoAdapter: one peer only pauses (no bitrate steps) and comes back to the browser's limits", () => {
  const a = new VideoAdapter({ warmupMs: 0 });
  const s = (now, avail) => a.update({ now, peers: 1, availableKbps: avail, lossPct: 0, rttMs: 50 });
  for (let t = 0; t <= 20000; t += 2000) assert.deepEqual(s(t, 400), []);
  assert.equal(a.level, 0);
  s(22000, 100);
  assert.deepEqual(s(26000, 100), ["reduced", "paused"]);
  assert.deepEqual(s(41000, 100), ["resumed", "restored"]);
  assert.equal(a.level, 0);
});

test("readStats: availableOutgoingBitrate, remote loss and CPU limitation", () => {
  const r = readStats(new Map([
    ["T", { type: "transport", selectedCandidatePairId: "CP" }],
    ["CP", { type: "candidate-pair", localCandidateId: "L", remoteCandidateId: "R", availableOutgoingBitrate: 850_000 }],
    ["L", { type: "local-candidate", candidateType: "host" }],
    ["R", { type: "remote-candidate", candidateType: "srflx" }],
    ["O", { type: "outbound-rtp", kind: "video", qualityLimitationReason: "cpu", bytesSent: 10 }],
    ["RI", { type: "remote-inbound-rtp", kind: "video", fractionLost: 0.1, roundTripTime: 0.25 }],
  ]), 0);
  assert.equal(r.availableOutgoingKbps, 850);
  assert.equal(r.remoteLossPct, 10);
  assert.equal(r.cpuLimited, true);
  assert.equal(r.rttMs, 250); // from remote-inbound-rtp when the pair has none
});

// ── the client ──────────────────────────────────────────────────────────

function record(client) {
  const events = [];
  for (const e of ["warning", "warning-cleared", "error"]) client.on(e, (p) => events.push([e, p]));
  return events;
}

async function joined(peers = [{ pid: "p2", user_id: "bob" }], opts = {}) {
  const clock = new Clock();
  const platform = makePlatform(clock);
  const client = new CatzCallClient({ token: "ct1.x.y", url: "wss://api.test/rtc/v1/ws", ...opts, platform });
  const events = record(client);
  const cp = client.connect();
  await flush();
  const ws = FakeWS.all.at(-1);
  ws.receive(HELLO);
  await cp;
  const jp = client.join("c1", { audio: true, video: true });
  await flush();
  ws.receive({ t: "joined", pid: "p1", call: { id: "c1", mode: "video", engine: "catz" }, peers, ice_servers: CALL_ICE });
  await jp;
  await flush();
  return { clock, client, events, ws };
}

const pathStats = (extra = {}, pair = {}) => new Map([
  ["T", { type: "transport", selectedCandidatePairId: "CP" }],
  ["CP", { type: "candidate-pair", localCandidateId: "L", remoteCandidateId: "R", currentRoundTripTime: 0.05, ...pair }],
  ["L", { type: "local-candidate", candidateType: "host" }],
  ["R", { type: "remote-candidate", candidateType: "srflx" }],
  ...Object.entries(extra),
]);

test("server warning → warning event + activeWarnings; repeats are not re-emitted; cleared; unknown codes pass", async () => {
  const { client, events, ws } = await joined();
  ws.receive({ t: "warning", call_id: "c1", code: "large_call", participants: 6, message: "Many people in this call" });
  ws.receive({ t: "warning", call_id: "c1", code: "large_call", participants: 6, message: "Many people in this call" });
  ws.receive({ t: "warning", call_id: "other", code: "relay_busy" }); // another call: ignored
  ws.receive({ t: "warning", call_id: "c1", code: "future_code" });
  const ws1 = events.filter(([e]) => e === "warning").map(([, p]) => p);
  assert.equal(ws1.length, 2);
  assert.equal(ws1[0].code, CallWarningCodes.LargeCall);
  assert.equal(ws1[0].participants, 6);
  assert.equal(ws1[0].source, "server");
  assert.equal(ws1[1].code, "future_code");
  assert.deepEqual(client.activeWarnings.map((w) => w.code), ["large_call", "future_code"]);

  ws.receive({ t: "warning", call_id: "c1", code: "large_call", participants: 8 }); // count changed: emitted again
  assert.equal(events.filter(([e]) => e === "warning").length, 3);
  assert.equal(client.activeWarnings.find((w) => w.code === "large_call").participants, 8);

  ws.receive({ t: "warning_cleared", call_id: "c1", code: "large_call" });
  ws.receive({ t: "warning_cleared", call_id: "c1", code: "large_call" }); // not active: nothing
  const cleared = events.filter(([e]) => e === "warning-cleared").map(([, p]) => p);
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0].code, "large_call");
  assert.equal(cleared[0].callId, "c1");
  assert.deepEqual(client.activeWarnings.map((w) => w.code), ["future_code"]);

  // leaving clears what is left
  client.leave();
  assert.equal(events.filter(([e]) => e === "warning-cleared").length, 2);
  assert.deepEqual(client.activeWarnings, []);
});

test("no participant cap in the client: every peer gets a connection (hello says 4)", async () => {
  const peers = ["p2", "p3", "p4", "p5", "p6", "p7"].map((pid) => ({ pid, user_id: `u-${pid}` }));
  const { events, client } = await joined(peers);
  assert.equal(FakePC.all.length, 6);
  assert.equal(client.peers.length, 6);
  assert.ok(!events.some(([e, p]) => e === "error" && p.code === "too_many_participants"));
  // P2P first: policy all, ICE servers in the server's order (STUN first)
  for (const pc of FakePC.all) {
    assert.equal(pc.config.iceTransportPolicy, "all");
    assert.deepEqual(pc.config.iceServers.map((s) => s.urls), CALL_ICE.map((s) => s.urls));
  }
});

test("poor_network: raised after 6 s of high RTT, once; cleared after 6 s of recovery", async () => {
  const { clock, client, events } = await joined();
  const pc = FakePC.all[0];
  pc.stats = pathStats({}, { currentRoundTripTime: 0.8 });
  await clock.tick(4000);
  assert.equal(events.filter(([e]) => e === "warning").length, 0);
  await clock.tick(4000);
  let w = events.filter(([e]) => e === "warning").map(([, p]) => p);
  assert.equal(w.length, 1);
  assert.equal(w[0].code, "poor_network");
  assert.equal(w[0].source, "client");
  assert.equal(w[0].participants, 2);
  await clock.tick(10000);
  assert.equal(events.filter(([e]) => e === "warning").length, 1, "no spam");
  pc.stats = pathStats({}, { currentRoundTripTime: 0.45 }); // under 600 but not under the 400 exit threshold
  await clock.tick(10000);
  assert.equal(events.filter(([e]) => e === "warning-cleared").length, 0);
  pc.stats = pathStats({}, { currentRoundTripTime: 0.1 });
  await clock.tick(8000);
  const c = events.filter(([e]) => e === "warning-cleared").map(([, p]) => p);
  assert.equal(c.length, 1);
  assert.equal(c[0].code, "poor_network");
  assert.deepEqual(client.activeWarnings, []);
});

test("device_overloaded from qualityLimitationReason cpu", async () => {
  const { clock, events } = await joined();
  FakePC.all[0].stats = pathStats({ O: { type: "outbound-rtp", kind: "video", qualityLimitationReason: "cpu" } });
  await clock.tick(8000);
  assert.deepEqual(events.filter(([e]) => e === "warning").map(([, p]) => p.code), ["device_overloaded"]);
});

test("adaptive video: per-peer budget split over 4 peers sets maxBitrate/scale on video senders only", async () => {
  const peers = ["p2", "p3", "p4", "p5"].map((pid) => ({ pid, user_id: pid }));
  const { clock, events } = await joined(peers);
  for (const pc of FakePC.all) pc.stats = pathStats({}, { availableOutgoingBitrate: 700_000 });
  await clock.tick(20000);
  const w = events.filter(([e]) => e === "warning").map(([, p]) => p);
  assert.deepEqual(w.map((x) => x.code), ["video_reduced"]);
  assert.equal(w[0].severity, "info");
  for (const pc of FakePC.all) {
    const video = pc.getSenders().find((s) => s.track?.kind === "video");
    const audio = pc.getSenders().find((s) => s.track?.kind === "audio");
    assert.equal(video.params.encodings[0].maxBitrate, 600_000);
    assert.equal(video.params.encodings[0].scaleResolutionDownBy, 1.5);
    assert.equal(video.params.encodings[0].active, true);
    assert.equal(audio.setParametersCalls, 0, "audio untouched");
  }
  const calls = FakePC.all[0].getSenders().find((s) => s.track?.kind === "video").setParametersCalls;
  await clock.tick(6000);
  assert.equal(FakePC.all[0].getSenders().find((s) => s.track?.kind === "video").setParametersCalls, calls, "not re-applied when unchanged");
});

test("adaptive video: pauses under 150 kbps per peer, resumes with warning-cleared", async () => {
  const { clock, events, client } = await joined();
  const pc = FakePC.all[0];
  const video = () => pc.getSenders().find((s) => s.track?.kind === "video");
  pc.stats = pathStats({}, { availableOutgoingBitrate: 100_000 });
  await clock.tick(18000);
  assert.deepEqual(events.filter(([e]) => e === "warning").map(([, p]) => p.code), ["video_reduced", "video_paused"]);
  assert.equal(video().params.encodings[0].active, false);
  assert.ok(video().track, "track kept: resuming needs no renegotiation");
  assert.ok(client.activeWarnings.some((w) => w.code === "video_paused"));
  pc.stats = pathStats({}, { availableOutgoingBitrate: 2_000_000 });
  await clock.tick(16000);
  assert.deepEqual(events.filter(([e]) => e === "warning-cleared").map(([, p]) => p.code), ["video_paused", "video_reduced"]);
  assert.equal(video().params.encodings[0].active, true);
  assert.equal(video().params.encodings[0].maxBitrate, undefined, "1:1 is back on the browser's limits");
  await clock.tick(30000);
  assert.equal(events.filter(([e]) => e === "warning").length, 2, "no new warnings");
});

test("adaptiveVideo: false never touches the senders", async () => {
  const { clock, events } = await joined(undefined, { adaptiveVideo: false });
  const pc = FakePC.all[0];
  pc.stats = pathStats({}, { availableOutgoingBitrate: 100_000 });
  await clock.tick(30000);
  assert.ok(!events.some(([e, p]) => e === "warning" && p.code.startsWith("video_")));
  assert.ok(pc.getSenders().every((s) => s.setParametersCalls === 0));
});
