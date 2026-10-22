# Changelog

## 2.0.0 — 2026-10-22

The first release since 1.5.0. It collects the entries below that were never published separately (1.9.0, 1.8.0, 1.7.0, 1.6.1, 1.6.0); read them for the details. Every Catz Connect SDK (TypeScript, Go, PHP, Rust, Dart/Flutter) is released as 2.0.0 together.

**Highlights**

- Message status (`messages.get` / `list`), retry-safe sends (`idempotencyKey`), `reference`, test keys, hosted OTP (`otp.start` / `verify`), the management API and the push device registry (`pushDevices`).
- WhatsApp approved templates and media; Email topics and tracking; push broadcasts, topics and scheduled pushes; cross-channel opt-outs.
- Calls (`catzconnect/call`): in-call chat and data messages, call warnings, adaptive video, no participant cap, relay-only calls.
- Security options: https-only base URLs (`setAllowInsecureHttp` / `CATZCONNECT_ALLOW_INSECURE_HTTP=1` to opt out), `checkBaseUrl()`.

**Upgrading from 1.5.x**

- **https only** (since the 1.6.0 entry): a plain `http://` base URL to a host other than `localhost`, `127.0.0.1`, `::1` or `10.0.2.2` is refused before a request is sent; opt in to plain http for a test server only.
- The API answers a request whose timestamp is more than 30 s off with HTTP 400 `clock_skew` (was 401): keep the sending host's clock in sync (NTP).
- Everything else is backward compatible: existing sends post the same body.

## 1.9.0 (unreleased, included in 2.0.0)

**Fixes before release.**

- `pushDevices.opened(publishableKey, messageId, deviceToken?)`: pass the
  device's FCM token so the open is verified and the first verified report
  fires `push.opened`; without it the open is recorded, no webhook.
  Resolves `{ recorded, verified }`.
- `PushDevicesApi` (with `buildRegisterDevicePayload`, `pushTopics` and their
  types) is also exported from the browser-safe `catzconnect/push` entry, which
  has no Node imports (`node:crypto`, `Buffer`); the main entry re-exports the
  same class. Use `catzconnect/push` in browsers, service workers and React
  Native.
- `send()` errors keep `details` (retry_after, attempts_remaining, idempotency
  info) next to `status`, `code` and `body`.
- In-call messages (`catzconnect/call`): `hello.limits` without
  `messages_relay` (a server from before in-call messages) now means relay
  **off** — messages go over data channels only, and `sendChat` / `sendData`
  with no open channel throw `no_route` (`DEFAULT_MESSAGE_LIMITS.relay` is
  `false`). Such a server's `bad_request` "Unknown message type" answer to a
  chat / data frame is reported as an `error` event and never fails a pending
  join or a resume (new helper `isUnsupportedMessageError`).
- The per-peer receive rate bucket is dropped when the participant leaves.
- Ordering note: messages from one sender can arrive out of order when the
  route switches between relay and data channel; sort by `ts` when it
  matters.

**Message status, retry-safe sends, test keys, hosted OTP, management API, push device registry, WhatsApp templates.**

- `send()`: `idempotencyKey` (sent as the `Idempotency-Key` header and the
  `idempotency_key` field; the same key with the same request within 24 h
  returns the first answer — code `idempotency_conflict` for a different
  request) and `reference` (your own id, ≤ 128 chars). Left out when unset:
  existing sends post the same body.
- WhatsApp: approved templates by their Meta name (`payload.whatsapp`:
  `language`, `header`, `body` array or named object, `buttons`) and media
  messages (`template: "Custom"` + `whatsapp.media`), checked as the server
  checks them (`verifyWhatsAppOptions`, `verifyWhatsAppMedia`).
- Email: `payload.tracking: { opens?, clicks? }` per-message tracking override.
- `catzconnect.messages.get(id)` / `.list({ recipient?, reference?, channel?, limit?, before? })`:
  status (normalised: queued … delivered, read, failed, bounced …) and event timeline.
- `catzconnect.otp.start({...})` / `.verify({...})`: hosted one-time codes.
- `catzconnect.manage.templates|webhooks|suppressions|keys.*`: the management API
  (a key with the management scope).
- `catzconnect.pushDevices.register/unregister/opened` (publishable key, no API key).
- `ErrorCodes` (incl. `organization_suspended`, `sending_paused`, `key_expired`,
  `ip_not_allowed`, `whatsapp_window_closed`, the OTP and idempotency codes),
  `isRetryableCode`, `CatzApiError.details` (e.g. `attempts_remaining`).
- Webhooks: `WEBHOOK_EVENTS`, `parseWebhookEvent()` (verifies the signature and
  returns `{ id, type, created_at, organization_id, test, data }`; `test` is true
  for test-key events).
- Successful sends now return `data.message_id` on every channel (servers from
  this release); test keys add `data.test: true`.

**Cross-channel opt-outs, topics and push broadcasts** (servers with per-channel suppressions):

- Email `payload.topic` (a subscription topic key; errors `invalid_topic`,
  `topic_email_only`).
- Push `payload.push: { broadcast?, topic?, send_at? }` (`send_at` as an RFC 3339
  string or a `Date`); the answer's `data` has `broadcast_id`, `audience`,
  `status: "scheduled"`, `send_at`. New `catzconnect.push`: `broadcast(id)`,
  `cancel(id)`, `subscribe` / `unsubscribe({ identity, topic, tokens?, externalUserId? })`,
  `topics(identity)` (server keys; app and test keys are refused with
  `not_allowed_for_app_keys` / `not_allowed_for_test_keys`).
- `pushDevices.subscribeTopics` / `unsubscribeTopics(publishableKey, token, topics)`
  (`/push/topics/subscribe|unsubscribe`, in the app).
- `messages.list({ broadcastId })` lists a broadcast's deliveries; message
  status has `broadcast_id` and `resent_from`, and the original of a panel
  resend has a `resent` event.
- `manage.suppressions`: every channel (`email`, `sms`, `whatsapp`, `voice`,
  `push`), email `topic`, `remove({ id })`; entries carry `channel` and `topic`.
- `ErrorCodes`: `INVALID_TOPIC`, `TOPIC_EMAIL_ONLY`, `RECIPIENT_SUPPRESSED`
  (hosted OTP to an opted-out recipient), `WHATSAPP_OPTED_OUT`,
  `NOT_CANCELABLE`, `NOT_RESENDABLE`, `CONTENT_GONE`.
- `WEBHOOK_EVENTS` adds `email.complained`, `email.unsubscribed`,
  `push.opened`, `sms.inbound`, `sms.opt_out`, `whatsapp.opt_out`.

## 1.8.0 (unreleased, included in 2.0.0)

**In-call chat and data messages (`catzconnect/call`).**

- `client.sendChat(text, { to? })` and `client.sendData(payload, { to?, reliable? })`
  send to everyone in the call or to one participant (`to`: its pid) and
  return `SentMessage { id, ts, via: "p2p" | "relay", to }`. New events
  `chat` (`CallChatMessage { callId, id, from, userId, text, to, private,
  ts, via }`) and `data` (`CallDataMessage`, with `payload`). Your own
  messages are not echoed back.
- Peer-to-peer first: the side that offers opens two WebRTC data channels
  per peer before its first offer — `catz-msg` (ordered, reliable) and
  `catz-msg-u` (unordered, no retransmits, for `reliable: false`). When a
  target's channel is not open (still connecting, a provider-engine call)
  the message goes through the signaling server (`{ t: "chat" | "data" }`);
  `messageTransport: "server"` always uses the server. Receivers drop
  repeats of (sender pid, message id), so a message that went both ways is
  shown once.
- Caps from the server's `hello.limits` (`chat_max_chars` 2000,
  `data_max_bytes` 16384 as JSON, `messages_per_sec` 5 / `messages_burst`
  20 per participant, `messages_relay`), exposed as `client.messageLimits`.
  A send over a cap or the rate throws `CallMessageError` (`not_in_call`,
  `bad_request`, `message_too_large`, `rate_limited`, `no_route`); a refusal
  by the server is an `error` event with `messageId`. Messages arriving over
  a data channel are checked against the same caps and rate-limited per
  peer.
- Pure helpers exported: `messageLimitsFrom`, `checkChat`, `checkData`,
  `RateBucket`, `Dedup`, `chooseRoute`, `encodeEnvelope`, `decodeEnvelope`,
  `validMessageId`, `DEFAULT_MESSAGE_LIMITS`.

## 1.7.0 (unreleased, included in 2.0.0)

**Call warnings, adaptive video, no participant cap (`catzconnect/call`).**

- New events `warning` (`CallWarning { code, message, callId, participants?,
  source: "server" | "client", severity: "info" | "warning", at }`) and
  `warning-cleared` (`{ code, callId, source, at }`), plus the
  `activeWarnings` getter. Server codes: `large_call`, `relay_busy`,
  `relay_unavailable` (the server's new `warning` / `warning_cleared`
  frames). Client codes: `poor_network`, `device_overloaded`,
  `video_reduced` (info), `video_paused`. Unknown codes are passed through;
  `CallWarningCodes` and `DEFAULT_WARNING_MESSAGES` (English) are exported
  for localisation.
- Client checks every 2 s (`healthIntervalMs`) from `getStats()`:
  `poor_network` when the estimated uplink is below what the peers need,
  loss > 8 % or RTT > 600 ms for 6 s; `device_overloaded` when the video
  encoder is CPU-limited for 6 s. Each is emitted once and cleared after
  6 s of recovery (with stricter exit thresholds, so it does not flap).
- **Adaptive video** (default on, `adaptiveVideo: false` to opt out): in a
  peer-to-peer call the outgoing video is split across the peers —
  clamp(available / peers, 150 kbps, 1.5 Mbps) each, with
  `scaleResolutionDownBy` 1 · 1.5 · 2 · 3 — via `RTCRtpSender.setParameters`;
  under 150 kbps per peer video is paused (`encodings[0].active = false`,
  the track stays, so resuming is instant) to keep audio clear, and resumed
  when bandwidth allows. Audio is never touched. A 1:1 call keeps the
  browser's own limits unless video has to pause.
- **No participant cap in the client.** The client used to open
  connections to at most `max_participants - 1` peers and emit
  `too_many_participants`; it now connects to everyone the server admits.
- P2P first is unchanged: `iceTransportPolicy: "all"` unless `relayOnly`,
  ICE servers used in the server's order (STUN first, TURN as fallback).
- `readStats()` / `StatsSample` gain `availableOutgoingKbps`,
  `remoteLossPct` and `cpuLimited`; RTT falls back to `remote-inbound-rtp`.
- Pure helpers exported for tests and custom UIs: `parseWarning`,
  `parseWarningCleared`, `SustainedFlag`, `networkBad`, `requiredKbps`,
  `videoBudget`, `videoTarget`, `levelFor`, `VideoAdapter`.

## 1.6.1 (unreleased, included in 2.0.0)

- A blank `CATZCONNECT_BASE_URL` (e.g. an empty line in a `.env` file) now
  means the default API, `https://api.catzconnect.com`, as in the Go and
  Dart SDKs; it used to throw "not a valid URL".
- Note: the API now answers a request whose timestamp is more than 30 s from
  its clock with HTTP 400 and `code: "clock_skew"` (was 401), surfaced as a
  `CatzApiError` with status 400. Keep the sending host's clock in sync (NTP).

## 1.6.0 (unreleased, included in 2.0.0)

**Security options.**

- **https only.** A plain `http://` `CATZCONNECT_BASE_URL` to a host other
  than `localhost`, `127.0.0.1`, `::1` or `10.0.2.2` now throws before a
  request is sent (it used to send the API key in clear text). Opt in with
  `CATZCONNECT_ALLOW_INSECURE_HTTP=1` or `catzconnect.setAllowInsecureHttp(true)`.
  `checkBaseUrl()` is exported. The browser call client's signaling `url`
  follows the same rule for `ws://` (constructor throws; opt in with
  `allowInsecureHttp: true`).
- **Relay-only calls.** `new CatzCallClient({ relayOnly: true })` and
  `join/accept(callId, { relayOnly })` force `iceTransportPolicy: "relay"`,
  so other participants never learn the device's IP addresses (needs TURN on
  the server). Default unchanged (`"all"`).

Earlier versions: see the git history.
