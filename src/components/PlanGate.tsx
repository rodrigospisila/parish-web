import React, { useEffect, useState } from 'react';
import { usePlanEntitlements } from '../hooks/usePlanEntitlements';
import { PLAN_REQUIRED_EVENT, type PlanRequiredDetail } from '../services/planErrors';
import FeatureShowcase from '../pages/plan/FeatureShowcase';

/**
 * Guarda de rota do plano: recurso pago BLOQUEADO (modo "on" + comunidade sem
 * acesso) mostra a vitrine do recurso no lugar da tela — inclusive para quem
 * chega pela URL. Enquanto os entitlements carregam, mostra `fallback` (o
 * carregando de rota), para a vitrine não piscar em quem tem o plano.
 * Fora do modo "on", com acesso (piloto, teste, pagante) ou SYSTEM_ADMIN, o
 * backend manda tudo liberado e a tela abre como sempre.
 *
 * Modo SUAVE (`soft`, ou recurso de nível paróquia para quem não administra a
 * paróquia): o /me/entitlements é o "tudo ou nada" da comunidade principal,
 * mas o backend libera as rotas "minhas" (catequista com turma em comunidade
 * com plano, a própria escala, as próprias pastorais) e os recursos de nível
 * paróquia quando outra comunidade tem plano. Nesses casos a tela ABRE e a
 * vitrine só entra se uma chamada deste recurso devolver 403 PLAN_REQUIRED.
 */
const PlanGate: React.FC<{ feature: string; soft?: boolean; fallback?: React.ReactNode; children: React.ReactNode }> = ({
  feature,
  soft = false,
  fallback = null,
  children,
}) => {
  const { isLocked, isSoftLocked, baseLocked, ready } = usePlanEntitlements();
  // O backend recusou este recurso nesta tela (403 PLAN_REQUIRED com a mesma chave)
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    setDenied(false);
    const onPlanError = (event: Event) => {
      const detail = (event as CustomEvent<PlanRequiredDetail>).detail;
      if (detail?.code === 'PLAN_REQUIRED' && detail.feature === feature) setDenied(true);
    };
    window.addEventListener(PLAN_REQUIRED_EVENT, onPlanError);
    return () => window.removeEventListener(PLAN_REQUIRED_EVENT, onPlanError);
  }, [feature]);

  // Rota "minha": abre já (sem esperar os entitlements); a vitrine depende do 403
  if (soft) {
    return denied && ready && baseLocked(feature) ? <FeatureShowcase feature={feature} forceLocked /> : <>{children}</>;
  }
  if (!ready) return <>{fallback}</>;
  if (isLocked(feature)) return <FeatureShowcase feature={feature} />;
  if (isSoftLocked(feature) && denied) return <FeatureShowcase feature={feature} forceLocked />;
  return <>{children}</>;
};

export default PlanGate;
