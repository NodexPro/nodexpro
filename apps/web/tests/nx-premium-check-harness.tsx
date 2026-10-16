/**
 * Visual harness: reusable navy/cyan checkbox states (not domain commands).
 */
import { createRoot } from 'react-dom/client';
import '../src/styles/nx-premium-check.css';
import '../src/styles/nx-client-operations-spreadsheet.css';

createRoot(document.getElementById('root')!).render(
  <div className="nx-co-sheet" style={{ margin: 24, maxWidth: 420 }} data-testid="nx-premium-check-harness">
    <label>
      <input type="checkbox" className="nx-premium-check" data-state="unchecked" />
      unchecked
    </label>
    <label>
      <input type="checkbox" className="nx-premium-check" defaultChecked data-state="checked" />
      checked
    </label>
    <label>
      <input type="checkbox" className="nx-premium-check" disabled data-state="disabled" />
      disabled
    </label>
    <label>
      <input type="checkbox" className="nx-premium-check" defaultChecked disabled data-state="disabled-checked" />
      disabled checked
    </label>
    <label>
      <input type="checkbox" className="nx-premium-check" data-state="indeterminate" />
      indeterminate
    </label>
    <label>
      <input type="checkbox" className="nx-co-sheet__checkbox" defaultChecked data-state="alias" />
      registry alias
    </label>
  </div>,
);

requestAnimationFrame(() => {
  const indeterminate = document.querySelector('[data-state="indeterminate"]') as HTMLInputElement | null;
  if (indeterminate) indeterminate.indeterminate = true;
  const nodes = Array.from(document.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
  const pre = document.getElementById('nx-layout-dump');
  if (pre) {
    pre.textContent = JSON.stringify({
      count: nodes.length,
      states: nodes.map((el) => {
        const cs = getComputedStyle(el);
        return {
          state: el.getAttribute('data-state'),
          w: el.getBoundingClientRect().width,
          h: el.getBoundingClientRect().height,
          radius: cs.borderRadius,
          appearance: cs.appearance || (cs as CSSStyleDeclaration & { webkitAppearance?: string }).webkitAppearance,
          disabled: el.disabled,
          checked: el.checked,
          indeterminate: el.indeterminate,
        };
      }),
    });
  }
});
