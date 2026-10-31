import { useI18n } from '../../i18n/I18nProvider';
import '../../styles/nx-public-shell.css';

export function PublicFooter() {
  const { t } = useI18n();
  const year = String(new Date().getFullYear());

  return (
    <footer className="nx-public-footer nx-landing__footer">
      <p className="nx-public-footer__copy nx-landing__footer-copy">
        {t('landing.footerCopy').replace('{year}', year)}
      </p>
    </footer>
  );
}
