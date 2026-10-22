/** The languages the built-in (default) Otp/Verification templates come in. */
export declare const SUPPORTED_LANGUAGES: readonly ["en", "de", "ja", "ar", "hi"];
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
/**
 * Normalises a `language` for `send()`: `"de"`, `"DE"`, `"de-DE"` and
 * `"de_DE"` all become `"de"` (the BCP-47 primary subtag). Throws when the
 * value is not a string or the language is not one of en, de, ja, ar, hi.
 */
export declare function normaliseLanguage(value: unknown): Language;
/** `true` when {@link normaliseLanguage} accepts the value. */
export declare function isValidLanguage(value: unknown): boolean;
