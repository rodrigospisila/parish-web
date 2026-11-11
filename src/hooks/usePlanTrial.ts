import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import api, { getErrorMessage } from '../services/api';
import { notify } from '../services/notification.service';
import { reloadPlanEntitlements } from './usePlanEntitlements';

/**
 * Teste de 30 dias POR PEDIDO (contrato 5): o teste deixou de ser automático.
 * `GET /billing/me` traz `trial: { available, usedAt, endsAt }` e o titular /
 * PARISH_ADMIN inicia com `POST /billing/trial { parishId }`, UMA vez por paróquia.
 *
 * O teste só faz sentido com o bloqueio por plano LIGADO (`enforcement === 'on'`
 * no /me/entitlements): fora dele tudo já está liberado e o pedido gastaria o
 * teste único à toa. As telas só mostram o botão com `canOfferTrial`; o
 * backend também recusa (409 TRIAL_NOT_NEEDED) e devolve `available: false`.
 */

/** O botão do teste só aparece com o bloqueio ligado E o teste ainda disponível. */
export function canOfferTrial(
  enforcement: 'off' | 'log' | 'on' | null | undefined,
  trial: { available: boolean } | null | undefined,
): boolean {
  return enforcement === 'on' && trial?.available === true;
}

export interface PlanTrialInfo {
  /** A paróquia ainda pode pedir o teste */
  available: boolean;
  usedAt: string | null;
  endsAt: string | null;
}

/** Lê o bloco `trial` do /billing/me (servidor antigo sem o campo = null: sem botão). */
export function parsePlanTrial(raw: unknown): PlanTrialInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  return {
    available: t.available === true,
    usedAt: typeof t.usedAt === 'string' ? t.usedAt : null,
    endsAt: typeof t.endsAt === 'string' ? t.endsAt : null,
  };
}

/** Resposta por paróquia, compartilhada entre as vitrines (uma chamada por sessão de tela). */
const cache = new Map<string, Promise<PlanTrialInfo | null>>();

function loadTrial(parishId: string): Promise<PlanTrialInfo | null> {
  let pending = cache.get(parishId);
  if (!pending) {
    pending = api
      .get('/billing/me', { params: { parishId } })
      .then((res) => parsePlanTrial(res.data?.trial))
      .catch(() => {
        cache.delete(parishId);
        return null;
      });
    cache.set(parishId, pending);
  }
  return pending;
}

const dataCurta = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export type StartTrialResult = 'started' | 'already-used' | 'not-needed' | 'error';

/**
 * Estado do teste da paróquia e a ação de iniciar.
 * - `autoLoad: false` para a tela que já tem o /billing/me em mãos (Meu plano);
 * - `start()` trata os 409 do contrato e recarrega os entitlements (o menu e as
 *   rotas destravam sozinhos quando o teste começa).
 */
export function usePlanTrial(parishId: string | null | undefined, options: { autoLoad?: boolean } = {}) {
  const autoLoad = options.autoLoad !== false;
  const [trial, setTrial] = useState<PlanTrialInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!parishId || !autoLoad) {
      setTrial(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    void loadTrial(parishId).then((info) => {
      if (!alive) return;
      setTrial(info);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [parishId, autoLoad]);

  const start = useCallback(async (): Promise<StartTrialResult> => {
    if (!parishId) return 'error';
    setStarting(true);
    const used = (endsAt: string | null): PlanTrialInfo => ({ available: false, usedAt: new Date().toISOString(), endsAt });
    const remember = (info: PlanTrialInfo) => {
      cache.set(parishId, Promise.resolve(info));
      setTrial(info);
    };
    try {
      const { data } = await api.post('/billing/trial', { parishId });
      const endsAt = typeof data?.trialEndsAt === 'string' ? data.trialEndsAt : null;
      const count = typeof data?.communities === 'number' ? data.communities : null;
      remember(used(endsAt));
      notify.success(
        `Teste iniciado${count ? ` em ${count} ${count === 1 ? 'comunidade' : 'comunidades'}` : ''}: o plano completo fica liberado${endsAt ? ` até ${dataCurta(endsAt)}` : ' por 30 dias'}.`,
      );
      reloadPlanEntitlements();
      return 'started';
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const code = axios.isAxiosError(error) ? (error.response?.data as { code?: unknown } | undefined)?.code : undefined;
      if (status === 409 && code === 'TRIAL_ALREADY_USED') {
        remember(used(null));
        notify.info('O teste de 30 dias desta paróquia já foi usado. Para continuar com o plano completo, veja os planos em "Meu plano".');
        return 'already-used';
      }
      if (status === 409 && code === 'TRIAL_NOT_NEEDED') {
        remember({ available: false, usedAt: null, endsAt: null });
        // Piloto / tudo com acesso / bloqueio por plano desligado: nada foi gasto (o servidor explica o motivo)
        notify.info(
          getErrorMessage(
            error,
            'Todos os recursos já estão liberados para esta paróquia no momento. O teste não foi usado e continua guardado.',
          ),
        );
        reloadPlanEntitlements();
        return 'not-needed';
      }
      notify.error(
        status === 404
          ? 'O teste por pedido ainda não está no ar no servidor. Tente de novo mais tarde.'
          : getErrorMessage(error, 'Não foi possível iniciar o teste agora.'),
      );
      return 'error';
    } finally {
      setStarting(false);
    }
  }, [parishId]);

  return { trial, loading, starting, start };
}
