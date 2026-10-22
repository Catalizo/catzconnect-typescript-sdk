export declare function validateEmail(email: string): void;
/**
 * A phone number as WhatsApp needs it: digits, optionally written with `+`,
 * spaces, dashes or brackets. The server normalises it and applies the
 * number's default country code to national numbers, so this only rejects
 * what can never work — an email address, or a digit count no real number has.
 */
export declare function validatePhone(phone: string): void;
