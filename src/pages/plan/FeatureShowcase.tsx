import React from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useModuleAccess } from '../../hooks/useModuleAccess';
import { usePlanEntitlements } from '../../hooks/usePlanEntitlements';
import { COORDINATION_ROLES, canOpen, coordinatesAnyPastoral } from '../../components/accessRules';
import { PLAN_FEATURES_PATH } from '../../services/planErrors';
import { FREE_PLAN_ITEMS, featureInfo } from './featureCatalog';
import PlanCta from './PlanCta';
import './plan.css';

/**
 * Vitrine de um recurso do plano completo: o que ele faz e como ativar.
 * Aparece no lugar da tela quando o recurso está bloqueado (guarda `PlanGate`
 * no App.tsx) e em /admin/recursos/:feature (menu "Recursos do plano").
 */
const FeatureShowcase: React.FC<{ feature: string }> = ({ feature }) => {
  const { user } = useAuth();
  const { modOn } = useModuleAccess(user?.role);
  const { isLocked, ready } = usePlanEntitlements();
  const info = featureInfo(feature);
  const seesIndex = (COORDINATION_ROLES as readonly string[]).includes(user?.role ?? '') || coordinatesAnyPastoral(user);

  if (!info) return <Navigate to={PLAN_FEATURES_PATH} replace />;

  const locked = isLocked(info.key);
  // Recurso ativo: o botão leva à tela (a primeira que o papel consegue abrir)
  const openKey = !locked ? info.routes.find((key) => canOpen(user, key, modOn)) : undefined;
  const titleId = `planv-title-${info.key}`;

  return (
    <div className="planv-page">
      {seesIndex && (
        <nav aria-label="Navegação dos recursos">
          <Link to={PLAN_FEATURES_PATH} className="planv-back">
            <span aria-hidden="true">←</span> Todos os recursos do plano
          </Link>
        </nav>
      )}

      <article className="planv-show" aria-labelledby={titleId}>
        <header className="planv-show__head">
          <img className="planv-show__icon" src={`/title-icons/${info.icon}.svg`} alt="" aria-hidden="true" width={64} height={64} />
          <div className="planv-show__intro">
            {ready && (
              <span className={`planv-badge ${locked ? 'planv-badge--plan' : 'planv-badge--on'}`}>
                {locked ? 'Recurso do plano completo' : 'Ativo na sua comunidade'}
              </span>
            )}
            <h1 id={titleId} className="planv-show__title">
              {info.name}
            </h1>
            <p className="planv-show__tagline">{info.tagline}</p>
          </div>
        </header>

        <section aria-label={`O que ${info.name} faz`}>
          <h2 className="planv-show__subtitle">O que você faz com este recurso</h2>
          <ul className="planv-bullets">
            {info.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
          {info.where && <p className="planv-show__where">{info.where}</p>}
        </section>

        <footer className="planv-show__foot">
          {!ready ? null : locked ? (
            <>
              <p className="planv-show__state">
                Sua comunidade está no <strong>plano grátis</strong>. Este recurso faz parte do plano completo.
              </p>
              <PlanCta />
            </>
          ) : openKey ? (
            <Link to={`/admin/${openKey}`} className="planv-btn planv-btn--primary">
              Abrir {info.name}
            </Link>
          ) : (
            <p className="planv-show__state">Este recurso já está ativo na sua comunidade.</p>
          )}
        </footer>
      </article>

      {ready && locked && (
        <aside className="planv-free" aria-label="O que continua liberado no plano grátis">
          <h2 className="planv-free__title">Continua liberado no plano grátis</h2>
          <ul className="planv-free__list">
            {FREE_PLAN_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
};

/** Rota /admin/recursos/:feature. */
export const FeatureShowcasePage: React.FC = () => {
  const { feature } = useParams();
  return <FeatureShowcase feature={feature ?? ''} />;
};

export default FeatureShowcase;
