export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_REQUIREMENTS = `Use ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`;

export function getPasswordValidationError(password: string): string | null {
  const length = password.length;

  if (length < PASSWORD_MIN_LENGTH) {
    const missing = PASSWORD_MIN_LENGTH - length;
    return `Password is too short: ${length} of ${PASSWORD_MIN_LENGTH} characters. Add at least ${missing} more.`;
  }

  if (length > PASSWORD_MAX_LENGTH) {
    const extra = length - PASSWORD_MAX_LENGTH;
    return `Password is too long: ${length} characters. Remove at least ${extra}.`;
  }

  return null;
}

export function getFriendlyPasswordError(message: string | undefined, password: string): string {
  const validationError = getPasswordValidationError(password);
  if (validationError) return validationError;

  const normalizedMessage = message?.toLowerCase() ?? '';
  if (
    normalizedMessage.includes('password does not meet security') ||
    normalizedMessage.includes('weak password') ||
    normalizedMessage.includes('password too short') ||
    normalizedMessage.includes('password too long')
  ) {
    return `The password was rejected. ${PASSWORD_REQUIREMENTS}`;
  }

  return message || 'Unable to save the password.';
}
