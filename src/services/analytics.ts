import api from './api';

/**
 * Uso do produto (eng-qualidade-17): eventos AGREGADOS por dia no backend
 * (ProductEvent), sem nenhum dado pessoal. Aqui só vai o nome do evento, a
 * plataforma, a versão e — quando faz sentido — a comunidade; o papel o
 * servidor tira do token.
 *
 * - `track(name, props?)` só põe na fila (nunca lança, nunca espera rede);
 * - a fila vai em lote a cada 10 s e ao sair/ocultar a página (fetch com
 *   keepalive; sendBeacon de reserva);
 * - falha de rede/servidor: descarta o lote (telemetria não pode atrapalhar).
 *
 * Nomes usados pelo painel web. A lista branca é do backend
 * (parish-backend/src/modules/product-events/product-event-names.ts) — nome
 * fora dela é só ignorado (`ignored` na resposta), sem derrubar o lote.
 *   - na lista: web_login, web_dashboard, web_billing ("Meu plano"),
 *     checkout_started;
 *   - pendentes de entrar na lista (site de vendas): landing_view,
 *     demo_request_sent.
 */

export type AnalyticsEventName =
  | 'web_login'
  | 'web_dashboard'
  | 'web_billing'
  | 'checkout_started'
  | 'landing_view'
  | 'demo_request_sent';

export interface AnalyticsProps {
  /** Comunidade relacionada (opcional; nunca id de pessoa) */
  communityId?: string | null;
}

interface QueuedEvent {
  name: AnalyticsEventName;
  platform: 'web';
  appVersion?: string;
  communityId?: string;
}

/** Rota do backend (C4): POST /product-events — POST /events já é a criação de eventos da paróquia. */
const EVENTS_PATH = '/product-events';
const FLUSH_INTERVAL_MS = 10_000;
/** Máximo por envio (o backend aceita até 50). */
const BATCH_MAX = 50;
/** Teto da fila: sem servidor por muito tempo, os mais antigos saem. */
const QUEUE_MAX = 200;

const API_BASE = String(import.meta.env.VITE_API_URL ?? '');
const APP_VERSION = String(import.meta.env.VITE_RELEASE ?? '').trim().slice(0, 40) || undefined;

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let listenersInstalled = false;
let sending = false;

const isBrowser = () => typeof window !== 'undefined';

function readToken(): string | null {
  try {
    return localStorage.getItem('token');
  } catch {
    return null;
  }
}

function ensureRunning() {
  if (!isBrowser()) return;
  if (!timer) timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  if (!listenersInstalled) {
    listenersInstalled = true;
    const onLeave = () => flushOnExit();
    window.addEventListener('pagehide', onLeave);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onLeave();
    });
  }
}

/** Põe um evento na fila. Nunca lança. */
export function track(name: AnalyticsEventName, props?: AnalyticsProps): void {
  try {
    const event: QueuedEvent = { name, platform: 'web' };
    if (APP_VERSION) event.appVersion = APP_VERSION;
    if (props?.communityId) event.communityId = String(props.communityId);
    queue.push(event);
    if (queue.length > QUEUE_MAX) queue = queue.slice(-QUEUE_MAX);
    ensureRunning();
  } catch {
    // telemetria nunca derruba a tela
  }
}

function takeBatch(): QueuedEvent[] {
  const batch = queue.slice(0, BATCH_MAX);
  queue = queue.slice(batch.length);
  return batch;
}

/** Envio normal (com o cliente `api`: renova o token se preciso). */
export async function flush(): Promise<void> {
  if (sending || queue.length === 0) return;
  sending = true;
  try {
    while (queue.length > 0) {
      const batch = takeBatch();
      try {
        await api.post(EVENTS_PATH, { events: batch }, { timeout: 8_000 });
      } catch {
        // descarta o lote: sem retry para não acumular nem martelar o servidor
        break;
      }
    }
  } finally {
    sending = false;
  }
}

/**
 * Saída da página: o navegador pode matar requisições comuns. Vai por fetch
 * com keepalive (leva o Bearer quando há login); se o navegador não aceitar,
 * cai no sendBeacon (sem cabeçalhos — o evento conta sem papel).
 */
function flushOnExit() {
  if (queue.length === 0 || !API_BASE) return;
  const url = `${API_BASE}${EVENTS_PATH}`;
  const token = readToken();
  while (queue.length > 0) {
    const body = JSON.stringify({ events: takeBatch() });
    try {
      if (typeof fetch !== 'function') throw new Error('sem fetch');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      void fetch(url, { method: 'POST', keepalive: true, headers, body }).catch(() => undefined);
    } catch {
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        }
      } catch {
        // ignora
      }
    }
  }
}

/** Evento de tela: no máximo um por chave a cada `minGapMs` nesta aba (evita contar recarga em série). */
const lastByKey = new Map<string, number>();
export function trackOnce(name: AnalyticsEventName, props?: AnalyticsProps, minGapMs = 60_000): void {
  const key = `${name}:${props?.communityId ?? ''}`;
  const now = Date.now();
  const last = lastByKey.get(key) ?? 0;
  if (now - last < minGapMs) return;
  lastByKey.set(key, now);
  track(name, props);
}

/**
 * Login concluído (web_login): observa a resposta do POST /auth/login e do
 * /auth/2fa/login na instância `api` (a tela de login é de outra frente — o
 * evento sai daqui, sem tocar nela). Só conta quando vieram tokens.
 */
let loginWatcherInstalled = false;
export function installLoginTracking(): void {
  if (loginWatcherInstalled) return;
  loginWatcherInstalled = true;
  api.interceptors.response.use((response) => {
    try {
      const url = String(response?.config?.url ?? '');
      const method = String(response?.config?.method ?? '').toLowerCase();
      if (method === 'post' && /\/auth\/(2fa\/)?login$/.test(url.split('?')[0]) && response?.data?.accessToken) {
        track('web_login');
      }
    } catch {
      // ignora
    }
    return response;
  });
}

// A importação já liga o observador do login (o AdminLayout entra no bundle
// inicial pelo App.tsx, então isto roda antes da tela de login)
installLoginTracking();
