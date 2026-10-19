/** The languages the built-in (default) Otp/Verification templates come in. */
export const SUPPORTED_LANGUAGES = ["en", "de", "ja", "ar", "hi"] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Normalises a `language` for `send()`: `"de"`, `"DE"`, `"de-DE"` and
 * `"de_DE"` all become `"de"` (the BCP-47 primary subtag). Throws when the
 * value is not a string or the language is not one of en, de, ja, ar, hi.
 */
export function normaliseLanguage(value: unknown): Language {
  if (typeof value !== "string") {
    throw new Error("'language' must be a string: one of en, de, ja, ar, hi (or a BCP-47 tag such as de-DE)");
  }
  const tag = value.trim();
  const primary = tag.split(/[-_]/)[0].toLowerCase();
  if (!/^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/.test(tag) || !(SUPPORTED_LANGUAGES as readonly string[]).includes(primary)) {
    throw new Error(
      `Unsupported 'language' "${value}": use one of en, de, ja, ar, hi (or a BCP-47 tag such as de-DE)`,
    );
  }
  return primary as Language;
}

/** `true` when {@link normaliseLanguage} accepts the value. */
export function isValidLanguage(value: unknown): boolean {
  try {
    normaliseLanguage(value);
    return true;
  } catch {
    return false;
  }
}
