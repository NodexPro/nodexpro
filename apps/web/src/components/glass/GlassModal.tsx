import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../i18n/I18nProvider';

export function GlassModal(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
}) {
  const { open, title, onClose, children, footer, testId } = props;
  const { lang, t } = useI18n();
  const dir = lang === 'he' ? 'rtl' : 'ltr';

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="nx-glass-modal-overlay"
      role="presentation"
      dir={dir}
      lang={lang}
      data-testid={testId}
      onClick={onClose}
    >
      <div
        className="nx-glass-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nx-glass-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="nx-glass-modal__header">
          <h2 id="nx-glass-modal-title" className="nx-glass-title">
            {title}
          </h2>
          <button type="button" className="nx-glass-btn nx-glass-btn--purple" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        <div className="nx-glass-modal__body">{children}</div>
        {footer ? <div className="nx-glass-modal__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
