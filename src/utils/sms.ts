/**
 * SMS helpers that mirror the server's checks for `channel: "SMS"`, so a
 * request the server would refuse fails before it is encrypted and sent.
 */

/** Longest body the server accepts, in segments (~1,530 GSM-7 / ~670 UCS-2 characters). */
export const SMS_MAX_SEGMENTS = 10;

export type SmsEncoding = "gsm7" | "ucs2";

export interface SmsAnalysis {
  encoding: SmsEncoding;
  /** Septets (GSM-7) or UTF-16 code units (UCS-2). */
  units: number;
  /** Billable parts. */
  segments: number;
  /** Characters as a person would count them. */
  chars: number;
}

/**
 * Normalises a phone number to E.164 the way the server does: spaces,
 * dashes, dots and brackets are removed; the result must be `+` and 8–15
 * digits, not starting with 0. Returns `null` when it is not E.164.
 */
export function normaliseE164(raw: string): string | null {
  const cleaned = raw.trim().replace(/[ \-.()]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(cleaned) ? cleaned : null;
}

/** Throws unless `phone` is an E.164 number (after removing formatting). */
export function validateE164(phone: string): string {
  const n = normaliseE164(phone);
  if (n === null) {
    throw new Error(
      `'${phone.trim()}' is not an E.164 phone number — use + and the country code, e.g. +919876543210`,
    );
  }
  return n;
}

/** A sender override: an E.164 number, or a 2–11 character alphanumeric sender ID. */
export function isValidSmsSender(s: string): boolean {
  if (s.startsWith("+")) {
    return normaliseE164(s) === s;
  }
  return /^[A-Za-z0-9 ]{2,11}$/.test(s) && /[A-Za-z]/.test(s) && !s.startsWith(" ") && !s.endsWith(" ");
}

/** An India DLT template id: 6–30 digits. */
export function isValidDltId(s: string): boolean {
  return /^\d{6,30}$/.test(s);
}

// GSM 03.38 default alphabet (ESC excluded) and extension table (ESC + char).
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENSION = "^{}\\[~]|€\f";

function gsmCost(c: string): number | null {
  if (GSM_BASIC.includes(c)) return 1;
  if (GSM_EXTENSION.includes(c)) return 2;
  return null;
}

function countSegments(costs: number[], total: number, single: number, multi: number): number {
  if (total <= single) return 1;
  let parts = 1;
  let used = 0;
  for (const c of costs) {
    if (used + c > multi) {
      parts += 1;
      used = 0;
    }
    used += c;
  }
  return parts;
}

/**
 * How the server will encode `text` and how many segments it takes: GSM-7
 * when every character is in the GSM alphabet (extension characters cost
 * two), otherwise UCS-2. 160/153 septets or 70/67 code units per part.
 */
export function analyseSms(text: string): SmsAnalysis {
  const chars = Array.from(text);
  const gsm = chars.map(gsmCost);
  if (gsm.every((c) => c !== null)) {
    const costs = gsm as number[];
    const units = costs.reduce((a, b) => a + b, 0);
    return { encoding: "gsm7", units, segments: countSegments(costs, units, 160, 153), chars: chars.length };
  }
  const costs = chars.map((c) => c.length); // UTF-16 code units: 2 for astral characters
  const units = costs.reduce((a, b) => a + b, 0);
  return { encoding: "ucs2", units, segments: countSegments(costs, units, 70, 67), chars: chars.length };
}

/** Throws the server's error when `body` would be refused (empty, control characters, too long). */
export function validateSmsBody(body: string): SmsAnalysis {
  if (body.trim() === "") {
    throw new Error("The message is empty");
  }
  // Unicode Cc other than tab, newline and carriage return.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(body)) {
    throw new Error("The message contains control characters");
  }
  const a = analyseSms(body);
  if (a.segments > SMS_MAX_SEGMENTS) {
    throw new Error(
      `The message is ${a.segments} segments long; the limit is ${SMS_MAX_SEGMENTS} (${
        a.encoding === "gsm7" ? 1530 : 670
      } characters in ${a.encoding.toUpperCase()})`,
    );
  }
  return a;
}
