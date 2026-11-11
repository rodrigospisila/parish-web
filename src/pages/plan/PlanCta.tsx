import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canOfferTrial, usePlanTrial } from '../../hooks/usePlanTrial';
import { usePlanEntitlements } from '../../hooks/usePlanEntitlements';
import { MY_PLAN_PATH } from '../../services/planErrors';
import { COORDINATION_ROLES } from '../../components/accessRules';
import { TRIAL_DAYS } from './featureCatalog';
import '../modules/ModulePages.css';
import './plan.css';

/**
 * Confirmação do teste: ele começa a contar na hora e só pode ser pedido UMA
 * vez por paróquia — por isso não inicia com um clique só.
 */
export const TrialConfirmDialog: React.FC<{
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}> = ({ busy, onConfirm, onClose }) => {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return (
    <div className="module-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="module-modal planv-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>Começar o teste de {TRIAL_DAYS} dias?</h2>
        <p>
          Todas as comunidades ativas da paróquia ficam com o <strong>plano completo liberado por {TRIAL_DAYS} dias</strong>, a
          partir de agora. Não pedimos cartão e nada é cobrado.
        </p>
        <p>
          O teste pode ser pedido <strong>uma única vez por paróquia</strong>. Quando terminar, as comunidades voltam ao plano
          grátis — nenhum dado é apagado — e você decide se contrata.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn-cancel" onClick={onClose} disabled={busy}>
            Agora não
          </button>
          <button ref={confirmRef} type="button" className="btn-submit" onClick={onConfirm} disabled={busy} aria-busy={busy}>
            {busy ? 'Iniciando…' : 'Começar o teste'}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Chamada para ação das vitrines: "Testar grátis por 30 dias" (PARISH_ADMIN da
 * paróquia, se o teste ainda está disponível) e "Ver planos". Quem não
 * administra a paróquia vê a orientação de pedir ao responsável.
 */
const PlanCta: React.FC<{ align?: 'start' | 'center' }> = ({ align = 'start' }) => {
  const { user } = useAuth();
  const role = user?.role ?? '';
  const isParishAdmin = role === 'PARISH_ADMIN' && !!user?.parishId;
  const seesPlans = isParishAdmin || role === 'DIOCESAN_ADMIN' || role === 'SYSTEM_ADMIN';
  const { trial, starting, start } = usePlanTrial(isParishAdmin ? user?.parishId : null);
  const { entitlements } = usePlanEntitlements();
  // Só com o bloqueio por plano ligado: fora dele o pedido gastaria o teste único sem liberar nada
  const offerTrial = isParishAdmin && canOfferTrial(entitlements?.enforcement, trial);
  const [confirming, setConfirming] = useState(false);

  if (!seesPlans) {
    const isTeam = (COORDINATION_ROLES as readonly string[]).includes(role);
    return (
      <div className={`planv-cta planv-cta--${align}`}>
        <p className="planv-cta__ask" role="note">
          <strong>Peça ao responsável pela paróquia.</strong>{' '}
          {isTeam
            ? `Quem administra a paróquia no Parish pode testar o plano completo por ${TRIAL_DAYS} dias, sem custo, ou contratar.`
            : 'Este recurso ainda não está ativo nesta comunidade.'}
        </p>
      </div>
    );
  }

  const confirm = async () => {
    await start();
    setConfirming(false);
  };

  return (
    <div className={`planv-cta planv-cta--${align}`}>
      <div className="planv-cta__buttons">
        {offerTrial && (
          <button type="button" className="planv-btn planv-btn--primary" onClick={() => setConfirming(true)} disabled={starting}>
            Testar grátis por {TRIAL_DAYS} dias
          </button>
        )}
        <Link to={MY_PLAN_PATH} className={`planv-btn ${offerTrial ? 'planv-btn--ghost' : 'planv-btn--primary'}`}>
          Ver planos
        </Link>
      </div>
      {offerTrial && (
        <p className="planv-cta__hint">Sem cartão. Uma vez por paróquia; vale para todas as comunidades.</p>
      )}
      {isParishAdmin && trial && !trial.available && trial.usedAt && (
        <p className="planv-cta__hint">O teste de {TRIAL_DAYS} dias desta paróquia já foi usado.</p>
      )}
      {role === 'DIOCESAN_ADMIN' && (
        <p className="planv-cta__hint">O teste de {TRIAL_DAYS} dias é pedido pela administração de cada paróquia.</p>
      )}
      {confirming && offerTrial && <TrialConfirmDialog busy={starting} onConfirm={() => void confirm()} onClose={() => setConfirming(false)} />}
    </div>
  );
};

export default PlanCta;
