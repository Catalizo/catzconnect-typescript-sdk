/**
 * Phone calls (text-to-speech) through `send()` with `channel: "Voice"`.
 * These mirror the server's checks so a refused request fails before it is
 * encrypted and sent.
 */
import { SendInput } from "../types";
import { validateE164 } from "./sms";

/** Longest Custom text a phone call speaks. */
export const VOICE_MAX_CHARS = 1000;
export const VOICE_MAX_REPEAT = 3;

const VOICE_TYPES = ["Verification", "Transactional", "Notification", "Promotional"];

/** A BCP-47 style language tag such as `en-US`, `hi-IN`, `es-419` or `fr`. */
export function isValidVoiceLanguage(s: string): boolean {
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(s);
}

/** `female`, `male`, or a provider voice name such as `Polly.Joanna` or `en-US-Wavenet-F`. */
export function isValidVoiceName(s: string): boolean {
  return /^[A-Za-z0-9._:\- ]{1,64}$/.test(s) && s.trim() === s;
}

/** Throws the server's error when a Custom text would be refused (empty, control characters, over 1,000 characters). */
export function validateVoiceText(text: string): string {
  const t = text.trim();
  if (t === "") {
    throw new Error("The text to speak is empty");
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(t)) {
    throw new Error("The text to speak contains control characters");
  }
  const n = Array.from(t).length;
  if (n > VOICE_MAX_CHARS) {
    throw new Error(`The text to speak is ${n} characters; the limit is ${VOICE_MAX_CHARS}`);
  }
  return t;
}

/** `repeat` as the server reads it from `data`: a whole number 1–3. */
export function parseVoiceRepeat(v: unknown): number {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!/^\d+$/.test(s)) {
    throw new Error("'data.repeat' must be a whole number from 1 to 3");
  }
  const n = Number(s);
  if (n < 1 || n > VOICE_MAX_REPEAT) {
    throw new Error("'data.repeat' must be a whole number from 1 to 3");
  }
  return n;
}

/** True for "Voice" in any casing. */
export function isVoiceChannel(channel: unknown): boolean {
  return typeof channel === "string" && channel.trim().toLowerCase() === "voice";
}

/**
 * The server's checks for `channel: "Voice"`: an E.164 `to`; template `Otp`
 * with `otp` (up to 15 letters or digits, read out one by one), `Custom` with
 * `body` (≤ 1,000 characters), or the name of a Voice template from the
 * panel filled from `data`. `data.language` (e.g. `en-US`), `data.voice`
 * (`female`, `male` or a provider voice) and `data.repeat` (1–3) are
 * optional. `identity` is ignored.
 */
export function verifyVoice(input: SendInput): void {
  const { type, template, payload } = input;
  if (!payload || typeof payload !== "object") {
    throw new Error("Missing 'payload'");
  }

  if (typeof payload.to !== "string" || payload.to.trim() === "") {
    throw new Error("Missing 'to' in payload — the number to call in E.164, e.g. +14155550100");
  }
  validateE164(payload.to);

  if (!VOICE_TYPES.includes(type)) {
    throw new Error(`Voice supports type Verification, Transactional, Notification or Promotional — not ${type}`);
  }

  if (payload.provider !== undefined && payload.provider !== null) {
    if (typeof payload.provider !== "string" || payload.provider.trim() === "") {
      throw new Error("'provider' must be a phone provider's id or label");
    }
  }

  if (payload.data !== undefined && payload.data !== null) {
    if (typeof payload.data !== "object" || Array.isArray(payload.data)) {
      throw new Error("'data' must be an object of strings");
    }
    for (const [k, v] of Object.entries(payload.data)) {
      if (k === "repeat") {
        parseVoiceRepeat(v);
        continue;
      }
      if (typeof v !== "string") {
        throw new Error(`'data.${k}' must be a string`);
      }
      if (k === "language" && !isValidVoiceLanguage(v)) {
        throw new Error("'data.language' must be a language tag such as en-US");
      }
      if (k === "voice" && !isValidVoiceName(v)) {
        throw new Error("'data.voice' must be female, male or a provider voice name");
      }
    }
  }

  const name = typeof template === "string" ? template.trim() : "";
  if (name === "") {
    throw new Error("Missing 'template' — Otp, Custom, or the name of a Voice template");
  }

  if (name.toLowerCase() === "otp") {
    if (typeof payload.otp !== "string" || payload.otp.trim() === "") {
      throw new Error("Missing 'otp' in payload");
    }
    if (!/^[A-Za-z0-9]{1,15}$/.test(payload.otp.trim())) {
      throw new Error("'otp' must be up to 15 letters or digits");
    }
    return;
  }

  if (name.toLowerCase() === "custom") {
    if (typeof payload.body !== "string" || payload.body.trim() === "") {
      throw new Error("Missing 'body' in payload — the text to speak");
    }
    validateVoiceText(payload.body);
  }
  // A panel Voice template: the server renders it from data.
}

/** The JSON body (before encryption) for a Voice send: only the fields the server reads. */
export function buildVoicePayload(input: SendInput): Record<string, unknown> {
  const p = input.payload;
  const name = input.template.trim();
  const lower = name.toLowerCase();
  const out: Record<string, unknown> = {
    message_type: input.type,
    channel: "Voice",
    template: lower === "otp" ? "Otp" : lower === "custom" ? "Custom" : name,
    identity: input.identity ?? "", // required by the server, ignored for Voice
    to: validateE164(p.to as string),
  };
  if (typeof p.otp === "string" && p.otp.trim() !== "") out.otp = p.otp.trim();
  if (typeof p.body === "string" && p.body.trim() !== "") out.body = p.body.trim();
  if (typeof p.provider === "string" && p.provider.trim() !== "") out.provider = p.provider.trim();
  if (p.data && Object.keys(p.data).length > 0) {
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.data)) {
      // The server's data is a map of strings; repeat travels as "1".."3".
      data[k] = k === "repeat" ? String(parseVoiceRepeat(v)) : String(v);
    }
    out.data = data;
  }
  return out;
}
