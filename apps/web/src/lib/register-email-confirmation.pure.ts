export function signupNeedsEmailConfirmation(input: {
  registerSucceeded: boolean;
  session: unknown | null | undefined;
}): boolean {
  return input.registerSucceeded === true && input.session == null;
}

export function confirmationEmailAddress(registeredEmail: string, returnedEmail?: string | null): string {
  const returned = String(returnedEmail ?? '').trim();
  if (returned) return returned;
  return String(registeredEmail ?? '').trim();
}

export function fillRegisteredEmail(template: string, email: string): string {
  return String(template ?? '').replaceAll('{email}', email);
}

export function isEmailNotConfirmedCode(code: string | null | undefined): boolean {
  return String(code ?? '').trim().toUpperCase() === 'EMAIL_NOT_CONFIRMED';
}
