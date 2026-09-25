import { SendInput } from "../types";
import { validateEmail, validatePhone } from "../utils/validators";

export function verifyPayload(input: SendInput) {
  const { type, channel, template, identity, payload } = input;

  if (channel === "Email" && type === "Verification" && template === "Otp") {
    if (!identity) {
      throw new Error("Missing 'identity'");
    }

    if (!payload.to) {
      throw new Error("Missing 'to' in payload");
    }

    if (payload.otp === undefined || payload.otp === null) {
      throw new Error("Missing 'otp' in payload");
    }

    if (typeof payload.to !== "string") {
      throw new Error("'to' must be a string");
    }

    validateEmail(payload.to);

    if (typeof payload.otp !== "string") {
      throw new Error("'otp' must be a string");
    }

    if (!/^\d+$/.test(payload.otp)) {
      throw new Error("'otp' must contain only digits");
    }

    if (payload.otp.length !== 6) {
      throw new Error("'otp' must be exactly 6 digits");
    }

    return;
  }

  if (
    channel === "Email" &&
    type === "Transactional" &&
    template === "Custom"
  ) {
    if (!identity) {
      throw new Error("Missing 'identity'");
    }

    if (!payload.to) {
      throw new Error("Missing 'to' in payload");
    }

    if (payload.subject === undefined || payload.subject === null) {
      throw new Error("Missing 'subject' in payload");
    }

    if (payload.body === undefined || payload.body === null) {
      throw new Error("Missing 'body' in payload");
    }

    if (typeof payload.to !== "string") {
      throw new Error("'to' must be a string");
    }

    validateEmail(payload.to);

    return;
  }

  if (channel === "WhatsApp" && type === "Verification" && template === "Otp") {
    if (!identity) {
      throw new Error("Missing 'identity'");
    }

    if (!payload.to) {
      throw new Error("Missing 'to' in payload");
    }

    if (typeof payload.to !== "string") {
      throw new Error("'to' must be a string");
    }

    validatePhone(payload.to);

    if (payload.otp === undefined || payload.otp === null) {
      throw new Error("Missing 'otp' in payload");
    }

    if (typeof payload.otp !== "string") {
      throw new Error("'otp' must be a string");
    }

    // Meta's authentication templates take up to 15 letters or digits.
    if (!/^[A-Za-z0-9]{1,15}$/.test(payload.otp)) {
      throw new Error("'otp' must be up to 15 letters or digits");
    }

    return;
  }

  if (
    channel === "WhatsApp" &&
    type === "Transactional" &&
    template === "Custom"
  ) {
    if (!identity) {
      throw new Error("Missing 'identity'");
    }

    if (!payload.to) {
      throw new Error("Missing 'to' in payload");
    }

    if (typeof payload.to !== "string") {
      throw new Error("'to' must be a string");
    }

    validatePhone(payload.to);

    if (payload.body === undefined || payload.body === null || payload.body === "") {
      throw new Error("Missing 'body' in payload");
    }

    // Subject is optional for WhatsApp; the server sends it as a bold line.
    const length = (payload.subject ? payload.subject.length + 6 : 0) + payload.body.length;
    if (length > 4096) {
      throw new Error("WhatsApp messages are limited to 4096 characters");
    }

    return;
  }

  if (channel === "Push" && type === "Notification" && template === "Notification") {
    if (!identity) {
      throw new Error("Missing 'identity' — the Firebase project ID");
    }

    if (!payload.to || typeof payload.to !== "string") {
      throw new Error("Missing 'to' in payload — the device's FCM registration token");
    }

    if (payload.to.includes("@")) {
      throw new Error("'to' must be an FCM registration token, not an email address");
    }

    if (!payload.body || typeof payload.body !== "string") {
      throw new Error("Missing 'body' in payload");
    }

    for (const field of ["image", "link"] as const) {
      const value = payload[field];
      if (value !== undefined && (typeof value !== "string" || !value.startsWith("https://"))) {
        throw new Error(`'${field}' must be an https:// URL`);
      }
    }

    if (payload.data !== undefined) {
      for (const [k, v] of Object.entries(payload.data)) {
        if (typeof v !== "string") {
          throw new Error(`'data.${k}' must be a string — FCM only carries string values`);
        }
      }
    }

    if (payload.device_key !== undefined && typeof payload.device_key !== "string") {
      throw new Error("'device_key' must be the base64 public key from generateDeviceKeys()");
    }

    return;
  }

  throw new Error(`Unsupported combination: ${type}.${channel}.${template}`);
}
