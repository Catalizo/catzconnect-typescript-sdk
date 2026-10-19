# CatzConnect SDK (TypeScript)

A secure, minimal SDK for sending encrypted communication requests (e.g., email OTP) to the CatzConnect API.

---

## ✨ Features

* 🔐 End-to-end payload encryption using `libsodium`
* ⚡ Stateless design (no `init()` required)
* 🧠 Automatic payload validation (based on type + channel + template)
* 🔑 API key via environment (Bearer token)
* 🧱 Clean, extensible architecture

---

## 📦 Installation

```bash
npm install catzconnect
```
---

## ⚙️ Environment Setup

Create a `.env` file:

```env
CATZCONNECT_API_KEY=your_api_key
CATZCONNECT_PRIVATE_KEY=your_base64_private_key
CATZCONNECT_SERVER_PUBLIC_KEY=server_base64_public_key
```

> ⚠️ Never expose these values in frontend/public environments.

---

## 🚀 Usage

```ts
import { catzconnect } from "catzconnect";

await catzconnect.send({
  type: "Verification",
  channel: "Email",
  template: "Otp",
  identity: "user@domain.com",
  payload: {
    to: "user@example.com",
    otp: "123456",
  },
});
```

---

## 🌐 Language of the default OTP templates

`send()` takes an optional top-level `language` — `en`, `de`, `ja`, `ar` or
`hi`. A BCP-47 tag such as `"de-DE"` is accepted and sent as its primary
subtag (`"de"`); anything else is rejected before the request with
`Unsupported 'language' "fr": use one of en, de, ja, ar, hi …`. It picks the
language of the **built-in** Otp/Verification templates (Email, SMS, Voice,
WhatsApp); templates you created in the panel are sent as written (create
one per language if you need to). Leave it out and the server uses English,
exactly as before.

```ts
await catzconnect.send({
  type: "Verification", channel: "Email", template: "Otp",
  identity: "noreply@yourdomain.com", language: "de-DE",
  payload: { to: "user@example.com", otp: "123456" },
}); // body: { …, "language": "de" }

// A default for every send that does not set one (undefined clears it).
catzconnect.setDefaultLanguage("ja");
```

`normaliseLanguage("de-DE")` (→ `"de"`, throws otherwise), `isValidLanguage`
and `SUPPORTED_LANGUAGES` are exported. Requires a server with
localized templates; an older server ignores the field.

---

## 📬 Supported Operation

### Email Verification OTP

```ts
{
  type: "Verification",
  channel: "Email",
  template: "Otp",
  identity: "user@domain.com",
  language?: "en" | "de" | "ja" | "ar" | "hi" | "de-DE" …, // optional: localized default template
  payload: {
    to: string;   // required, valid email
    otp: string;  // required
  }
}
```

### Email Transactional

```ts
{
  type: "Transactional",
  channel: "Email",
  template: "Custom",
  identity: "user@domain.com",
  payload: {
    to: string;   // required, valid email
    subject: string;  // required
    body: string;  // required
  }
}
```

---

## 🔐 How It Works

1. **Validate Input**

   * Ensures required fields are present
   * Validates email format

2. **Encrypt Payload**

   * Uses X25519 (ECDH) + ChaCha20-Poly1305
   * Derived symmetric key via BLAKE2b

3. **Send Request**

   * POST `/comm/email/verify`
   * Authorization via Bearer token

4. **Server Processes Securely**

---

## ❌ Error Handling

Errors thrown:

* Missing environment variables
* Invalid payload (e.g., missing `to`, invalid email)
* Encryption failure
* HTTP errors (non-200 response)

Example:

```ts
try {
  await catzconnect.send(...);
} catch (err) {
  console.error(err.message);
}
```

---

## 🧩 Example Response

```json
{
  "status": "success"
}
```

---

## 🛠 Development

```bash
npm run build
npm run dev
```

---

## WhatsApp

`to` is a phone number with country code; `identity` is your connected WhatsApp number.

```ts
await catzconnect.send({
  type: "Verification", channel: "WhatsApp", template: "Otp",
  identity: "919578456444",
  payload: { to: "+91 98765 43210", otp: "123456" },
});

await catzconnect.send({
  type: "Transactional", channel: "WhatsApp", template: "Custom",
  identity: "919578456444",
  payload: { to: "+91 98765 43210", subject: "Order shipped", body: "Arriving Friday." },
});
```

Localized OTP: add `language: "hi"` (or `"hi-IN"`) and the server sends the
Authentication template in Meta's matching language code — the template must
be approved in that language on your WhatsApp Business Account, or Meta
rejects the message.

```ts
await catzconnect.send({
  type: "Verification", channel: "WhatsApp", template: "Otp",
  identity: "919578456444", language: "hi",
  payload: { to: "+91 98765 43210", otp: "123456" },
});
```

OTPs need an approved Authentication template on the number. Custom messages only
reach people who messaged your number in the last 24 hours. See `WHATSAPP.md`.

## Push notifications (end-to-end encrypted)

```ts
import { catzconnect } from "catzconnect";                       // server
import { generateDeviceKeys, openPushPayload, isSealedPush } from "catzconnect/push"; // app or browser

// Server: send
await catzconnect.send({
  type: "Notification", channel: "Push", template: "Notification",
  identity: "your-firebase-project-id",
  payload: { to: fcmToken, device_key: devicePublicKey, title: "Hi", body: "Hello" },
});

// Device: generate keys once, then open incoming messages
const keys = await generateDeviceKeys();
if (isSealedPush(message.data)) {
  const n = await openPushPayload(message.data, keys);
}
```

Import device helpers from `catzconnect/push` in a browser or service worker —
it has no Node APIs and no API-key handling. See `PUSH.md` for web, Android and iOS.

## Email templates from the panel

```ts
await catzconnect.send({
  type: "Transactional",
  channel: "Email",
  template: "Order shipped",          // the template's name in the panel
  identity: "noreply@yourdomain.com",
  payload: { to: "user@example.com", data: { name: "Ann", order_id: "A-1042" } },
});
```

## Push to a user's registered devices

When your app registers its devices with `POST /push/register` (using the
project's publishable key), send to the user instead of a token:

```ts
await catzconnect.send({
  type: "Notification",
  channel: "Push",
  template: "Notification",
  identity: "my-firebase-project",
  payload: { external_user_id: "user-42", title: "Order shipped", body: "It's on the way" },
});
```

Give either `to` or `external_user_id`. Each device's registered key is used
for encryption, so `device_key` is not allowed with `external_user_id`.

## Verifying webhooks

```ts
import { verifyWebhookSignature } from "catzconnect";

// Express: app.post("/webhooks/catz", express.raw({ type: "application/json" }), handler)
const ok = verifyWebhookSignature(req.body, req.get("catz-signature"), process.env.CATZCONNECT_WEBHOOK_SECRET!);
if (!ok) return res.sendStatus(400);
const event = JSON.parse(req.body.toString("utf8"));
```

Pass the raw body, before JSON parsing. Timestamps more than 5 minutes old are
rejected (change with the fourth argument, in seconds).

## SMS

`to` is an E.164 number (`+` and the country code; spaces, dashes, dots and
brackets are removed). `identity` is ignored for SMS — pass `""`. The SMS
result is typed: `data` is `{ message_id, segments, encoding }`.

```ts
// One-time code: type Verification, template Otp (up to 15 letters or digits).
const res = await catzconnect.send({
  channel: "SMS", type: "Verification", template: "Otp", identity: "",
  payload: { to: "+14155550100", otp: "123456" },
});
console.log(res.data.message_id, res.data.segments, res.data.encoding); // "…", 1, "gsm7"

// The default OTP text in German ("de-DE" is sent as "de").
await catzconnect.send({
  channel: "SMS", type: "Verification", template: "Otp", identity: "", language: "de-DE",
  payload: { to: "+4915112345678", otp: "123456" },
});

// Free text: type Transactional or Promotional, template Custom.
await catzconnect.send({
  channel: "SMS", type: "Transactional", template: "Custom", identity: "",
  payload: { to: "+44 7700 900123", body: "Your order A-1042 has shipped." },
});

// An SMS template from the panel, filled from data.
await catzconnect.send({
  channel: "SMS", type: "Transactional", template: "Order shipped", identity: "",
  payload: { to: "+14155550100", data: { name: "Ann", order_id: "A-1042" } },
});

// India: a DLT template id is required (unless the panel template has one).
// gateway pins one of the API key's gateways (id or label); sender overrides
// the sender ID when that gateway allows it.
await catzconnect.send({
  channel: "SMS", type: "Promotional", template: "Custom", identity: "",
  payload: {
    to: "+919876543210", body: "Sale ends tonight",
    dlt_template_id: "1207161234567890123", gateway: "MSG91 India", sender: "CATZIN",
  },
});
```

Checked before sending, as the server does: E.164 `to`; `Otp` only with
`Verification`, `Custom` only with `Transactional`/`Promotional`; `sender`
only with `gateway` (E.164 or 2–11 letters/digits); `dlt_template_id` digits;
Custom bodies at most 10 segments (1,530 GSM-7 or 670 UCS-2 characters), no
control characters, and a DLT id for +91. `analyseSms(text)` returns the
encoding and segment count the server will use; each SMS counts as one
message toward your plan's limit regardless of segments.

## Phone calls (Voice)

`channel: "Voice"` (or `"voice"`) places a phone call that speaks the
message. Like SMS, `to` is E.164 and `identity` is ignored. The call is
queued; `data.message_id` identifies it in `voice.*` webhook events.

```ts
// A one-time code, read out digit by digit.
const res = await catzconnect.send({
  channel: "Voice", type: "Verification", template: "Otp", identity: "",
  payload: { to: "+14155550100", otp: "482913", data: { language: "en-US", voice: "female", repeat: "2" } },
});
console.log(res.data.message_id);

// The default OTP script in Japanese; the TTS language/voice follow it.
// data.language, when given, still overrides the spoken language.
await catzconnect.send({
  channel: "Voice", type: "Verification", template: "Otp", identity: "", language: "ja",
  payload: { to: "+819012345678", otp: "482913" },
});

// Free text (at most 1,000 characters), through a specific phone provider.
await catzconnect.send({
  channel: "Voice", type: "Notification", template: "Custom", identity: "",
  payload: { to: "+919876543210", body: "Your table is ready.", provider: "Exotel India" },
});

// A Voice template from the panel, filled from data.
await catzconnect.send({
  channel: "Voice", type: "Transactional", template: "Appointment reminder", identity: "",
  payload: { to: "+447700900123", data: { time: "10:30", language: "en-GB" } },
});
```

Checked before sending: E.164 `to`; `Otp` needs `otp` (up to 15 letters or
digits); `Custom` needs `body` (1–1,000 characters, no control characters);
`data.language` is a tag like `en-US`; `data.voice` is `female`, `male` or a
provider voice name; `data.repeat` is `"1"`–`"3"`; `provider` (id or label)
must be one of the key's call providers.

## Voice & Video calls

Calls between your app's users. Your **backend** creates the call and
issues a short-lived **user token**; the **browser** connects with the
token and joins. Engine `catz` is peer-to-peer WebRTC through our own
STUN/TURN relay; a provider engine (Agora, Twilio Video, LiveKit, …) hands
the browser that provider's join data instead. Calls need a paid plan;
minutes count toward the plan's monthly cap.

### On your backend

```ts
import { catzconnect, CatzApiError } from "catzconnect";

// 1. Create the call (rings the callees over WebSocket and push).
const call = await catzconnect.calls.create({
  mode: "video",            // or "audio"
  from: "alice",            // your user ids, ≤ 128 characters
  to: ["bob"],              // 1–49, unique, not including `from`
  // engine: "auto" | "catz" | "<provider id or label>",
  // ring: true, metadata: { orderId: "A-1042" } (≤ 4 KB), maxParticipants: 4,
});

// 2. A token for each user's browser (60–86400 s, default 3600).
//    Never send your API key to the browser — only this token.
const { token, expires_at, ws_url } = await catzconnect.calls.token("alice", 3600);

// Later: read or end it.
const detail = await catzconnect.calls.get(call.id);  // participants, duration_secs, billed_minutes, end_reason
await catzconnect.calls.end(call.id, "support_closed");
```

Refusals throw `CatzApiError` with `status`, the server's `message` and a
`code`: `plan_required`, `minutes_cap_reached`, `engine_unavailable`,
`too_many_participants`, `provider_not_allowed`.

```ts
try { await catzconnect.calls.create({ mode: "audio", from: "a", to: ["b"] }); }
catch (e) { if (e instanceof CatzApiError && e.code === "minutes_cap_reached") { /* upsell */ } }
```

### In the browser — `catzconnect/call`

Browser built-ins only (RTCPeerConnection, WebSocket, MediaDevices); no
Node APIs, no dependencies.

```ts
import { CatzCallClient } from "catzconnect/call";

const client = new CatzCallClient({
  // Called at connect, before the token expires and after a refusal:
  getToken: () => fetch("/api/call-token").then((r) => r.json()).then((j) => j.token),
  url: wsUrlFromYourBackend,          // default wss://api.catzconnect.com/rtc/v1/ws
});

client.on("incoming", ({ callId, from, mode }) => showRinging(callId, from, mode));
client.on("local-stream", ({ stream }) => (selfView.srcObject = stream));
client.on("track", ({ pid, stream }) => (videoFor(pid).srcObject = stream));
client.on("peer-left", ({ pid }) => removeVideo(pid));
client.on("connection", ({ pid, type }) => badge(pid, type));       // "direct" | "relay"
client.on("quality", (q) => meter(q.pid, q.level, q.rttMs, q.lossPct));
client.on("reconnecting", ({ scope }) => banner(`Reconnecting (${scope})…`));
client.on("reconnected", () => banner(null));
client.on("state", ({ callId, status }) => status === "ended" && hangUpUi(callId));
client.on("error", ({ code, message }) => console.warn(code, message));

await client.connect();

// Caller (after your backend created the call):
await client.join(call.id, { audio: true, video: true });
// Callee, from "incoming":
await client.accept(callId);          // or client.decline(callId)

client.setMuted("audio", true);       // mic off (no renegotiation)
client.setMuted("video", true);       // camera off
await client.switchCamera();          // next camera / front ↔ back
await client.shareScreen();           // replaces the camera track; stopShare() restores it
client.cancel();                      // caller hangs up while it still rings
client.leave();                       // leave the call, release camera and mic
client.close();                       // done with the client
```

**Methods:** `connect()`, `join(callId, { audio?, video?, stream? })`,
`accept(callId, opts?)`, `decline(callId)`, `cancel(callId?)`, `leave()`,
`setMuted("audio" | "video", muted)`, `isMuted(kind)`, `switchCamera()`,
`shareScreen()`, `stopShare()`, `collectStats()`, `close()`; `on(event, fn)`
(returns an unsubscribe function), `once`, `off`. Read-only: `connected`,
`callId`, `pid`, `localMediaStream`, `peers`, `remoteStream(pid)`.

**Events:** `incoming`, `state`, `peer-joined`, `peer-left`, `track`
(one `MediaStream` per peer), `local-stream`, `connection`, `quality`
(every 10 s), `reconnecting`, `reconnected` (`scope: "signaling" | "peer"`),
`provider`, `error`, `closed`.

**Staying connected.** ICE tries direct paths first and falls back to our
relay (UDP, then TCP, then TLS — `turns:` on 5349) inside the same call;
the client reports which one is in use (`connection`). A path that stays
`disconnected` for over 2 s, or `failed`, gets an ICE restart (with
backoff) from the side that offered, keeping the tracks; so does a network
change (`online`, `navigator.connection` change). A dropped WebSocket
reconnects with exponential backoff and jitter, renews the token through
`getToken`, sends `resume` within the server's 30 s grace (or joins again
after it) and flushes signals queued meanwhile. TURN credentials are
refreshed in place (`ice_refresh`).

#### React

```tsx
import { useEffect, useRef, useState } from "react";
import { CatzCallClient } from "catzconnect/call";

function Video({ stream, muted }: { stream: MediaStream; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} />;
}

export function Call({ callId }: { callId: string }) {
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<Record<string, MediaStream>>({});
  const [link, setLink] = useState<string>("");

  useEffect(() => {
    const client = new CatzCallClient({ getToken: () => fetch("/api/call-token").then((r) => r.text()) });
    client.on("local-stream", ({ stream }) => setLocal(stream));
    client.on("track", ({ pid, stream }) => setRemote((r) => ({ ...r, [pid]: stream })));
    client.on("peer-left", ({ pid }) => setRemote(({ [pid]: _, ...r }) => r));
    client.on("connection", ({ type }) => setLink(type));
    client.on("provider", ({ provider }) => startProviderSdk(provider)); // see below
    client.connect().then(() => client.join(callId, { audio: true, video: true }));
    return () => client.close();
  }, [callId]);

  return (
    <div>
      {local && <Video stream={local} muted />}
      {Object.entries(remote).map(([pid, s]) => <Video key={pid} stream={s} />)}
      <small>{link}</small>
    </div>
  );
}
```

**Provider hand-off.** When the call's engine is a provider, `join` resolves
with `provider` and the client emits `provider` with
`{ name, room, token, app_id?, url?, extra? }`. It opens no peer
connections and no camera: join with that provider's own browser SDK
(e.g. Agora `client.join(app_id, room, token)`, LiveKit
`room.connect(url, token)`), and call `client.leave()` when done so
CatzConnect records the end.

For tests, `new CatzCallClient({ token, platform: { WebSocket, RTCPeerConnection, MediaStream, mediaDevices, setTimeout, … } })`
swaps the browser built-ins (see `test/fakes.mjs`).
