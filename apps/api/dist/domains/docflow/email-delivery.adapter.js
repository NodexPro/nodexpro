import nodemailer from 'nodemailer';
import { Resend } from 'resend';
class ResendAdapter {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    async sendEmail(input) {
        if (!this.cfg.apiKey)
            throw new Error('email_provider_not_configured');
        const resend = new Resend(this.cfg.apiKey);
        const from = `${this.cfg.fromName} <${this.cfg.fromEmail}>`;
        const response = await resend.emails.send({
            from,
            to: [input.to],
            subject: input.subject,
            html: input.html,
            text: input.text,
        });
        console.log('EMAIL SEND RESPONSE:', response);
        const { data, error } = response;
        if (error) {
            const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
                ? error.code
                : error && typeof error === 'object' && 'name' in error
                    ? String(error.name ?? '')
                    : '';
            console.error('EMAIL SEND ERROR:', error.message, code || '(no code)');
            throw new Error(`email_send_failed:${error.message}`);
        }
        return { providerMessageId: data?.id ?? null };
    }
}
class SendGridAdapter {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    async sendEmail(input) {
        if (!this.cfg.apiKey)
            throw new Error('email_provider_not_configured');
        const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.cfg.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                personalizations: [{ to: [{ email: input.to }] }],
                from: { email: this.cfg.fromEmail, name: this.cfg.fromName },
                subject: input.subject,
                content: [
                    { type: 'text/plain', value: input.text },
                    { type: 'text/html', value: input.html },
                ],
            }),
        });
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`email_send_failed:${txt}`);
        }
        const messageId = res.headers.get('x-message-id');
        return { providerMessageId: messageId };
    }
}
class SmtpAdapter {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    async sendEmail(input) {
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
            subject: input.subject,
            text: input.text,
            html: input.html,
        });
        return { providerMessageId: info.messageId ?? null };
    }
}
function pickPath(obj, path) {
    if (!path)
        return null;
    const parts = path.split('.').map((p) => p.trim()).filter(Boolean);
    let cur = obj;
    for (const p of parts) {
        if (!cur || typeof cur !== 'object' || Array.isArray(cur))
            return null;
        cur = cur[p];
    }
    return cur ?? null;
}
class CustomEmailApiAdapter {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    async sendEmail(input) {
        const c = this.cfg.customApi;
        if (!this.cfg.apiKey || !c.apiEndpointUrl || !c.authType || !c.authHeaderName) {
            throw new Error('email_provider_not_configured');
        }
        const headers = {
            'Content-Type': 'application/json',
        };
        for (const [k, v] of Object.entries(c.staticHeaders ?? {})) {
            if (typeof v === 'string')
                headers[k] = v;
        }
        headers[c.authHeaderName] =
            c.authType === 'bearer_token' ? `Bearer ${this.cfg.apiKey}` : this.cfg.apiKey;
        const body = {
            ...(c.staticPayload ?? {}),
            from_email: this.cfg.fromEmail,
            from_name: this.cfg.fromName,
            [c.recipientField ?? 'to']: input.to,
            [c.subjectField ?? 'subject']: input.subject,
            [c.htmlBodyField ?? 'html']: input.html,
            [c.textBodyField ?? 'text']: input.text,
        };
        const res = await fetch(c.apiEndpointUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
        const raw = await res.text();
        let parsed = null;
        try {
            parsed = raw ? JSON.parse(raw) : null;
        }
        catch {
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
export function createEmailDeliveryAdapter(config) {
    if (config.providerType === 'resend')
        return new ResendAdapter(config);
    if (config.providerType === 'sendgrid')
        return new SendGridAdapter(config);
    if (config.providerType === 'smtp')
        return new SmtpAdapter(config);
    if (config.providerType === 'custom_api')
        return new CustomEmailApiAdapter(config);
    throw new Error('email_provider_not_configured');
}
