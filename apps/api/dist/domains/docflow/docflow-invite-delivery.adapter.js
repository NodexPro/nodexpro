export async function sendInviteSms(_params) {
    const provider = (process.env.SMS_PROVIDER_NAME?.trim() ?? '').toLowerCase();
    if (!provider) {
        throw new Error('sms_provider_not_configured');
    }
    if (provider !== 'twilio') {
        throw new Error('sms_provider_not_configured');
    }
    const sid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? '';
    const token = process.env.TWILIO_AUTH_TOKEN?.trim() ?? '';
    const from = process.env.TWILIO_FROM_NUMBER?.trim() ?? '';
    if (!sid || !token || !from) {
        throw new Error('sms_provider_not_configured');
    }
    const body = `הזמנה ל-DocFlow מ-${_params.firmName}. להצטרפות: ${_params.inviteUrl}`;
    const form = new URLSearchParams();
    form.set('To', _params.to);
    form.set('From', from);
    form.set('Body', body);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`sms_send_failed:${txt}`);
    }
    const data = (await res.json());
    return { providerMessageId: data.sid ?? null };
}
