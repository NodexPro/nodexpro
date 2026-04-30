# -*- coding: utf-8 -*-
path = r"apps/api/src/domains/client-operations/client-fees-tab.service.ts"
with open(path, "r", encoding="utf-8") as f:
    lines = f.readlines()
for i, line in enumerate(lines):
    if "agreement_end_date" in line and "formatDateHe" in line and "lines.push" in line:
        if "label_he:" in line and "סיום ההסכם" in line:
            lines[i] = (
                "    lines.push({ label_he: 'תארי�� סיום ההסכם', value_he: formatDateHe((a.agreement_end_date as string | null) ?? null) });\n"
            )
            break
for i, line in enumerate(lines):
    if "agreement_start_date" in line and "lines.push" in line and "תחילת" in line:
        lines[i] = (
            "    lines.push({ label_he: 'תארי�� תחילת ההסכם', value_he: formatDateHe((a.agreement_start_date as string | null) ?? null) });\n"
        )
        break
for i, line in enumerate(lines):
    if "lines.push({ label_he: 'יש הסכם" in line:
        lines[i] = "  lines.push({ label_he: 'יש הסכם שכ\"ט', value_he: hasAgreement ? 'כן' : 'לא' });\n"
        break
for i, line in enumerate(lines):
    if "card_title_he: 'הסכם" in line and "buildAgreementSummary" in "".join(lines[max(0, i - 20) : i]):
        if "card_title_he" in line:
            lines[i] = "    card_title_he: 'הסכם שכ\"ט',\n"
        break
for i, line in enumerate(lines):
    if "no_agreement_summary_he:" in line and i > 340 and i < 370:
        lines[i] = "    no_agreement_summary_he: hasAgreement ? null : 'לא הוגדר הסכם שכ\"ט',\n"
        break
with open(path, "w", encoding="utf-8") as f:
    f.writelines(lines)
print("ok")
