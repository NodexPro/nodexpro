import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useI18n } from '../../i18n/I18nProvider';

function ClientOperationsRouteErrorFallback({
  onRetry,
}: {
  onRetry: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="nx-co-route-error" role="alert" data-testid="client-operations-route-error">
      <p className="nx-co-route-error__title">{t('clientOperations.routeLoadError')}</p>
      <button type="button" className="nx-btn nx-btn-primary nx-btn-taxes-compact" onClick={onRetry}>
        {t('clientOperations.retry')}
      </button>
    </div>
  );
}

type Props = { children: ReactNode };
type State = { error: Error | null; resetKey: number };

export class ClientOperationsRouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('client-operations route crashed', error, info.componentStack);
  }

  private retry = () => {
    this.setState((current) => ({ error: null, resetKey: current.resetKey + 1 }));
  };

  render(): ReactNode {
    if (this.state.error) {
      return <ClientOperationsRouteErrorFallback onRetry={this.retry} />;
    }
    return <div key={this.state.resetKey}>{this.props.children}</div>;
  }
}
