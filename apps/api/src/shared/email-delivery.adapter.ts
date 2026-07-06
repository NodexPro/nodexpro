import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import type { OwnerEmailProviderConfigResolved } from './owner-email-provider-config.service.js';

export type EmailAttachmentInput = {
  filename: string;
  content_type?: string | null;
  content_base64?: string | null;
};

export type EmailSendInput = {
  to: string;
  reply_to?: string | null;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachmentInput[];
};

export interface EmailDeliveryAdapter {
  sendEmail(input: EmailSendInput): Promise<{ providerMessageId: string | null }>;
}

function attachmentContentBuffer(attachment: EmailAttachmentInput): Buffer {
  const raw = String(attachment.content_base64 ?? '').trim();
  if (!raw) throw new Error('email_attachment_content_missing');
  return Buffer.from(raw, 'base64');
}

function resendAttachments(input: EmailSendInput): Array<{ filename: string; content: Buffer }> | undefined {
  if (!input.attachments?.length) return undefined;
  return input.attachments.map((attachment) => ({
    filename: attachment.filename,
    content: attachmentContentBuffer(attachment),
  }));
}

function smtpAttachments(input: EmailSendInput): Array<{ filename: string; content: Buffer; contentType?: string }> | undefined {
  if (!input.attachments?.length) return undefined;
  return input.attachments.map((attachment) => ({
    filename: attachment.filename,
    content: attachmentContentBuffer(attachment),
    contentType: attachment.content_type ?? undefined,
  }));
}

function sendGridAttachments(input: EmailSendInput):
  | Array<{ content: string; filename: string; type?: string; disposition: 'attachment' }>
  | undefined {
  if (!input.attachments?.length) return undefined;
  return input.attachments.map((attachment) => ({
    content: String(attachment.content_base64 ?? ''),
    filename: attachment.filename,
    type: attachment.content_type ?? undefined,
    disposition: 'attachment' as const,
  }));
}

class ResendAdapter implements EmailDeliveryAdapter {
  constructor(private readonly cfg: OwnerEmailProviderConfigResolved) {}

  async sendEmail(input: EmailSendInput): Promise<{ providerMessageId: string | null }> {
    if (!this.cfg.apiKey) throw new Error('email_provider_not_configured');
    const resend = new Resend(this.cfg.apiKey);
    const from = `${this.cfg.fromName} <${this.cfg.fromEmail}>`;
    const response = await resend.emails.send({
      from,
      to: [input.to],
      replyTo: input.reply_to?.trim() || undefined,
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: resendAttachments(input),
    });
    const { data, error } = response;
    if (error) {
      throw new Error(`email_send_failed:${error.message}`);
    }
    return { providerMessageId: data?.id ?? null };
  }
}

class SendGridAdapter implements EmailDeliveryAdapter {
  constructor(private readonly cfg: OwnerEmailProviderConfigResolved) {}

  async sendEmail(input: EmailSendInput): Promise<{ providerMessageId: string | null }> {
    if (!this.cfg.apiKey) throw new Error('email_provider_not_configured');
    const body: Record<string, unknown> = {
      personalizations: [{ to: [{ email: input.to }] }],
      from: { email: this.cfg.fromEmail, name: this.cfg.fromName },
      subject: input.subject,
      content: [
        { type: 'text/plain', value: input.text },
        { type: 'text/html', value: input.html },
      ],
    };
    if (input.reply_to?.trim()) {
      body.reply_to = { email: input.reply_to.trim() };
    }
    const attachments = sendGridAttachments(input);
    if (attachments?.length) body.attachments = attachments;

    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`email_send_failed:${txt}`);
    }
    const messageId = res.headers.get('x-message-id');
    return { providerMessageId: messageId };
  }
}

class SmtpAdapter implements EmailDeliveryAdapter {
  constructor(private readonly cfg: OwnerEmailProviderConfigResolved) {}

  async sendEmail(input: EmailSendInput): Promise<{ providerMessageId: string | null }> {
    if (!this.cfg.smtp.host || !this.cfg.smtp.port || !this.cfg.smtp.user || !this.cfg.smtp.password) {
      throw new Error('email_provider_not_configured');
    }
    const transporter = nodemailer.createTransport({
      host: this.cfg.smtp.host,
      port: this.cfg.smtp.port,
      secure: this.cfg.smtp.port === 465,
      auth: {
        user: this.cfg.smtp.user,
        pass: this.cfg.smtp.password,
      },
    });
    const info = await transporter.sendMail({
      from: `${this.cfg.fromName} <${this.cfg.fromEmail}>`,
      to: input.to,
      replyTo: input.reply_to?.trim() || undefined,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: smtpAttachments(input),
    });
    return { providerMessageId: info.messageId ?? null };
  }
}

function pickPath(obj: unknown, path: string | null): unknown {
  if (!path) return null;
  const parts = path.split('.').map((p) => p.trim()).filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur ?? null;
}

class CustomEmailApiAdapter implements EmailDeliveryAdapter {
  constructor(private readonly cfg: OwnerEmailProviderConfigResolved) {}

  async sendEmail(input: EmailSendInput): Promise<{ providerMessageId: string | null }> {
    const c = this.cfg.customApi;
    if (!this.cfg.apiKey || !c.apiEndpointUrl || !c.authType || !c.authHeaderName) {
      throw new Error('email_provider_not_configured');
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    for (const [k, v] of Object.entries(c.staticHeaders ?? {})) {
      if (typeof v === 'string') headers[k] = v;
    }
    headers[c.authHeaderName] =
      c.authType === 'bearer_token' ? `Bearer ${this.cfg.apiKey}` : this.cfg.apiKey;
    const body: Record<string, unknown> = {
      ...(c.staticPayload ?? {}),
      from_email: this.cfg.fromEmail,
      from_name: this.cfg.fromName,
      [c.recipientField ?? 'to']: input.to,
      [c.subjectField ?? 'subject']: input.subject,
      [c.htmlBodyField ?? 'html']: input.html,
      [c.textBodyField ?? 'text']: input.text,
    };
    if (input.reply_to?.trim()) {
      body.reply_to = input.reply_to.trim();
    }
    if (input.attachments?.length) {
      body.attachments = input.attachments;
    }
    const res = await fetch(c.apiEndpointUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let parsed: unknown = null;
    try {
      parsed = raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const errMsg = pickPath(parsed, c.errorResponsePath) ?? raw;
      throw new Error(`email_send_failed:${String(errMsg ?? 'provider_error')}`);
    }
    const providerMessageId = pickPath(parsed, c.successResponsePath);
    return { providerMessageId: providerMessageId ? String(providerMessageId) : null };
  }
}

export function createEmailDeliveryAdapter(config: OwnerEmailProviderConfigResolved): EmailDeliveryAdapter {
  if (config.providerType === 'resend') return new ResendAdapter(config);
  if (config.providerType === 'sendgrid') return new SendGridAdapter(config);
  if (config.providerType === 'smtp') return new SmtpAdapter(config);
  if (config.providerType === 'custom_api') return new CustomEmailApiAdapter(config);
  throw new Error('email_provider_not_configured');
}
