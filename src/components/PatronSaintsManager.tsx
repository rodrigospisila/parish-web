import React, { useState, useEffect, useCallback } from 'react';
import api, { getErrorMessage } from '../services/api';
import { notify, confirm } from '../services/notification.service';
import SaintAvatar from './SaintAvatar';
import '../pages/modules/ModulePages.css';

/**
 * Gerenciador de santos padroeiros de uma entidade (diocese, paróquia ou
 * comunidade). Abre como modal a partir do card da entidade: lista os
 * padroeiros vinculados, vincula um santo do catálogo e remove vínculos.
 */

export type PatronLevel = 'diocese' | 'parish' | 'community';

export interface PatronSaint {
  id: string; // id do vínculo (SaintPatronage)
  isPrimary: boolean;
  notes?: string | null;
  saint: { id: string; name: string; imageUrl?: string | null; feastMonth?: number | null; feastDay?: number | null };
}

interface CatalogSaint {
  id: string;
  name: string;
  imageUrl?: string | null;
  feastMonth?: number | null;
  feastDay?: number | null;
  patronOf?: string | null;
}

const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function feastShort(saint: { feastMonth?: number | null; feastDay?: number | null }): string | null {
  if (!saint.feastMonth || !saint.feastDay) return null;
  return `${String(saint.feastDay).padStart(2, '0')} ${MONTHS_SHORT[saint.feastMonth - 1]}`;
}

/** Busca sem acento: "jose" encontra "José". */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

interface PatronSaintsManagerProps {
  level: PatronLevel;
  entityId: string;
  entityName: string;
  /** Chamado ao fechar; sinaliza se houve alteração (para a página recarregar os cards) */
  onClose: (changed: boolean) => void;
}

const LEVEL_PARAM: Record<PatronLevel, string> = {
  diocese: 'dioceseId',
  parish: 'parishId',
  community: 'communityId',
};

/**
 * Carrega TODOS os padroados de um nível numa única requisição e agrupa por
 * entidade — para as páginas de Dioceses/Paróquias/Comunidades exibirem o
 * padroeiro nos cards sem uma chamada por card.
 */
export function usePatronSaints(level: PatronLevel) {
  const [patronsByEntity, setPatronsByEntity] = useState<Record<string, PatronSaint[]>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await api.get('/saints/patronages', { params: { level } });
      const map: Record<string, PatronSaint[]> = {};
      for (const p of res.data as Array<PatronSaint & { dioceseId?: string | null; parishId?: string | null; communityId?: string | null }>) {
        const key = p.dioceseId ?? p.parishId ?? p.communityId;
        if (!key) continue;
        (map[key] ??= []).push(p);
      }
      setPatronsByEntity(map);
    } catch {
      setPatronsByEntity({});
    }
  }, [level]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { patronsByEntity, refresh };
}

/** Chips com avatar + nome dos padroeiros de uma entidade (para os cards). */
export const PatronSaintsBadge: React.FC<{ patrons?: PatronSaint[] }> = ({ patrons }) => {
  if (!patrons?.length) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', margin: '0.5rem 0' }}>
      {patrons.map((p) => (
        <span
          key={p.id}
          title={p.isPrimary ? 'Padroeiro principal' : 'Co-padroeiro'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            background: '#f4f6f8',
            borderRadius: 20,
            padding: '0.15rem 0.65rem 0.15rem 0.15rem',
            fontSize: '0.82rem',
            color: '#444',
          }}
        >
          <SaintAvatar saint={p.saint} small />
          🕊️ {p.saint.name}
        </span>
      ))}
    </div>
  );
};

const PatronSaintsManager: React.FC<PatronSaintsManagerProps> = ({ level, entityId, entityName, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [patronages, setPatronages] = useState<PatronSaint[]>([]);
  const [catalog, setCatalog] = useState<CatalogSaint[]>([]);
  const [changed, setChanged] = useState(false);
  const [form, setForm] = useState({ saintId: '', isPrimary: true });
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchPatronages = useCallback(async () => {
    try {
      const res = await api.get('/saints/patronages', { params: { [LEVEL_PARAM[level]]: entityId } });
      setPatronages(res.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar padroeiros'));
    } finally {
      setLoading(false);
    }
  }, [level, entityId]);

  useEffect(() => {
    fetchPatronages();
    api.get('/saints').then((res) => setCatalog(res.data)).catch(() => setCatalog([]));
  }, [fetchPatronages]);

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.saintId) return;
    setSubmitting(true);
    try {
      await api.post(`/saints/${form.saintId}/patronages`, {
        [LEVEL_PARAM[level]]: entityId,
        isPrimary: form.isPrimary,
      });
      notify.success('Padroeiro vinculado!');
      setForm({ saintId: '', isPrimary: false });
      setSearch('');
      setChanged(true);
      fetchPatronages();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao vincular padroeiro'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnlink = async (patronage: PatronSaint) => {
    const confirmed = await confirm.delete(`o vínculo com ${patronage.saint.name}`);
    if (!confirmed) return;
    try {
      await api.delete(`/saints/patronages/${patronage.id}`);
      notify.success('Vínculo removido.');
      setChanged(true);
      fetchPatronages();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao remover vínculo'));
    }
  };

  const linkedIds = new Set(patronages.map((p) => p.saint.id));
  const feast = (saint: PatronSaint['saint']) =>
    saint.feastMonth && saint.feastDay
      ? `${String(saint.feastDay).padStart(2, '0')}/${String(saint.feastMonth).padStart(2, '0')}`
      : null;

  return (
    <div className="module-modal-overlay" onClick={() => onClose(changed)}>
      <div className="module-modal" onClick={(e) => e.stopPropagation()}>
        <h2>🕊️ Padroeiros — {entityName}</h2>

        {loading ? (
          <div className="loading">Carregando...</div>
        ) : (
          <>
            {patronages.length === 0 && (
              <p style={{ color: '#888', marginBottom: '1rem' }}>Nenhum santo vinculado ainda.</p>
            )}
            {patronages.map((patronage) => (
              <div
                key={patronage.id}
                style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0', borderBottom: '1px solid #f0f0f0' }}
              >
                <SaintAvatar saint={patronage.saint} small />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{patronage.saint.name}</strong>
                  <div style={{ fontSize: '0.82rem', color: '#777' }}>
                    {patronage.isPrimary ? 'Padroeiro principal' : 'Co-padroeiro'}
                    {feast(patronage.saint) ? ` · festa ${feast(patronage.saint)}` : ''}
                  </div>
                </div>
                <button className="btn-small danger" onClick={() => handleUnlink(patronage)}>Remover</button>
              </div>
            ))}
          </>
        )}

        <form onSubmit={handleLink} style={{ marginTop: '1.25rem' }}>
          <div className="form-group">
            <label>Vincular santo do catálogo</label>
            <input
              type="text"
              className="saint-picker-search"
              placeholder="Buscar santo... (ex.: rita, aparecida)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="saint-picker-list">
              {(() => {
                const available = catalog
                  .filter((s) => !linkedIds.has(s.id))
                  .filter((s) => !search.trim() || normalize(s.name).includes(normalize(search)))
                  .sort((a, b) => a.name.localeCompare(b.name));
                if (available.length === 0) {
                  return <div className="saint-picker-empty">Nenhum santo encontrado para "{search}".</div>;
                }
                return available.map((s) => {
                  const selected = form.saintId === s.id;
                  const meta = [feastShort(s) ? `festa ${feastShort(s)}` : null, s.patronOf ? `padroeiro(a) ${s.patronOf}` : null]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`saint-picker-item ${selected ? 'selected' : ''}`}
                      onClick={() => setForm({ ...form, saintId: selected ? '' : s.id })}
                    >
                      <SaintAvatar saint={s} small />
                      <span className="picker-info">
                        <span className="picker-name">{s.name}</span>
                        {meta && <span className="picker-meta" style={{ display: 'block' }}>{meta}</span>}
                      </span>
                      {selected && <span className="picker-check">✓</span>}
                    </button>
                  );
                });
              })()}
            </div>
          </div>
          <label className="form-check">
            <input
              type="checkbox"
              checked={form.isPrimary}
              onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })}
            />
            Padroeiro principal (desmarque para co-padroeiro)
          </label>
          <div className="modal-actions">
            <button type="button" className="btn-cancel" onClick={() => onClose(changed)}>Fechar</button>
            <button type="submit" className="btn-submit" disabled={submitting || !form.saintId}>
              {submitting ? 'Vinculando...' : 'Vincular'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PatronSaintsManager;
