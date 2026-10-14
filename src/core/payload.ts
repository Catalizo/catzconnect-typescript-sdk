import { SendInput } from "../types";
import { validateEmail, validatePhone } from "../utils/validators";
import { isValidDltId, isValidSmsSender, validateE164, validateSmsBody } from "../utils/sms";

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

    const hasTo = payload.to !== undefined && payload.to !== null && payload.to !== "";
    const hasUser =
      payload.external_user_id !== undefined && payload.external_user_id !== null && payload.external_user_id !== "";

    if (hasTo && hasUser) {
      throw new Error("Give either 'to' (one device token) or 'external_user_id' (a user's registered devices), not both");
    }

    if (!hasTo && !hasUser) {
      throw new Error(
        "Missing 'to' in payload — the device's FCM registration token — or 'external_user_id' for a user's registered devices",
      );
    }

    if (hasTo) {
      if (typeof payload.to !== "string") {
        throw new Error("'to' must be a string");
      }
      if (payload.to.includes("@")) {
        throw new Error("'to' must be an FCM registration token, not an email address");
      }
    }

    if (hasUser) {
      if (typeof payload.external_user_id !== "string" || payload.external_user_id.length > 128) {
        throw new Error("'external_user_id' must be a string of up to 128 characters");
      }
      if (payload.device_key !== undefined) {
        throw new Error("'device_key' cannot be used with 'external_user_id' — each registered device's own key is used");
      }
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

  if (channel === "SMS") {
    verifySms(input);
    return;
  }

  // An email template created in the panel, sent by name. Anything that is
  // not a built-in name; the server fills its {{variables}} from data.
  if (channel === "Email" && !["Otp", "Custom", "Notification"].includes(template)) {
    if (!identity) {
      throw new Error("Missing 'identity'");
    }

    if (!payload.to || typeof payload.to !== "string") {
      throw new Error("Missing 'to' in payload");
    }

    validateEmail(payload.to);

    if (payload.data !== undefined) {
      for (const [k, v] of Object.entries(payload.data)) {
        if (typeof v !== "string") {
          throw new Error(`'data.${k}' must be a string`);
        }
      }
    }

    return;
  }

  throw new Error(`Unsupported combination: ${type}.${channel}.${template}`);
}

const SMS_TYPES = ["Verification", "Transactional", "Promotional"];

/**
 * SMS, as the server checks it: `Otp` with `Verification` and `otp`;
 * `Custom` with `Transactional`/`Promotional` and `body`; any other name is
 * an SMS template from the panel filled from `data`. Template names are
 * matched case-insensitively, as on the server. `identity` is ignored.
 */
function verifySms(input: SendInput) {
  const { type, template, payload } = input;

  if (typeof payload.to !== "string" || payload.to.trim() === "") {
    throw new Error("Missing 'to' in payload — the recipient's number in E.164, e.g. +919876543210");
  }
  const to = validateE164(payload.to);

  if (!SMS_TYPES.includes(type)) {
    throw new Error(`SMS supports type Verification (template Otp), Transactional or Promotional — not ${type}`);
  }

  const gateway = optionalString(payload.gateway, "gateway");
  const sender = optionalString(payload.sender, "sender");
  if (sender !== undefined) {
    if (gateway === undefined) {
      throw new Error("'sender' can only be used together with 'gateway'");
    }
    if (!isValidSmsSender(sender)) {
      throw new Error("'sender' must be an E.164 number or a 2–11 character sender ID");
    }
  }

  const dlt = optionalString(payload.dlt_template_id, "dlt_template_id");
  if (dlt !== undefined && !isValidDltId(dlt)) {
    throw new Error("'dlt_template_id' must be the numeric DLT template ID");
  }

  if (payload.data !== undefined) {
    if (payload.data === null || typeof payload.data !== "object") {
      throw new Error("'data' must be an object of strings");
    }
    for (const [k, v] of Object.entries(payload.data)) {
      if (typeof v !== "string") {
        throw new Error(`'data.${k}' must be a string`);
      }
    }
  }

  const name = typeof template === "string" ? template.trim() : "";
  if (name === "") {
    throw new Error("Missing 'template' — Otp, Custom, or the name of an SMS template");
  }

  if (name.toLowerCase() === "otp") {
    if (type !== "Verification") {
      throw new Error("template Otp goes with type Verification");
    }
    if (typeof payload.otp !== "string" || payload.otp.trim() === "") {
      throw new Error("Missing 'otp' in payload");
    }
    if (!/^[A-Za-z0-9]{1,15}$/.test(payload.otp.trim())) {
      throw new Error("'otp' must be up to 15 letters or digits");
    }
    return;
  }

  if (name.toLowerCase() === "custom") {
    if (type === "Verification") {
      throw new Error("type Verification goes with template Otp; use Transactional for Custom");
    }
    if (typeof payload.body !== "string" || payload.body.trim() === "") {
      throw new Error("Missing 'body' in payload");
    }
    validateSmsBody(payload.body.trim());
    // India needs a DLT template id; a Custom body can only get it from the payload.
    if (to.startsWith("+91") && dlt === undefined) {
      throw new Error("India (+91) requires a DLT template ID: pass 'dlt_template_id' for Custom messages");
    }
    return;
  }

  // A panel SMS template: the server renders it from data and checks its length.
}

function optionalString(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") {
    throw new Error(`'${field}' must be a string`);
  }
  const t = v.trim();
  return t === "" ? undefined : t;
}
