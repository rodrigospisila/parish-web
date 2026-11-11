import { useCallback, useEffect, useSyncExternalStore } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { PLAN_REQUIRED_EVENT } from '../services/planErrors';

/** GET /me/entitlements — o que o plano da comunidade libera agora. */
export interface PlanEntitlements {
  enforcement: 'off' | 'log' | 'on';
  communityId: string | null;
  plan: {
    status: 'FREE' | 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED';
    tierKey: string | null;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    periodOverdue?: boolean;
    graceEndsAt?: string | null;
  } | null;
  paidAccess: boolean;
  /** Liberado AGORA (fora do modo "on" inclui todos os pagos) */
  features: string[];
  paidFeatures: string[];
  /** Comunidades do escopo com plano (backend novo) */
  paidCommunityIds?: string[];
  /** Testes que acabam em até 15 dias (backend novo) */
  trialsEndingSoon?: Array<{ communityId: string; communityName: string; trialEndsAt: string }>;
}

/**
 * Recursos pagos do contrato (plan-rules.ts no backend), na mesma ordem. Só é
 * usado pelo override de desenvolvimento quando o servidor não respondeu — em
 * uso normal quem manda é a lista `paidFeatures` do backend.
 */
export const PAID_FEATURE_KEYS = [
  'pastorals',
  'schedules',
  'swaps',
  'catechesis',
  'formation',
  'rooms',
  'visitation',
  'documents',
  'events',
  'news',
  'prayer-requests',
  'clergy-messages',
  'planning',
  'sacraments',
  'sacrament-processes',
  'finance',
  'tithe',
  'dashboard',
] as const;

/** Chave do localStorage do override de desenvolvimento ("plano grátis à força"). */
export const FORCE_FREE_KEY = 'parishForceFree';

/**
 * Só em desenvolvimento (`npm run dev`): com `localStorage.parishForceFree = '1'`
 * todos os recursos pagos aparecem bloqueados, para ver o painel do plano grátis
 * sem ligar o `PLAN_ENFORCEMENT=on` no servidor. Nunca vale no build de produção.
 */
export function isForceFreeDev(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem(FORCE_FREE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Recarrega no máximo uma vez a cada 30 s quando chega um PLAN_REQUIRED. */
const REFRESH_ON_ERROR_MS = 30_000;

// ---------------------------------------------------------------------------
// Estado ÚNICO por sessão: menu, guardas de rota, Início e vitrines leem a
// mesma resposta (uma chamada só, sem cada tela piscar enquanto recarrega).
// ---------------------------------------------------------------------------
interface Snapshot {
  /** Usuário/papel/comunidade a que o estado se refere (null = ninguém logado) */
  key: string | null;
  data: PlanEntitlements | null;
  /** Já houve resposta (ou falha) para esta chave */
  ready: boolean;
}

let snapshot: Snapshot = { key: null, data: null, ready: false };
let requestSeq = 0;
let lastErrorRefresh = 0;
const listeners = new Set<() => void>();

function publish(next: Snapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => snapshot;

/** Busca os entitlements da chave; recarga da mesma chave mantém o dado atual até a resposta. */
function fetchEntitlements(key: string | null) {
  const seq = ++requestSeq;
  if (!key) {
    publish({ key: null, data: null, ready: false });
    return;
  }
  if (snapshot.key !== key) publish({ key, data: null, ready: false });
  api
    .get<PlanEntitlements>('/me/entitlements')
    .then((res) => {
      if (seq !== requestSeq) return;
      const body = res.data;
      const valid = !!body && Array.isArray(body.features) && Array.isArray(body.paidFeatures);
      publish({ key, data: valid ? body : null, ready: true });
    })
    .catch(() => {
      if (seq !== requestSeq) return;
      // Falhou: nada aparece bloqueado (quem decide é o backend, tela a tela)
      publish({ key, data: snapshot.key === key ? snapshot.data : null, ready: true });
    });
}

/** Recarrega os entitlements da sessão atual (ex.: depois de iniciar o teste). */
export function reloadPlanEntitlements() {
  fetchEntitlements(snapshot.key);
}

/**
 * Entitlements do usuário logado: carrega no login e quando o usuário (ou a
 * comunidade dele) muda; recarrega quando uma tela recebe PLAN_REQUIRED.
 * Enquanto carrega (`ready` falso) ou se falhar, nada aparece bloqueado — quem
 * decide é o backend. Com o recurso bloqueado (modo "on" + comunidade sem
 * acesso), o menu leva à vitrine do recurso e a rota mostra a vitrine.
 */
export function usePlanEntitlements() {
  const { user } = useAuth();
  const key = user?.id ? `${user.id}|${user.role ?? ''}|${user.communityId ?? ''}` : null;
  const state = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    if (snapshot.key !== key) fetchEntitlements(key);
  }, [key]);

  useEffect(() => {
    const onPlanError = () => {
      const now = Date.now();
      if (now - lastErrorRefresh < REFRESH_ON_ERROR_MS) return;
      lastErrorRefresh = now;
      reloadPlanEntitlements();
    };
    window.addEventListener(PLAN_REQUIRED_EVENT, onPlanError);
    return () => window.removeEventListener(PLAN_REQUIRED_EVENT, onPlanError);
  }, []);

  const current = state.key === key;
  const data = current ? state.data : null;
  // Sem usuário não há o que esperar; com usuário, espera a resposta desta sessão
  const ready = !key || (current && state.ready);
  // Override de desenvolvimento: nunca para a plataforma (SYSTEM_ADMIN não muda em nada)
  const forceFree = isForceFreeDev() && !!user && user.role !== 'SYSTEM_ADMIN';

  /** Recurso pago fora do plano agora (só no modo "on" — ou no override de desenvolvimento). */
  const isLocked = useCallback(
    (feature: string) => {
      if (forceFree) return (data?.paidFeatures ?? (PAID_FEATURE_KEYS as readonly string[])).includes(feature);
      return !!data && data.paidFeatures.includes(feature) && !data.features.includes(feature);
    },
    [data, forceFree],
  );

  /** Há algum recurso pago bloqueado (o painel está no "plano grátis")? */
  const anyLocked = forceFree || (!!data && data.paidFeatures.some((feature) => !data.features.includes(feature)));

  return { entitlements: data, isLocked, anyLocked, ready, reload: reloadPlanEntitlements };
}
