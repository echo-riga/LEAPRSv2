import { Resend } from 'resend';

const resendApiKey = process.env.RESEND_API_KEY || process.env.RESEND;

export async function sendPasswordResetEmail(toEmail: string, resetCode: string) {
  if (!resendApiKey) {
    throw new Error('Resend API key is not configured in environment variables');
  }

  const client = new Resend(resendApiKey);
  const fromEmail = process.env.RESEND_FROM || 'LEAPRS <onboarding@resend.dev>';

  const plainTextContent = `Hello,

We received a request to reset your password for your LEAPRS account.

Your verification code is: ${resetCode}

This code will expire in 15 minutes. If you did not request this password reset, you can safely ignore this email.

LEAPRS Portal`;

  const { data, error } = await client.emails.send({
    from: fromEmail,
    to: [toEmail],
    subject: 'LEAPRS Password Reset Code',
    text: plainTextContent,
  });

  if (error) {
    console.error('Failed to send email via Resend:', error);
    throw new Error(error.message || 'Failed to send password reset email');
  }

  return data;
}

export async function sendSignupVerificationEmail(toEmail: string, verificationCode: string) {
  if (!resendApiKey) {
    throw new Error('Resend API key is not configured in environment variables');
  }

  const client = new Resend(resendApiKey);
  const fromEmail = process.env.RESEND_FROM || 'LEAPRS <onboarding@resend.dev>';

  const plainTextContent = `Hello,

Thank you for registering for the LEAPRS Portal.

Your email verification code is: ${verificationCode}

This code will expire in 15 minutes. Please enter this code on the registration page to verify your email address and complete account creation.

If you did not request this registration, you can safely ignore this email.

LEAPRS Portal`;

  const { data, error } = await client.emails.send({
    from: fromEmail,
    to: [toEmail],
    subject: 'LEAPRS Email Verification Code',
    text: plainTextContent,
  });

  if (error) {
    console.error('Failed to send verification email via Resend:', error);
    throw new Error(error.message || 'Failed to send verification email');
  }

  return data;
}
