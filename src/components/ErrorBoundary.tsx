import React from 'react';
import { reportError } from '../services/monitoring';
import './ErrorBoundary.css';

interface Props {
  children: React.ReactNode;
  /**
   * `page`: erro numa tela do painel (o menu continua de pé);
   * `app`: erro no topo (painel inteiro).
   */
  variant?: 'page' | 'app';
  /** Mudou (ex.: a rota) com erro na tela: limpa o erro e tenta de novo */
  resetKey?: string;
}

interface State {
  error: Error | null;
  eventId: string | null;
}

/**
 * Captura erro de renderização (eng-qualidade-03): em vez da tela em branco,
 * mostra uma mensagem curta, o código do erro (quando o Sentry está ligado) e
 * os botões de recarregar / voltar ao início. No painel, o AdminLayout envolve
 * a área das telas com `resetKey` = caminho: trocar de tela limpa o erro (sem
 * remontar as telas a cada navegação).
 */
class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, eventId: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, eventId: null });
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    void reportError(error, { componentStack: info.componentStack, area: this.props.variant ?? 'page' }).then((eventId) => {
      if (eventId) this.setState({ eventId });
    });
  }

  render() {
    const { error, eventId } = this.state;
    if (!error) return this.props.children;
    const isApp = this.props.variant === 'app';
    return (
      <div className={`error-boundary${isApp ? ' error-boundary--app' : ''}`} role="alert">
        <div className="error-boundary__card">
          <h2 className="error-boundary__title">Algo deu errado {isApp ? 'no painel' : 'nesta tela'}</h2>
          <p className="error-boundary__text">
            Seus dados estão guardados. Recarregue a página; se o problema continuar, avise o suporte
            {eventId ? ' informando o código abaixo' : ''}.
          </p>
          {eventId && (
            <p className="error-boundary__code">
              Código: <strong>{eventId.slice(0, 8)}</strong>
            </p>
          )}
          <div className="error-boundary__actions">
            <button type="button" className="error-boundary__btn error-boundary__btn--primary" onClick={() => window.location.reload()}>
              Recarregar
            </button>
            <button
              type="button"
              className="error-boundary__btn"
              onClick={() => {
                window.location.href = '/admin';
              }}
            >
              Voltar ao início
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
