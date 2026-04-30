/**
 * הצהרת עסק פטור — מועד 31.03 וטקסטי tooltip (מקור אמת בשרת בלבד).
 */
/** מועד הגשה: 31.3 של שנת Y עבור שנת מס Y-1, עד 31.3 כלול — אותו מועד; מ-1.4 — המועד הבא (31.3 של השנה הבאה). */
export function getOsekPaturDeadlineAndTaxYear(now) {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth() + 1;
    const beforeApril = m < 4;
    if (beforeApril) {
        return { deadlineYear: y, taxYear: y - 1 };
    }
    return { deadlineYear: y + 1, taxYear: y };
}
/**
 * טקסט דחיות (קבוע) — רק בשנת לוח 2026; מ-2027: רק מספרי שנה מתעדכנים (31.03.YY + שנת מס קודמת).
 */
const TOOLTIP_POSTPONEMENT_2026_HE = 'מועד הגשת הצהרה שנתית לשנת 2025 על ידי עוסק פטור יידחה עד ליום 30.4.2026 ומועד הגשת דיווח שנתי מסכם על ידי בעל עסק זעיר לשנת 2025, אשר כבר נדחה ליום 31.5.2026 ימשיך לחול ביום זה.';
export function computeOsekPaturDeclarationUi(now) {
    const { deadlineYear, taxYear } = getOsekPaturDeadlineAndTaxYear(now);
    const yy = String(deadlineYear).slice(-2).padStart(2, '0');
    const date_display_he = `31.03.${yy}`;
    const date_full_he = `31.03.${deadlineYear}`;
    const label_he = 'הצהרת עסק פטור';
    const calendarYear = now.getUTCFullYear();
    let tooltip_title_he;
    let tooltip_body_he;
    if (calendarYear === 2026) {
        tooltip_title_he = '';
        tooltip_body_he = TOOLTIP_POSTPONEMENT_2026_HE;
    }
    else {
        tooltip_title_he = '';
        tooltip_body_he = `יש להגיש הצהרה עד ליום ${date_full_he} עבור שנת המס ${taxYear}.`;
    }
    return {
        label_he,
        date_display_he,
        tooltip_title_he,
        tooltip_body_he,
    };
}
