import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '../../services/api';
import { notify } from '../../services/notification.service';
import './team.css';

/**
 * "Primeiros passos" no Início do PARISH_ADMIN (Onda 1 — C5; saas-implantacao-08,
 * ux-dashboards-10). O progresso é calculado no backend a partir dos dados
 * reais; some quando dispensado ou com tudo feito.
 */

interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  count?: number | null;
  href?: string | null;
}

interface Checklist {
  dismissed: boolean;
  progress: { done: number; total: number };
  items: ChecklistItem[];
}

/** Destinos no painel quando o item não traz `href` (ou traz um caminho do app). */
const FALLBACK_HREF: Record<string, string> = {
  communities: '/admin/communities',
  massSchedules: '/admin/fixed-schedule',
  pastorals: '/admin/pastorals/community',
  team: '/admin/users',
  members: '/admin/importar',
  pix: '/admin/finance',
  catechesis: '/admin/catechesis',
  billing: '/admin/meu-plano',
};

const OnboardingChecklistCard: React.FC<{ parishId: string }> = ({ parishId }) => {
  const navigate = useNavigate();
  const [data, setData] = useState<Checklist | null>(null);
  const [dismissing, setDismissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get<Checklist>('/onboarding/checklist', { params: { parishId } });
      setData(body && Array.isArray(body.items) ? body : null);
    } catch {
      // Servidor sem o checklist (ou falha momentânea): o Início segue sem o cartão
      setData(null);
    }
  }, [parishId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data || data.dismissed || data.items.length === 0) return null;

  const total = data.progress?.total || data.items.length;
  const done = data.progress?.done ?? data.items.filter((item) => item.done).length;
  if (total > 0 && done >= total) return null;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  const open = (item: ChecklistItem) => {
    const href = item.href && item.href.startsWith('/admin') ? item.href : FALLBACK_HREF[item.key] ?? item.href;
    if (!href) return;
    if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
    else navigate(href);
  };

  const dismiss = async () => {
    setDismissing(true);
    try {
      await api.post('/onboarding/dismiss', { parishId });
      setData((current) => (current ? { ...current, dismissed: true } : current));
      notify.info('Primeiros passos dispensados. Os atalhos continuam no menu.');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Não foi possível dispensar agora'));
    } finally {
      setDismissing(false);
    }
  };

  return (
    <section className="onb-card" aria-labelledby="onb-title">
      <div className="onb-card__head">
        <div>
          <h2 id="onb-title" className="onb-card__title">
            Primeiros passos da paróquia
          </h2>
          <p className="onb-card__subtitle">
            {done} de {total} concluídos — cada item leva direto à tela certa.
          </p>
        </div>
        <button type="button" className="team-btn is-small" onClick={() => void dismiss()} disabled={dismissing}>
          {dismissing ? 'Dispensando…' : 'Dispensar'}
        </button>
      </div>
      <div
        className="onb-progress"
        role="progressbar"
        aria-label="Progresso dos primeiros passos"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${done} de ${total} concluídos`}
      >
        <div className="onb-progress__bar" style={{ width: `${percent}%` }} />
      </div>
      <ul className="onb-list">
        {data.items.map((item) => (
          <li key={item.key}>
            <button type="button" className={`onb-item${item.done ? ' is-done' : ''}`} onClick={() => open(item)}>
              <span className="onb-item__check" aria-hidden="true">
                {item.done ? '✓' : ''}
              </span>
              <span className="onb-item__label">
                {item.label}
                <span className="sr-only">{item.done ? ' (concluído)' : ' (pendente)'}</span>
              </span>
              {typeof item.count === 'number' && item.count > 0 && <span className="onb-item__count">{item.count}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default OnboardingChecklistCard;
