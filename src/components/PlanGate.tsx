import React from 'react';
import { usePlanEntitlements } from '../hooks/usePlanEntitlements';
import FeatureShowcase from '../pages/plan/FeatureShowcase';

/**
 * Guarda de rota do plano: recurso pago BLOQUEADO (modo "on" + comunidade sem
 * acesso) mostra a vitrine do recurso no lugar da tela — inclusive para quem
 * chega pela URL. Enquanto os entitlements carregam, mostra `fallback` (o
 * carregando de rota), para a vitrine não piscar em quem tem o plano.
 * Fora do modo "on", com acesso (piloto, teste, pagante) ou SYSTEM_ADMIN, o
 * backend manda tudo liberado e a tela abre como sempre.
 */
const PlanGate: React.FC<{ feature: string; fallback?: React.ReactNode; children: React.ReactNode }> = ({
  feature,
  fallback = null,
  children,
}) => {
  const { isLocked, ready } = usePlanEntitlements();
  if (!ready) return <>{fallback}</>;
  if (isLocked(feature)) return <FeatureShowcase feature={feature} />;
  return <>{children}</>;
};

export default PlanGate;
