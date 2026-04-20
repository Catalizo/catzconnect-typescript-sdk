import { SendInput } from "../types";
import { validateEmail } from "../utils/validators";

export function verifyPayload(input: SendInput) {
  const { type, channel, template, payload } = input;

  if (channel === "Email" && type === "Verification" && template === "Otp") {
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

  throw new Error(`Unsupported combination: ${type}.${channel}.${template}`);
}
