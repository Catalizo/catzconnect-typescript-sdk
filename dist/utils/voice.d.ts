/**
 * Phone calls (text-to-speech) through `send()` with `channel: "Voice"`.
 * These mirror the server's checks so a refused request fails before it is
 * encrypted and sent.
 */
import { SendInput } from "../types";
/** Longest Custom text a phone call speaks. */
export declare const VOICE_MAX_CHARS = 1000;
export declare const VOICE_MAX_REPEAT = 3;
/** A BCP-47 style language tag such as `en-US`, `hi-IN`, `es-419` or `fr`. */
export declare function isValidVoiceLanguage(s: string): boolean;
/** `female`, `male`, or a provider voice name such as `Polly.Joanna` or `en-US-Wavenet-F`. */
export declare function isValidVoiceName(s: string): boolean;
/** Throws the server's error when a Custom text would be refused (empty, control characters, over 1,000 characters). */
export declare function validateVoiceText(text: string): string;
/** `repeat` as the server reads it from `data`: a whole number 1–3. */
export declare function parseVoiceRepeat(v: unknown): number;
/** True for "Voice" in any casing. */
export declare function isVoiceChannel(channel: unknown): boolean;
/**
 * The server's checks for `channel: "Voice"`: an E.164 `to`; template `Otp`
 * with `otp` (up to 15 letters or digits, read out one by one), `Custom` with
 * `body` (≤ 1,000 characters), or the name of a Voice template from the
 * panel filled from `data`. `data.language` (e.g. `en-US`), `data.voice`
 * (`female`, `male` or a provider voice) and `data.repeat` (1–3) are
 * optional. `identity` is ignored.
 */
export declare function verifyVoice(input: SendInput): void;
/** The JSON body (before encryption) for a Voice send: only the fields the server reads. */
export declare function buildVoicePayload(input: SendInput): Record<string, unknown>;
