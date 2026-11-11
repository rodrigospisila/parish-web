import React, { useEffect, useState } from 'react';
import api from '../../services/api';

/**
 * Preços do plano completo no site: faixas lidas de GET /public/plans
 * (PlanTier ativos). Preço por comunidade; anual = 10 mensalidades. O plano
 * grátis não tem faixa nem prazo, e o teste de 30 dias do completo é pedido
 * pelo painel (não começa sozinho). Sem a
 * rota (servidor antigo/fora do ar), a seção mostra "sob consulta" e leva ao
 * pedido de demonstração — nunca inventa preço.
 */

export interface PublicTier {
  key: string;
  name: string;
  description?: string | null;
  maxMembers: number | null;
  monthlyPriceCents: number | null;
  yearlyPriceCents: number | null;
}

export interface PublicPlans {
  trialDays: number;
  tiers: PublicTier[];
}

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const inteiro = new Intl.NumberFormat('pt-BR');

export const precoBR = (cents: number | null | undefined) =>
  typeof cents === 'number' && Number.isFinite(cents) ? moeda.format(cents / 100) : '—';

export const limiteMembros = (max: number | null | undefined) =>
  typeof max === 'number' && max > 0 ? `até ${inteiro.format(max)} membros ativos` : 'membros ativos sem limite';

/** Lê e saneia a resposta (campos ausentes não quebram a tela). */
export function parsePublicPlans(data: unknown): PublicPlans | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as { trialDays?: unknown; tiers?: unknown };
  const tiers = Array.isArray(raw.tiers)
    ? raw.tiers
        .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object' && typeof (t as { key?: unknown }).key === 'string')
        .map((t) => ({
          key: String(t.key),
          name: typeof t.name === 'string' ? t.name : String(t.key),
          description: typeof t.description === 'string' ? t.description : null,
          maxMembers: typeof t.maxMembers === 'number' ? t.maxMembers : null,
          monthlyPriceCents: typeof t.monthlyPriceCents === 'number' ? t.monthlyPriceCents : null,
          yearlyPriceCents: typeof t.yearlyPriceCents === 'number' ? t.yearlyPriceCents : null,
        }))
    : [];
  return { trialDays: typeof raw.trialDays === 'number' && raw.trialDays > 0 ? raw.trialDays : 30, tiers };
}

type Ciclo = 'MONTHLY' | 'YEARLY';

interface Props {
  onRequestDemo: () => void;
  /** Leva à busca da paróquia (a entrada é sempre pela reivindicação) */
  onFindParish?: () => void;
}

const PricingSection: React.FC<Props> = ({ onRequestDemo, onFindParish }) => {
  const [plans, setPlans] = useState<PublicPlans | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [ciclo, setCiclo] = useState<Ciclo>('MONTHLY');

  useEffect(() => {
    let ativo = true;
    api
      .get('/public/plans', { timeout: 10_000 })
      .then(({ data }) => {
        if (!ativo) return;
        const parsed = parsePublicPlans(data);
        setPlans(parsed);
        setStatus(parsed && parsed.tiers.length ? 'ok' : 'error');
      })
      .catch(() => {
        if (ativo) setStatus('error');
      });
    return () => {
      ativo = false;
    };
  }, []);

  const trialDays = plans?.trialDays ?? 30;
  const tiers = plans?.tiers ?? [];

  return (
    <section className="lp-section lp-pricing" id="planos" aria-labelledby="lp-planos-titulo">
      <div className="lp-container">
        <p className="lp-kicker">Planos e preços</p>
        <h2 id="lp-planos-titulo" className="lp-h2">
          Grátis para começar. Completo por comunidade.
        </h2>
        <p className="lp-lead">
          O plano grátis não tem mensalidade nem prazo. No plano completo, cada comunidade escolhe a faixa pelo número
          de membros ativos; no anual, você paga 10 meses e usa 12. O fiel não paga nada.
        </p>

        <div className="lp-card lp-plano-gratis">
          <div>
            <h3 className="lp-tier-nome">Plano grátis</h3>
            <p className="lp-tier-preco">
              <strong>R$ 0</strong>
              <span>para toda paróquia, sem prazo</span>
            </p>
            <p className="lp-tier-desc">
              Horários de missa e de confissão, "não haverá" por data, cadastro de membros sem limite e localização
              das igrejas.
            </p>
          </div>
          <button type="button" className="lp-btn lp-btn-primary" onClick={onFindParish ?? onRequestDemo}>
            Encontrar minha paróquia
          </button>
        </div>

        <h3 className="lp-h3 lp-planos-sub">Plano completo</h3>

        <div className="lp-ciclo" role="group" aria-label="Ciclo de pagamento">
          <button type="button" className={ciclo === 'MONTHLY' ? 'on' : ''} aria-pressed={ciclo === 'MONTHLY'} onClick={() => setCiclo('MONTHLY')}>
            Mensal
          </button>
          <button type="button" className={ciclo === 'YEARLY' ? 'on' : ''} aria-pressed={ciclo === 'YEARLY'} onClick={() => setCiclo('YEARLY')}>
            Anual <span className="lp-ciclo-selo">2 meses grátis</span>
          </button>
        </div>

        {status === 'loading' && (
          <p className="lp-muted" role="status">
            Carregando os planos…
          </p>
        )}

        {status === 'error' && (
          <div className="lp-card lp-pricing-fallback">
            <p>
              Os preços estão sendo atualizados. Peça uma demonstração e mandamos a proposta para a sua paróquia.
            </p>
            <button type="button" className="lp-btn lp-btn-primary" onClick={onRequestDemo}>
              Pedir demonstração
            </button>
          </div>
        )}

        {status === 'ok' && (
          <ul className="lp-tiers" aria-label="Faixas do plano">
            {tiers.map((t, i) => {
              const mensal = t.monthlyPriceCents;
              const anual = t.yearlyPriceCents ?? (typeof mensal === 'number' ? mensal * 10 : null);
              const destaque = tiers.length >= 3 && i === 1;
              return (
                <li key={t.key} className={`lp-card lp-tier${destaque ? ' lp-tier-destaque' : ''}`}>
                  {destaque && <span className="lp-tier-selo">Mais escolhido</span>}
                  <h3 className="lp-tier-nome">{t.name}</h3>
                  <p className="lp-tier-limite">{limiteMembros(t.maxMembers)}</p>
                  {ciclo === 'MONTHLY' ? (
                    <p className="lp-tier-preco">
                      <strong>{precoBR(mensal)}</strong>
                      <span>/mês por comunidade</span>
                    </p>
                  ) : (
                    <p className="lp-tier-preco">
                      <strong>{precoBR(anual)}</strong>
                      <span>/ano por comunidade</span>
                    </p>
                  )}
                  {ciclo === 'YEARLY' && typeof mensal === 'number' && typeof anual === 'number' && mensal * 12 > anual && (
                    <p className="lp-tier-economia">Economia de {precoBR(mensal * 12 - anual)} no ano</p>
                  )}
                  {t.description && <p className="lp-tier-desc">{t.description}</p>}
                  <button type="button" className={`lp-btn ${destaque ? 'lp-btn-primary' : 'lp-btn-outline'}`} onClick={onRequestDemo}>
                    Pedir demonstração
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="lp-teste" role="note">
          <h3 className="lp-h3">Teste o plano completo por {trialDays} dias, quando quiser</h3>
          <p>
            O teste não começa sozinho: o administrador da paróquia pede pelo painel, no momento em que a equipe
            estiver pronta para experimentar. Vale uma vez por paróquia, para todas as comunidades, sem cartão.
          </p>
        </div>
        <p className="lp-muted lp-centro">
          Pagamento por Pix, boleto ou cartão. Se o teste acabar ou o pagamento parar, a comunidade volta para o plano
          grátis e nenhum dado é apagado.
        </p>
      </div>
    </section>
  );
};

export default PricingSection;
