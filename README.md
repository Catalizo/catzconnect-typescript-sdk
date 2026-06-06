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