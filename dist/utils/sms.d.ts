/**
 * SMS helpers that mirror the server's checks for `channel: "SMS"`, so a
 * request the server would refuse fails before it is encrypted and sent.
 */
/** Longest body the server accepts, in segments (~1,530 GSM-7 / ~670 UCS-2 characters). */
export declare const SMS_MAX_SEGMENTS = 10;
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
export declare function normaliseE164(raw: string): string | null;
/** Throws unless `phone` is an E.164 number (after removing formatting). */
export declare function validateE164(phone: string): string;
/** A sender override: an E.164 number, or a 2–11 character alphanumeric sender ID. */
export declare function isValidSmsSender(s: string): boolean;
/** An India DLT template id: 6–30 digits. */
export declare function isValidDltId(s: string): boolean;
/**
 * How the server will encode `text` and how many segments it takes: GSM-7
 * when every character is in the GSM alphabet (extension characters cost
 * two), otherwise UCS-2. 160/153 septets or 70/67 code units per part.
 */
export declare function analyseSms(text: string): SmsAnalysis;
/** Throws the server's error when `body` would be refused (empty, control characters, too long). */
export declare function validateSmsBody(body: string): SmsAnalysis;
