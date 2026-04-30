# -*- coding: utf-8 -*-
path = r"apps/api/src/domains/client-operations/client-fees-tab.service.ts"
with open(path, "r", encoding="utf-8") as f:
    lines = f.readlines()
# 0-based: line 447 is index 446 — find "const st = (a.agreement_status"
start = next(i for i, L in enumerate(lines) if "const st = (a.agreement_status" in L and i > 400)
end = next(i for i, L in enumerate(lines[start:], start) if L.strip() == "}" and i > start + 5)
# find closing of return block — after "visibility," line
end = next(i for i, L in enumerate(lines[start:], start) if L.strip() == "};" and i > start)
# Actually find pattern: return { then card: — end at }; before buildDiscountSection
block_start = next(i for i, L in enumerate(lines) if "const st = (a.agreement_status" in L)
block_end = next(i for i, L in enumerate(lines[block_start:], block_start) if L.startswith("function buildDiscountSection"))
new_block = """ modal_group: 'agreement',
    },
  ];

  const visibility: FeesTabVisibility = {
    show_agreement_details: true,
    show_service_sections: hasAgreement,
    show_discount_block: hasAgreement,
    show_financial_summary: hasAgreement,
    show_renew_section: hasAgreement,
    show_price_history: hasAgreement,
    show_recent_history: hasAgreement,
  };

  const discountSec = buildDiscountSection(a, canEdit, hasAgreement);
  const renewalSec = buildRenewalSection(a, canEdit, hasAgreement);
  const discountFields = discountSec.fields.map((f) => ({ ...f, modal_group: 'discount' as const }));
  const renewalFields = renewalSec.fields.map((f) => ({ ...f, modal_group: 'renewal' as const }));

  const edit_modal: FeesEditModalDto = {
    modal_title_he: 'עריכת שכ"ט',
    save_hint_he: 'שמירה מעדכנת את הלשונית לפי הנתונים מהשרת.',
    sections: [
      { section_title_he: 'הסכם שכ"ט', fields },
      { section_title_he: 'הנחה', fields: discountFields },
      { section_title_he: 'חידוש והתראות', fields: renewalFields },
    ],
  };

  return {
    agreement_summary: buildAgreementSummary(a),
    visibility,
    edit_modal,
  };
}

"""
# Replace from line that has only " }," closing agreement_status — need find "key: 'agreement_status'" block end
idx_ag = next(i for i, L in enumerate(lines) if "key: 'agreement_status'" in L)
# find closing of agreement_status object: line with editable: canEdit, then },
close_idx = idx_ag
while close_idx < len(lines) and not (
    lines[close_idx].strip() == "}," and "editable: canEdit" in lines[close_idx - 1]
):
    close_idx += 1
# close_idx points to `    },` after agreement_status
insert_modal = close_idx
# remove from insert_modal+1 through before buildDiscountSection
bd = next(i for i, L in enumerate(lines) if L.startswith("function buildDiscountSection"))
# keep lines[0:insert_modal+1] but last line should add modal_group - check if agreement_status has modal_group
if "modal_group" not in lines[insert_modal - 1]:
    # insert modal_group before closing },
    j = insert_modal
    while j > idx_ag and "editable: canEdit" not in lines[j]:
        j -= 1
    lines[j] = lines[j].rstrip() + ",\n"
    lines.insert(j + 1, "      modal_group: 'agreement',\n")
 bd += 1
    insert_modal += 1
# Now remove from after `  ];` following fields array to before buildDiscountSection
arr_close = next(i for i, L in enumerate(lines) if i > insert_modal and L.strip() == "];")
# from arr_close+1 to bd-1 delete
lines = lines[: arr_close + 1] + [new_block] + lines[bd:]
with open(path, "w", encoding="utf-8") as f:
    f.writelines(lines)
print("patched", arr_close, bd)
