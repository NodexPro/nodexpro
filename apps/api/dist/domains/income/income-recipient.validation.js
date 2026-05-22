/**
 * Income document recipient (buyer) field validation — backend source of truth.
 */
import { AppError } from '../../shared/errors.js';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d+\-\s()]{7,20}$/;
const TAX_ID_RE = /^[\d]{5,12}$/;
export function parseRecipientInputBody(body) {
    const display_name = String(body.display_name ?? '').trim();
    const tax_id = String(body.tax_id ?? '').trim() || null;
    const phone = String(body.phone ?? '').trim() || null;
    const email = String(body.email ?? '').trim() || null;
    const address = String(body.address ?? '').trim() || null;
    const city = String(body.city ?? '').trim() || null;
    return { display_name, tax_id, phone, email, address, city };
}
export function validateRecipientInputFields(fields) {
    const errors = {};
    if (!fields.display_name) {
        errors.display_name = 'שם מקבל המסמך נדרש';
    }
    else if (fields.display_name.length > 200) {
        errors.display_name = 'שם ארוך מדי';
    }
    if (fields.email && !EMAIL_RE.test(fields.email)) {
        errors.email = 'כתובת אימייל לא תקינה';
    }
    if (fields.phone && !PHONE_RE.test(fields.phone)) {
        errors.phone = 'מספר טלפון לא תקין';
    }
    const taxDigits = (fields.tax_id ?? '').replace(/\D/g, '');
    if (fields.tax_id && (taxDigits.length < 5 || taxDigits.length > 12)) {
        errors.tax_id = 'ח.פ / ע.מ לא תקין';
    }
    if (fields.address && fields.address.length > 300) {
        errors.address = 'כתובת ארוכה מדי';
    }
    if (fields.city && fields.city.length > 120) {
        errors.city = 'שם עיר ארוך מדי';
    }
    return errors;
}
export function assertRecipientInputValid(body) {
    const fields = parseRecipientInputBody(body);
    const errors = validateRecipientInputFields(fields);
    if (Object.keys(errors).length > 0) {
        throw new AppError(400, 'Recipient validation failed', 'INCOME_RECIPIENT_VALIDATION', {
            field_errors: errors,
        });
    }
    return fields;
}
export function buildRecipientAddressJson(fields) {
    if (!fields.address && !fields.city)
        return null;
    return {
        address: fields.address,
        city: fields.city,
    };
}
export function buildRecipientSnapshotJson(fields) {
    return {
        display_name: fields.display_name,
        tax_id: fields.tax_id,
        phone: fields.phone,
        email: fields.email,
        address_json: buildRecipientAddressJson(fields),
    };
}
export function recipientDisplayLine(fields) {
    const parts = [fields.display_name];
    if (fields.tax_id?.trim())
        parts.push(fields.tax_id.trim());
    if (fields.phone?.trim())
        parts.push(fields.phone.trim());
    if (fields.email?.trim())
        parts.push(fields.email.trim());
    return parts.join(' · ');
}
