import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api, { getErrorMessage } from '../../services/api';
import { DateInput } from '../../components/DateInput';
import './ScheduleSuspensions.css';

/**
 * Suspensão de horários fixos por data ("não haverá").
 *
 * A secretaria marca que um horário da agenda fixa não acontece em um dia
 * específico (agenda dos padres, feriado...) e o fiel vê isso no app, em vez
 * do cartaz na porta da igreja. Contrato do backend:
 * - GET  /mass-schedules/occurrences → cada ocorrência traz cancelled/cancelReason
 * - GET  /mass-schedules/:id/cancellations?from&to → quem suspendeu e quando
 * - POST /mass-schedules/:id/cancellations { dates, reason? }
 * - DELETE /mass-schedules/:id/cancellations/:date → volta a acontecer
 */

export type ScheduleType = 'MASS' | 'CONFESSION' | 'ADORATION' | 'ROSARY';

export const TYPE_META: Record<ScheduleType, { label: string; color: string; icon: string }> = {
  MASS: { label: 'Missa', color: 'blue', icon: '⛪' },
  CONFESSION: { label: 'Confissão', color: 'yellow', icon: '🙏' },
  ADORATION: { label: 'Adoração', color: 'green', icon: '✨' },
  ROSARY: { label: 'Terço', color: 'gray', icon: '📿' },
};

export interface FixedOccurrence {
  id: string;
  massScheduleId: string;
  title: string;
  type: string;
  notes?: string | null;
  /** 'YYYY-MM-DDTHH:MM:SS' — relógio de parede, sem fuso */
  start: string;
  end: string;
  community?: { id: string; name: string } | null;
  isFixed?: boolean;
  cancelled?: boolean;
  cancelReason?: string | null;
}

export interface ScheduleCancellation {
  id: string;
  date: string;
  reason: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
}

/** Referência mínima do horário fixo para o modal de suspensão */
export interface SuspendScheduleRef {
  id: string;
  type: ScheduleType;
  time: string;
  description: string;
  community: { id: string; name: string };
}

export const REASON_PRESETS = ['Agenda dos padres', 'Feriado', 'Padre em viagem/retiro'];
export const REASON_MAX = 140;
/** Janela da suspensão em lote (o backend aceita até 62 datas por vez) */
const WINDOW_DAYS = 60;

// ---------------------------------------------------------------------------
// Datas (sempre 'YYYY-MM-DD', calculadas no calendário, sem fuso)
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

/** Hoje no relógio local da secretaria */
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const addDaysISO = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const WEEKDAY_LONG = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const weekdayOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** "qui 26/09" */
export const shortDate = (iso: string) => `${WEEKDAY_SHORT[weekdayOf(iso)]} ${ddmm(iso)}`;
/** "quinta, 26/09" */
export const longDate = (iso: string) => `${WEEKDAY_LONG[weekdayOf(iso)]}, ${ddmm(iso)}`;

export const occDate = (occ: Pick<FixedOccurrence, 'start'>) => occ.start.slice(0, 10);
export const occTime = (occ: Pick<FixedOccurrence, 'start'>) => occ.start.slice(11, 16);

/** Parâmetros from/to do /occurrences cobrindo os dias [from, to] inteiros */
const occurrenceRange = (from: string, to: string) => ({
  from: `${from}T00:00:00.000Z`,
  to: `${to}T23:59:59.000Z`,
});

const typeLabel = (type: string, fallback: string) =>
  TYPE_META[type as ScheduleType]?.label ?? fallback;
const typeIcon = (type: string) => TYPE_META[type as ScheduleType]?.icon ?? '🕐';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const formatCreatedAt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

// ---------------------------------------------------------------------------
// Diálogo acessível (foco preso, Esc fecha, devolve o foco ao sair)
// ---------------------------------------------------------------------------

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  labelledBy: string;
  describedBy?: string;
  onClose: () => void;
  wide?: boolean;
  /** 'container' foca o próprio diálogo (útil quando o conteúdo ainda carrega) */
  initialFocus?: 'first' | 'container';
  children: React.ReactNode;
}

const Dialog: React.FC<DialogProps> = ({ labelledBy, describedBy, onClose, wide, initialFocus = 'first', children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first =
      initialFocus === 'container'
        ? null
        : (node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE));
    (first ?? node)?.focus();
    return () => {
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null,
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="module-modal-overlay susp-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={`module-modal susp-modal${wide ? ' wide' : ''}`}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Motivo: atalhos + campo livre (opcional, até 140)
// ---------------------------------------------------------------------------

interface ReasonPickerProps {
  idPrefix: string;
  value: string;
  onChange: (value: string) => void;
  /** Recebe o foco ao abrir o diálogo (primeiro atalho) */
  autoFocus?: boolean;
}

const ReasonPicker: React.FC<ReasonPickerProps> = ({ idPrefix, value, onChange, autoFocus }) => {
  const [other, setOther] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = REASON_PRESETS.includes(value) ? value : other || value ? 'Outro' : '';

  return (
    <fieldset className="susp-reason">
      <legend>
        Motivo <span className="susp-optional">(opcional — aparece para os fiéis no app)</span>
      </legend>
      <div className="susp-chips">
        {[...REASON_PRESETS, 'Outro'].map((preset, index) => {
          const on = selected === preset;
          return (
            <button
              key={preset}
              type="button"
              className={`susp-chip${on ? ' is-on' : ''}`}
              aria-pressed={on}
              data-autofocus={autoFocus && index === 0 ? true : undefined}
              onClick={() => {
                if (preset === 'Outro') {
                  setOther(true);
                  if (REASON_PRESETS.includes(value)) onChange('');
                  setTimeout(() => inputRef.current?.focus(), 0);
                } else {
                  setOther(false);
                  onChange(on ? '' : preset);
                }
              }}
            >
              {preset}
            </button>
          );
        })}
      </div>
      <label className="susp-reason-label" htmlFor={`${idPrefix}-reason`}>
        Escreva o motivo, se quiser
      </label>
      <input
        id={`${idPrefix}-reason`}
        ref={inputRef}
        type="text"
        maxLength={REASON_MAX}
        value={value}
        placeholder="Ex.: Padre em retiro com o clero"
        onChange={(e) => onChange(e.target.value.slice(0, REASON_MAX))}
        aria-describedby={`${idPrefix}-reason-count`}
      />
      <small id={`${idPrefix}-reason-count`} className="susp-count">
        {value.length}/{REASON_MAX}
      </small>
    </fieldset>
  );
};

// ---------------------------------------------------------------------------
// Interruptor "Acontece / Não haverá"
// ---------------------------------------------------------------------------

interface HappensSwitchProps {
  happens: boolean;
  label: string;
  busy: boolean;
  onToggle: () => void;
}

const HappensSwitch: React.FC<HappensSwitchProps> = ({ happens, label, busy, onToggle }) => (
  <button
    type="button"
    role="switch"
    aria-checked={happens}
    aria-label={label}
    aria-busy={busy || undefined}
    disabled={busy}
    className={`susp-switch${happens ? ' is-on' : ''}`}
    onClick={onToggle}
  >
    <span className="susp-switch-track" aria-hidden="true">
      <span className="susp-switch-thumb" />
    </span>
    <span className="susp-switch-text" aria-hidden="true">
      {busy ? 'Salvando…' : happens ? 'Acontece' : 'Não haverá'}
    </span>
  </button>
);

// ---------------------------------------------------------------------------
// Painel "Próximos 7 dias"
// ---------------------------------------------------------------------------

interface UpcomingWeekPanelProps {
  /** Comunidade filtrada ('' = todas do escopo) */
  communityId: string;
  canManage: boolean;
  showCommunity: boolean;
  /** Muda quando algo foi alterado fora do painel (modal de datas) */
  refreshKey: number;
  /** Avisa a página para atualizar os selos da lista */
  onChanged: () => void;
}

export const UpcomingWeekPanel: React.FC<UpcomingWeekPanelProps> = ({
  communityId,
  canManage,
  showCommunity,
  refreshKey,
  onChanged,
}) => {
  const [occurrences, setOccurrences] = useState<FixedOccurrence[]>([]);
  const [authors, setAuthors] = useState<Record<string, ScheduleCancellation>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [target, setTarget] = useState<FixedOccurrence | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState('');

  const requestRef = useRef(0);
  const today = todayISO();

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    const from = todayISO();
    const to = addDaysISO(from, 6);
    try {
      const res = await api.get<FixedOccurrence[]>('/mass-schedules/occurrences', {
        params: { ...occurrenceRange(from, to), communityId: communityId || undefined },
      });
      const list = (res.data ?? []).filter((o) => occDate(o) >= from && occDate(o) <= to);
      // Quem suspendeu: só para os horários com alguma data suspensa na semana
      const ids = [...new Set(list.filter((o) => o.cancelled).map((o) => o.massScheduleId))];
      const results = await Promise.all(
        ids.map((id) =>
          api
            .get<ScheduleCancellation[]>(`/mass-schedules/${id}/cancellations`, { params: { from, to } })
            .then((r) => ({ id, items: r.data ?? [] }))
            .catch(() => ({ id, items: [] as ScheduleCancellation[] })),
        ),
      );
      if (request !== requestRef.current) return;
      const map: Record<string, ScheduleCancellation> = {};
      for (const { id, items } of results) {
        for (const c of items) map[`${id}|${c.date.slice(0, 10)}`] = c;
      }
      setOccurrences(list);
      setAuthors(map);
      setError('');
    } catch (err) {
      if (request !== requestRef.current) return;
      setError(getErrorMessage(err, 'Não foi possível carregar os próximos 7 dias. Tente de novo.'));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [communityId]);

  useEffect(() => {
    setLoading(true);
    setNotice('');
    void load();
  }, [load, refreshKey]);

  const days = useMemo(() => {
    const map = new Map<string, FixedOccurrence[]>();
    for (const occ of [...occurrences].sort((a, b) => a.start.localeCompare(b.start))) {
      const date = occDate(occ);
      if (!map.has(date)) map.set(date, []);
      map.get(date)!.push(occ);
    }
    return [...map.entries()];
  }, [occurrences]);

  const describe = (occ: FixedOccurrence) =>
    `${typeLabel(occ.type, occ.title)} das ${occTime(occ)} de ${longDate(occDate(occ))}`;

  const openSuspend = (occ: FixedOccurrence) => {
    setTarget(occ);
    setReason('');
    setDialogError('');
    setNotice('');
  };

  const reactivate = async (occ: FixedOccurrence) => {
    setBusyId(occ.id);
    setError('');
    setNotice('');
    try {
      await api.delete(`/mass-schedules/${occ.massScheduleId}/cancellations/${occDate(occ)}`);
      await load();
      setNotice(`Pronto: ${describe(occ)} volta a acontecer.`);
      onChanged();
    } catch (err) {
      setError(getErrorMessage(err, 'Não foi possível reativar este horário. Tente de novo.'));
    } finally {
      setBusyId(null);
    }
  };

  const confirmSuspend = async () => {
    if (!target) return;
    setSaving(true);
    setDialogError('');
    try {
      await api.post(`/mass-schedules/${target.massScheduleId}/cancellations`, {
        dates: [occDate(target)],
        reason: reason.trim() || undefined,
      });
      const done = target;
      setTarget(null);
      await load();
      setNotice(`Marcado: não haverá ${describe(done)}.`);
      onChanged();
    } catch (err) {
      setDialogError(getErrorMessage(err, 'Não foi possível suspender este horário. Tente de novo.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="susp-week" aria-labelledby="susp-week-title">
      <div className="susp-week-head">
        <h2 id="susp-week-title">Próximos 7 dias</h2>
        <p>
          {canManage
            ? 'Algum horário não vai acontecer? Desligue o botão e o app mostra “Não haverá” para os fiéis.'
            : 'Horários fixos da semana e os que não vão acontecer.'}
        </p>
      </div>

      {error && (
        <div className="susp-error" role="alert">
          {error}
        </div>
      )}
      <div className="susp-notice" role="status" aria-live="polite">
        {notice}
      </div>

      {loading ? (
        <div className="susp-muted">Carregando…</div>
      ) : days.length === 0 ? (
        !error && <div className="susp-muted">Nenhum horário fixo nos próximos 7 dias.</div>
      ) : (
        <div className="susp-days">
          {days.map(([date, list]) => {
            const heading =
              date === today ? 'Hoje' : date === addDaysISO(today, 1) ? 'Amanhã' : null;
            return (
              <div key={date} className="susp-day">
                <h3 className="susp-day-title">
                  {heading ? (
                    <>
                      {heading} <span>· {shortDate(date)}</span>
                    </>
                  ) : (
                    shortDate(date)
                  )}
                </h3>
                <ul className="susp-occ-list">
                  {list.map((occ) => {
                    const cancelled = !!occ.cancelled;
                    const author = authors[`${occ.massScheduleId}|${date}`];
                    const reasonText = occ.cancelReason ?? author?.reason ?? null;
                    return (
                      <li key={occ.id} className={`susp-occ${cancelled ? ' is-cancelled' : ''}`}>
                        <div className="susp-occ-info">
                          <div className="susp-occ-main">
                            <span className="susp-occ-time">{occTime(occ)}</span>
                            <span className="susp-occ-type">
                              <span aria-hidden="true">{typeIcon(occ.type)}</span>{' '}
                              {typeLabel(occ.type, occ.title)}
                            </span>
                          </div>
                          {showCommunity && occ.community?.name && (
                            <div className="susp-occ-comm">{occ.community.name}</div>
                          )}
                        </div>
                        {canManage ? (
                          <HappensSwitch
                            happens={!cancelled}
                            label={`${describe(occ)} acontece`}
                            busy={busyId === occ.id}
                            onToggle={() => (cancelled ? void reactivate(occ) : openSuspend(occ))}
                          />
                        ) : (
                          <span className={`status-badge ${cancelled ? 'red' : 'green'}`}>
                            {cancelled ? 'Não haverá' : 'Acontece'}
                          </span>
                        )}
                        {cancelled && (
                          <div className="susp-occ-reason">
                            <strong>Não haverá</strong>
                            {reasonText ? ` · ${reasonText}` : ''}
                            {author?.createdBy?.name && (
                              <span className="susp-occ-by">Suspenso por {author.createdBy.name}</span>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {target && (
        <Dialog
          labelledBy="susp-one-title"
          describedBy="susp-one-desc"
          onClose={() => {
            if (!saving) setTarget(null);
          }}
        >
          <h2 id="susp-one-title" className="susp-title">
            Não haverá {typeLabel(target.type, target.title)} neste dia?
          </h2>
          <p id="susp-one-desc" className="susp-sub">
            <strong>{longDate(occDate(target))}</strong> às <strong>{occTime(target)}</strong>
            {target.community?.name ? ` · ${target.community.name}` : ''}. Os fiéis verão no app que este
            horário não acontece nesse dia. Os outros dias continuam normais.
          </p>
          <ReasonPicker idPrefix="susp-one" value={reason} onChange={setReason} autoFocus />
          {dialogError && (
            <div className="susp-error" role="alert">
              {dialogError}
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="btn-cancel" onClick={() => setTarget(null)} disabled={saving}>
              Voltar
            </button>
            <button
              type="button"
              className="btn-submit susp-danger"
              onClick={() => void confirmSuspend()}
              disabled={saving}
            >
              {saving ? 'Salvando…' : 'Confirmar: não haverá'}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Modal "Suspender datas" de um horário fixo
// ---------------------------------------------------------------------------

interface SuspendDatesModalProps {
  schedule: SuspendScheduleRef;
  onClose: () => void;
  onChanged: () => void;
}

export const SuspendDatesModal: React.FC<SuspendDatesModalProps> = ({ schedule, onClose, onChanged }) => {
  const today = todayISO();
  const until = addDaysISO(today, WINDOW_DAYS);

  const [occurrences, setOccurrences] = useState<FixedOccurrence[]>([]);
  const [cancellations, setCancellations] = useState<ScheduleCancellation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reactivating, setReactivating] = useState<string | null>(null);

  const load = useCallback(async () => {
    const from = todayISO();
    const to = addDaysISO(from, WINDOW_DAYS);
    try {
      const [occRes, cancRes] = await Promise.all([
        api.get<FixedOccurrence[]>('/mass-schedules/occurrences', {
          params: { ...occurrenceRange(from, to), communityId: schedule.community.id },
        }),
        api.get<ScheduleCancellation[]>(`/mass-schedules/${schedule.id}/cancellations`, {
          params: { from, to },
        }),
      ]);
      const seen = new Set<string>();
      const mine = (occRes.data ?? [])
        .filter((o) => o.massScheduleId === schedule.id && occDate(o) >= from && occDate(o) <= to)
        .sort((a, b) => a.start.localeCompare(b.start))
        .filter((o) => {
          const d = occDate(o);
          if (seen.has(d)) return false;
          seen.add(d);
          return true;
        });
      setOccurrences(mine);
      setCancellations(
        [...(cancRes.data ?? [])]
          .filter((c) => c.date.slice(0, 10) >= from)
          .sort((a, b) => a.date.localeCompare(b.date)),
      );
      setLoadError('');
    } catch (err) {
      setLoadError(getErrorMessage(err, 'Não foi possível carregar as datas deste horário. Tente de novo.'));
    } finally {
      setLoading(false);
    }
  }, [schedule.id, schedule.community.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const cancelledDates = useMemo(() => {
    const set = new Set(cancellations.map((c) => c.date.slice(0, 10)));
    for (const o of occurrences) if (o.cancelled) set.add(occDate(o));
    return set;
  }, [cancellations, occurrences]);

  const available = useMemo(
    () => occurrences.map(occDate).filter((d) => !cancelledDates.has(d)),
    [occurrences, cancelledDates],
  );

  const toggle = (date: string) => {
    setNotice('');
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const selectRange = () => {
    setError('');
    setNotice('');
    if (!rangeFrom || !rangeTo) {
      setError('Informe as duas datas do período (de e até).');
      return;
    }
    const [from, to] = rangeFrom <= rangeTo ? [rangeFrom, rangeTo] : [rangeTo, rangeFrom];
    const dates = available.filter((d) => d >= from && d <= to);
    if (dates.length === 0) {
      setError('Este horário não tem datas livres nesse período.');
      return;
    }
    setSelected((prev) => new Set([...prev, ...dates]));
    setNotice(`${plural(dates.length, 'data marcada', 'datas marcadas')} no período.`);
  };

  const submit = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    setError('');
    setNotice('');
    const dates = [...selected].sort();
    try {
      await api.post(`/mass-schedules/${schedule.id}/cancellations`, {
        dates,
        reason: reason.trim() || undefined,
      });
      setSelected(new Set());
      await load();
      setNotice(`${plural(dates.length, 'data suspensa', 'datas suspensas')}. Os fiéis já veem “Não haverá” no app.`);
      onChanged();
    } catch (err) {
      setError(getErrorMessage(err, 'Não foi possível suspender as datas. Tente de novo.'));
    } finally {
      setSaving(false);
    }
  };

  const reactivate = async (date: string) => {
    setReactivating(date);
    setError('');
    setNotice('');
    try {
      await api.delete(`/mass-schedules/${schedule.id}/cancellations/${date}`);
      await load();
      setNotice(`${longDate(date)} volta a acontecer.`);
      onChanged();
    } catch (err) {
      setError(getErrorMessage(err, 'Não foi possível reativar esta data. Tente de novo.'));
    } finally {
      setReactivating(null);
    }
  };

  const meta = TYPE_META[schedule.type];

  return (
    <Dialog
      labelledBy="susp-many-title"
      describedBy="susp-many-desc"
      wide
      initialFocus="container"
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <h2 id="susp-many-title" className="susp-title">
        Suspender datas
      </h2>
      <p id="susp-many-desc" className="susp-sub">
        <span aria-hidden="true">{meta?.icon}</span> {meta?.label ?? 'Horário'} · {schedule.description} às{' '}
        <strong>{schedule.time}</strong> · {schedule.community.name}
        <br />
        Marque os dias em que <strong>não haverá</strong> este horário. Os fiéis verão no app.
      </p>

      {loadError && (
        <div className="susp-error" role="alert">
          {loadError}
        </div>
      )}

      <section className="susp-block" aria-labelledby="susp-pick-title">
        <div className="susp-block-head">
          <h3 id="susp-pick-title">Próximas datas ({WINDOW_DAYS} dias)</h3>
          {available.length > 0 && (
            <div className="susp-block-actions">
              <button
                type="button"
                className="susp-link"
                onClick={() => {
                  setNotice('');
                  setSelected(new Set(available));
                }}
              >
                Marcar todas
              </button>
              {selected.size > 0 && (
                <button type="button" className="susp-link" onClick={() => setSelected(new Set())}>
                  Limpar
                </button>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <div className="susp-muted">Carregando…</div>
        ) : occurrences.length === 0 ? (
          <div className="susp-muted">Este horário não tem datas nos próximos {WINDOW_DAYS} dias.</div>
        ) : (
          <div className="susp-dates" role="group" aria-labelledby="susp-pick-title">
            {occurrences.map((occ) => {
              const date = occDate(occ);
              const isCancelled = cancelledDates.has(date);
              const checked = isCancelled || selected.has(date);
              return (
                <label
                  key={date}
                  className={`susp-date${checked ? ' is-checked' : ''}${isCancelled ? ' is-cancelled' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isCancelled || saving}
                    onChange={() => toggle(date)}
                    aria-label={`${longDate(date)}${isCancelled ? ' (já suspensa)' : ''}`}
                  />
                  <span className="susp-date-text">{shortDate(date)}</span>
                  {isCancelled && <small>já suspensa</small>}
                </label>
              );
            })}
          </div>
        )}

        {available.length > 1 && (
          <div className="susp-range">
            <span className="susp-range-label">Marcar todas de um período:</span>
            <span className="susp-range-field">
              <span aria-hidden="true">de</span>
              <DateInput
                value={rangeFrom}
                onChange={setRangeFrom}
                min={today}
                max={until}
                aria-label="Início do período"
              />
            </span>
            <span className="susp-range-field">
              <span aria-hidden="true">até</span>
              <DateInput value={rangeTo} onChange={setRangeTo} min={today} max={until} aria-label="Fim do período" />
            </span>
            <button type="button" className="susp-btn-light" onClick={selectRange}>
              Marcar período
            </button>
          </div>
        )}
      </section>

      <ReasonPicker idPrefix="susp-many" value={reason} onChange={setReason} />

      {error && (
        <div className="susp-error" role="alert">
          {error}
        </div>
      )}
      <div className="susp-notice" role="status" aria-live="polite">
        {notice}
      </div>

      <div className="susp-submit-row">
        <button
          type="button"
          className="btn-submit susp-danger"
          disabled={selected.size === 0 || saving}
          onClick={() => void submit()}
        >
          {saving
            ? 'Salvando…'
            : selected.size === 0
              ? 'Marque as datas acima'
              : `Suspender ${plural(selected.size, 'data', 'datas')}`}
        </button>
      </div>

      <section className="susp-block susp-list" aria-labelledby="susp-list-title">
        <h3 id="susp-list-title">Datas suspensas</h3>
        {loading ? null : cancellations.length === 0 ? (
          <div className="susp-muted">Nenhuma data suspensa. Este horário acontece normalmente.</div>
        ) : (
          <ul>
            {cancellations.map((c) => {
              const date = c.date.slice(0, 10);
              const when = formatCreatedAt(c.createdAt);
              return (
                <li key={c.id}>
                  <div className="susp-list-info">
                    <strong>{longDate(date)}</strong>
                    <span className="susp-list-reason">{c.reason || 'Sem motivo informado'}</span>
                    {(c.createdBy?.name || when) && (
                      <small>
                        Suspenso{c.createdBy?.name ? ` por ${c.createdBy.name}` : ''}
                        {when ? ` em ${when}` : ''}
                      </small>
                    )}
                  </div>
                  <button
                    type="button"
                    className="susp-btn-light"
                    disabled={reactivating === date}
                    onClick={() => void reactivate(date)}
                    aria-label={`Reativar ${longDate(date)}`}
                  >
                    {reactivating === date ? 'Reativando…' : 'Reativar'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="modal-actions">
        <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>
          Fechar
        </button>
      </div>
    </Dialog>
  );
};
