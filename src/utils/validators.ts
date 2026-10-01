const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string) {
  if (!EMAIL_REGEX.test(email)) {
    throw new Error(`Invalid email: ${email}`);
  }
}

/**
 * A phone number as WhatsApp needs it: digits, optionally written with `+`,
 * spaces, dashes or brackets. The server normalises it and applies the
 * number's default country code to national numbers, so this only rejects
 * what can never work — an email address, or a digit count no real number has.
 */
export function validatePhone(phone: string) {
  if (phone.includes("@")) {
    throw new Error(`WhatsApp messages go to phone numbers, not email addresses: ${phone}`);
  }
  if (!/^[\d\s()+\-]+$/.test(phone)) {
    throw new Error(`Invalid phone number: ${phone}`);
  }
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    throw new Error(`Invalid phone number: ${phone}`);
  }
}
