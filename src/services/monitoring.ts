/**
 * Rastreamento de erros do painel (eng-qualidade-03).
 *
 * Só liga com `VITE_SENTRY_DSN` definido no build. Sem DSN nada muda: o
 * pacote `@sentry/react` nem é baixado (import dinâmico) e `reportError` só
 * escreve no console. Sem dados pessoais (LGPD): nada de usuário, IP, corpo de
 * requisição, query string nem e-mail/CPF/telefone nas mensagens.
 *
 * CSP: o domínio de ingestão do Sentry (ex.: https://*.ingest.us.sentry.io)
 * precisa entrar no `connect-src` do vercel.json.
 */
type SentryModule = typeof import('@sentry/react');

const DSN = String(import.meta.env.VITE_SENTRY_DSN ?? '').trim();

let sentryPromise: Promise<SentryModule | null> | null = null;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const PHONE_RE = /(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._-]+/gi;

/** Tira e-mail, CPF, telefone e token de um texto. */
export function scrubText(text: string): string {
  return text
    .replace(BEARER_RE, 'Bearer [removido]')
    .replace(EMAIL_RE, '[e-mail]')
    .replace(CPF_RE, '[cpf]')
    .replace(PHONE_RE, '[telefone]');
}

/** URL sem query string/hash e sem o token do recibo público de doação. */
export function scrubUrl(url: string): string {
  const base = url.split(/[?#]/)[0];
  return base.replace(/(\/doar\/recibo\/)[^/]+/i, '$1[token]');
}

function scrubEvent<T extends Record<string, any>>(event: T): T {
  const e: any = event;
  delete e.user;
  if (e.request) {
    delete e.request.cookies;
    delete e.request.headers;
    delete e.request.data;
    delete e.request.query_string;
    if (typeof e.request.url === 'string') e.request.url = scrubUrl(e.request.url);
  }
  if (typeof e.message === 'string') e.message = scrubText(e.message);
  for (const value of e.exception?.values ?? []) {
    if (typeof value?.value === 'string') value.value = scrubText(value.value);
  }
  if (typeof e.transaction === 'string') e.transaction = scrubUrl(e.transaction);
  if (Array.isArray(e.breadcrumbs)) e.breadcrumbs = e.breadcrumbs.map(scrubBreadcrumb).filter(Boolean);
  return event;
}

function scrubBreadcrumb(crumb: any): any {
  if (!crumb) return crumb;
  // Console pode ter qualquer dado da tela: fica de fora
  if (crumb.category === 'console') return null;
  if (typeof crumb.message === 'string') crumb.message = scrubText(crumb.message);
  if (crumb.data) {
    if (typeof crumb.data.url === 'string') crumb.data.url = scrubUrl(crumb.data.url);
    if (typeof crumb.data.from === 'string') crumb.data.from = scrubUrl(crumb.data.from);
    if (typeof crumb.data.to === 'string') crumb.data.to = scrubUrl(crumb.data.to);
  }
  return crumb;
}

/** Inicia o Sentry (uma vez). Sem DSN, não faz nada. */
export function initMonitoring(): void {
  if (!DSN || sentryPromise) return;
  sentryPromise = import('@sentry/react')
    .then((Sentry) => {
      Sentry.init({
        dsn: DSN,
        environment: String(import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE),
        release: import.meta.env.VITE_RELEASE ? String(import.meta.env.VITE_RELEASE) : undefined,
        // Sem dados pessoais (o SDK 11 trocou sendDefaultPii por dataCollection)
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: false,
          httpBodies: [],
          urlQueryParams: false,
          stackFrameVariables: false,
        },
        tracesSampleRate: 0,
        beforeSend: (event) => scrubEvent(event),
        beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
      });
      return Sentry;
    })
    .catch(() => null);
}

export function isMonitoringEnabled(): boolean {
  return !!DSN;
}

/**
 * Registra um erro (ErrorBoundary, falhas inesperadas). Devolve o id do evento
 * no Sentry — a tela mostra os 8 primeiros caracteres como código — ou null.
 */
export async function reportError(error: unknown, context?: { componentStack?: string | null; area?: string }): Promise<string | null> {
  // eslint-disable-next-line no-console
  console.error(error);
  if (!DSN) return null;
  initMonitoring();
  const Sentry = await (sentryPromise ?? Promise.resolve(null));
  if (!Sentry) return null;
  try {
    return Sentry.captureException(error, (scope) => {
      if (context?.area) scope.setTag('area', context.area);
      scope.setTag('rota', scrubUrl(window.location.pathname));
      if (context?.componentStack) scope.setContext('react', { componentStack: context.componentStack });
      return scope;
    });
  } catch {
    return null;
  }
}
