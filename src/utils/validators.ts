const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string) {
  if (!EMAIL_REGEX.test(email)) {
    throw new Error(`Invalid email: ${email}`);
  }
}
