import React, { useEffect, useState } from 'react';
import api from '../../services/api';

/**
 * Planos do site (saas-implantacao-14): faixas lidas de GET /public/plans
 * (PlanTier ativos). Preço por comunidade; anual = 10 mensalidades. Sem a
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

/** Recursos que o plano libera e o que é grátis para sempre (decisão de produto). */
export const RECURSOS_DO_PLANO = [
  'Pastorais e escalas, com confirmação e trocas pelo app',
  'Catequese: inscrição pela família, turmas e chamada',
  'Formação, salas e espaços',
  'Visitas pastorais',
  'Documentos e certidões',
];

export const RECURSOS_GRATIS = [
  'Calendário e eventos da comunidade',
  'Mapa e horários de missa',
  'Liturgia do dia',
  'App do fiel: o fiel nunca paga',
];

type Ciclo = 'MONTHLY' | 'YEARLY';

interface Props {
  onRequestDemo: () => void;
}

const PricingSection: React.FC<Props> = ({ onRequestDemo }) => {
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
        <p className="lp-kicker">Planos</p>
        <h2 id="lp-planos-titulo" className="lp-h2">
          Preço por comunidade, com {trialDays} dias de teste
        </h2>
        <p className="lp-lead">
          Cada comunidade escolhe a faixa pelo número de membros ativos. No plano anual, você paga 10 meses e usa 12.
          O fiel não paga nada.
        </p>

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
                    Começar o teste grátis
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="lp-incluso">
          <div className="lp-card">
            <h3 className="lp-h3">O plano libera</h3>
            <ul className="lp-check">
              {RECURSOS_DO_PLANO.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <div className="lp-card lp-card-gratis">
            <h3 className="lp-h3">Grátis para sempre</h3>
            <ul className="lp-check">
              {RECURSOS_GRATIS.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="lp-muted lp-centro">
          Teste de {trialDays} dias sem cartão. Pagamento por Pix, boleto ou cartão. Se o pagamento
          parar, os recursos do plano ficam suspensos, mas nenhum dado é apagado.
        </p>
      </div>
    </section>
  );
};

export default PricingSection;
