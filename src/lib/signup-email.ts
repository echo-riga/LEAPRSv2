export const SIGNUP_EMAIL_ERROR = 'Use your @plpasig.edu.ph email address to sign up.';

export function isAllowedSignupEmail(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length <= 255
    && /^[^\s@]+@plpasig\.edu\.ph$/i.test(value.trim());
}
