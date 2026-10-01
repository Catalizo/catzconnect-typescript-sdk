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

## 📬 Supported Operation

### Email Verification OTP

```ts
{
  type: "Verification",
  channel: "Email",
  template: "Otp",
  identity: "user@domain.com",
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
