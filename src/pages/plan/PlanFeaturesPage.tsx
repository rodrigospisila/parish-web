import React from 'react';
import { Link } from 'react-router-dom';
import TitleIcon from '../../components/TitleIcon';
import { usePlanEntitlements } from '../../hooks/usePlanEntitlements';
import { planFeaturePath } from '../../services/planErrors';
import { FEATURE_CATALOG, FREE_PLAN_FAITHFUL_ITEMS, FREE_PLAN_ITEMS } from './featureCatalog';
import PlanCta from './PlanCta';
import './plan.css';

/**
 * /admin/recursos — todos os recursos do plano completo em cartões (a
 * "propaganda" dentro do painel). Cada cartão abre a vitrine do recurso.
 */
const PlanFeaturesPage: React.FC = () => {
  const { entitlements, isLocked, anyLocked, ready } = usePlanEntitlements();
  // Só o que o servidor trata como pago (lista do backend); sem resposta, o catálogo inteiro
  const paid = entitlements?.paidFeatures;
  const features = paid ? FEATURE_CATALOG.filter((feature) => paid.includes(feature.key)) : FEATURE_CATALOG;

  return (
    <div className="planv-page">
      <header className="planv-index__head">
        <h1 className="planv-index__title">
          <TitleIcon name="igreja" /> Recursos do plano completo
        </h1>
        <p className="planv-index__lead">
          {ready && !anyLocked
            ? 'Sua comunidade tem o plano completo: tudo abaixo já está liberado.'
            : 'O plano grátis cuida do cadastro e dos horários. O plano completo organiza a vida pastoral inteira da comunidade — das escalas à catequese, do dízimo aos sacramentos.'}
        </p>
        {ready && anyLocked && <PlanCta />}
      </header>

      <ul className="planv-grid" aria-label="Recursos do plano completo">
        {features.map((feature) => {
          const locked = isLocked(feature.key);
          return (
            <li key={feature.key}>
              <Link to={planFeaturePath(feature.key)} className="planv-card">
                <span className="planv-card__top">
                  <img src={`/title-icons/${feature.icon}.svg`} alt="" aria-hidden="true" width={40} height={40} className="planv-card__icon" />
                  {ready && (
                    <span className={`planv-badge ${locked ? 'planv-badge--plan' : 'planv-badge--on'}`}>{locked ? 'Plano completo' : 'Ativo'}</span>
                  )}
                </span>
                <span className="planv-card__name">{feature.name}</span>
                <span className="planv-card__text">{feature.tagline}</span>
                <span className="planv-card__more">
                  Ver o que faz <span aria-hidden="true">→</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <section className="planv-free planv-free--two" aria-labelledby="planv-free-title">
        <h2 id="planv-free-title" className="planv-free__title">
          Sempre grátis
        </h2>
        <div className="planv-free__cols">
          <div>
            <h3 className="planv-free__sub">Para a equipe da paróquia</h3>
            <ul className="planv-free__list">
              {FREE_PLAN_ITEMS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="planv-free__sub">Para os fiéis, no aplicativo</h3>
            <ul className="planv-free__list">
              {FREE_PLAN_FAITHFUL_ITEMS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="planv-free__note">O fiel nunca paga.</p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default PlanFeaturesPage;
