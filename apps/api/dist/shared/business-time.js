/** Israel business calendar for client-operations deadlines (NI, ניכויים, KPIs). */
export const BUSINESS_TIME_ZONE = 'Asia/Jerusalem';
/** YYYY-MM-DD in BUSINESS_TIME_ZONE for the given instant. */
export function businessYmd(d) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: BUSINESS_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);
}
/** YYYY-MM in BUSINESS_TIME_ZONE. */
export function businessMonthKey(d) {
    return businessYmd(d).slice(0, 7);
}
/** Previous calendar month as YYYY-MM in BUSINESS_TIME_ZONE (תקופת משכורות / ניכויים alignment). */
export function businessPreviousMonthKey(d) {
    const ymd = businessYmd(d);
    let y = Number(ymd.slice(0, 4));
    let m = Number(ymd.slice(5, 7));
    m -= 1;
    if (m < 1) {
        m = 12;
        y -= 1;
    }
    return `${y}-${String(m).padStart(2, '0')}`;
}
/** Calendar day 1–31 in BUSINESS_TIME_ZONE. */
export function businessDayOfMonth(d) {
    return Number(new Intl.DateTimeFormat('en-US', {
        timeZone: BUSINESS_TIME_ZONE,
        day: 'numeric',
    }).format(d));
}
