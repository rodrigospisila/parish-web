import { useCallback, useEffect, useRef, useState } from 'react';
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

/** Recarrega no máximo uma vez a cada 30 s quando chega um PLAN_REQUIRED. */
const REFRESH_ON_ERROR_MS = 30_000;

/**
 * Entitlements do usuário logado: carrega no login e quando o usuário (ou a
 * comunidade dele) muda; recarrega quando uma tela recebe PLAN_REQUIRED.
 * Enquanto carrega (ou se falhar) nada aparece bloqueado — quem decide é o
 * backend; o menu só ganha o selo "plano".
 */
export function usePlanEntitlements() {
  const { user } = useAuth();
  const [data, setData] = useState<PlanEntitlements | null>(null);
  const lastErrorRefresh = useRef(0);

  const load = useCallback(() => {
    if (!user?.id) {
      setData(null);
      return;
    }
    api
      .get<PlanEntitlements>('/me/entitlements')
      .then((res) => setData(res.data ?? null))
      .catch(() => setData(null));
  }, [user?.id]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role, user?.communityId]);

  useEffect(() => {
    const onPlanError = () => {
      const now = Date.now();
      if (now - lastErrorRefresh.current < REFRESH_ON_ERROR_MS) return;
      lastErrorRefresh.current = now;
      load();
    };
    window.addEventListener(PLAN_REQUIRED_EVENT, onPlanError);
    return () => window.removeEventListener(PLAN_REQUIRED_EVENT, onPlanError);
  }, [load]);

  /** Recurso pago fora do plano agora (só no modo "on"). */
  const isLocked = useCallback(
    (feature: string) => !!data && data.paidFeatures.includes(feature) && !data.features.includes(feature),
    [data],
  );

  return { entitlements: data, isLocked, reload: load };
}
