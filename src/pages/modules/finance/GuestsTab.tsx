import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../../services/api';
import { notify } from '../../../services/notification.service';
import { formatBRL, friendlyError, providerStatusLabel } from './financeShared';

/**
 * Aba "Visitantes" do Financeiro (D4.6): ofertas feitas pela página pública /doar/:parishId
 * por quem não tem o app. A administração paroquial confere o Pix estático no extrato
 * (confirma ou marca como não localizado), consulta o provedor nas cobranças por gateway
 * e reenvia o recibo por e-mail. Coordenação de comunidade não vê esta aba.
 */

export type GuestStatus = 'CREATED' | 'DECLARED' | 'CONFIRMED' | 'CANCELLED';
export type GuestFilter = GuestStatus | 'ALL';

export interface GuestGift {
  id: string;
  name: string;
  email: string | null;
  /** CPF já mascarado pelo backend (***.123.456-**) */
  cpfMasked: string | null;
  amount: number;
  amountPaid: number | null;
  /** Mensagem/intenção deixada pelo visitante */
  message: string | null;
  campaign: { id: string; name: string } | null;
  status: GuestStatus;
  /** PIX_STATIC = paga na chave da paróquia e a tesouraria confere; GATEWAY = cobrança no provedor */
  method: 'PIX_STATIC' | 'GATEWAY';
  paymentMethod: 'PIX' | 'CARD' | 'BOLETO';
  providerStatus: string | null;
  txid: string | null;
  note: string | null;
  receiptSentAt: string | null;
  declaredAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
}

interface GuestsTabProps {
  /** Paróquia conciliada ('' = admin diocesano/sistema ainda não escolheu no seletor) */
  parishId: string;
  /** Confirmar lança receita no Financeiro: a página recarrega os totais */
  onDataChanged?: () => void;
}

const STATUS_BADGE: Record<GuestStatus, { label: string; color: string }> = {
  CREATED: { label: 'Cobrança gerada', color: 'gray' },
  DECLARED: { label: 'Aguardando conferência', color: 'yellow' },
  CONFIRMED: { label: 'Confirmada', color: 'green' },
  CANCELLED: { label: 'Cancelada / não localizada', color: 'red' },
};

const FILTER_OPTIONS: ReadonlyArray<{ value: GuestFilter; label: string }> = [
  { value: 'DECLARED', label: 'Aguardando conferência' },
  { value: 'CREATED', label: 'Geradas (não informadas)' },
  { value: 'CONFIRMED', label: 'Confirmadas' },
  { value: 'CANCELLED', label: 'Canceladas / não localizadas' },
  { value: 'ALL', label: 'Todas' },
];

const PAYMENT_METHOD_LABEL: Record<string, string> = { PIX: 'Pix', CARD: '💳 Cartão', BOLETO: '📄 Boleto' };
const PAYMENT_METHOD_NAME: Record<string, string> = { PIX: 'Pix', CARD: 'Cartão', BOLETO: 'Boleto' };
const methodLabel = (gift: GuestGift): string => PAYMENT_METHOD_LABEL[gift.paymentMethod] ?? gift.paymentMethod;
const methodName = (gift: GuestGift): string => PAYMENT_METHOD_NAME[gift.paymentMethod] ?? 'Pagamento';

const isOpen = (gift: GuestGift) => gift.status === 'DECLARED' || gift.status === 'CREATED';
// Provedor apontou pagamento com valor diferente do esperado: só conciliação manual
const isMismatch = (gift: GuestGift) => gift.method === 'GATEWAY' && gift.providerStatus === 'mismatch';
// Cobrança do provedor é confirmada pelo webhook/consulta (o backend recusa o confirm com 400).
// A tesouraria confirma à mão o Pix estático, a divergência de valor ou a cobrança que nem
// chegou a existir no provedor (sem situação registrada)
const needsManualCheck = (gift: GuestGift) => isOpen(gift) && (gift.method !== 'GATEWAY' || isMismatch(gift) || !gift.providerStatus);
const canSync = (gift: GuestGift) => gift.method === 'GATEWAY' && isOpen(gift) && !!gift.providerStatus && !isMismatch(gift);

const TZ = 'America/Sao_Paulo';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ });
};

const hintStyle: React.CSSProperties = { fontSize: '0.82rem', color: '#666', margin: '0.35rem 0 0' };
const smallStyle: React.CSSProperties = { fontSize: '0.78rem', color: '#666' };

const GuestsTab: React.FC<GuestsTabProps> = ({ parishId, onDataChanged }) => {
  const [status, setStatus] = useState<GuestFilter>('DECLARED');
  const [gifts, setGifts] = useState<GuestGift[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Confirmação num modal (data em que caiu + valor pago) — nada de window.prompt para o valor
  const [confirmTarget, setConfirmTarget] = useState<GuestGift | null>(null);
  const [confirmForm, setConfirmForm] = useState({ date: '', amountPaid: '' });
  // Contador de requisição: a resposta atrasada de outra paróquia/filtro não sobrescreve a atual
  const requestRef = useRef(0);
  const linkRef = useRef<HTMLInputElement | null>(null);

  const publicLink = parishId ? `${window.location.origin}/doar/${parishId}` : '';

  const fetchGuests = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!parishId) {
      setGifts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get<GuestGift[]>('/tithe/guests', { params: { parishId, status } });
      if (requestId !== requestRef.current) return;
      setGifts(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      if (requestId !== requestRef.current) return;
      notify.error(friendlyError(error, 'Erro ao carregar as ofertas de visitantes'));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [parishId, status]);

  useEffect(() => {
    void fetchGuests();
  }, [fetchGuests]);

  // Trocar de paróquia fecha o modal (o alvo era da paróquia anterior)
  useEffect(() => {
    setConfirmTarget(null);
  }, [parishId]);

  // Escape fecha o modal de confirmação
  useEffect(() => {
    if (!confirmTarget) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirmTarget(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmTarget]);

  const copyLink = async () => {
    if (!publicLink) return;
    try {
      await navigator.clipboard.writeText(publicLink);
      notify.success('Link copiado — cole nas redes ou no boletim');
    } catch {
      // Sem permissão de clipboard (http, iframe): deixa o link selecionado para o Ctrl+C
      linkRef.current?.select();
      notify.info('Não foi possível copiar automaticamente — o link está selecionado, use Ctrl+C');
    }
  };

  const openConfirm = (gift: GuestGift) => {
    setConfirmForm({ date: todayIso(), amountPaid: String(gift.amount) });
    setConfirmTarget(gift);
  };

  const submitConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmTarget || busyId) return;
    if (!DATE_ONLY.test(confirmForm.date)) {
      notify.error('Informe a data em que o pagamento caiu no extrato');
      return;
    }
    const amountPaid = Number(confirmForm.amountPaid.replace(',', '.'));
    if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
      notify.error('Informe o valor que caiu (maior que zero)');
      return;
    }
    const target = confirmTarget;
    setBusyId(target.id);
    try {
      const res = await api.post<{ id: string; status: GuestStatus; receiptSentAt?: string | null }>(`/tithe/guests/${target.id}/confirm`, {
        date: confirmForm.date,
        amountPaid: Math.round(amountPaid * 100) / 100,
      });
      if (res.data?.status !== 'CONFIRMED') {
        notify.warning('Esta oferta já havia sido encerrada por outra pessoa — lista atualizada');
      } else {
        const receipt = res.data.receiptSentAt
          ? ' — recibo enviado por e-mail'
          : target.email
            ? ' — recibo ainda não enviado (use “Reenviar recibo”)'
            : '';
        notify.success(`Oferta de ${target.name} confirmada e lançada no Financeiro${receipt}`);
        onDataChanged?.();
      }
      setConfirmTarget(null);
      await fetchGuests();
    } catch (error) {
      notify.error(friendlyError(error, 'Erro ao confirmar a oferta'));
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (gift: GuestGift) => {
    const mismatch = isMismatch(gift);
    // Divergência: o provedor consta pago — encerrar sem lançar precisa de aviso explícito
    if (
      mismatch &&
      !window.confirm(
        `Atenção: o provedor consta este pagamento como PAGO${gift.note ? ` (${gift.note})` : ''}. ` +
          'Encerrar sem lançar no Financeiro? O valor recebido não será contabilizado nesta oferta.',
      )
    ) {
      return;
    }
    const typed = window.prompt(
      'Motivo (fica registrado na oferta):',
      mismatch ? 'Divergência de valor com o provedor — encerrada sem lançamento' : `${methodName(gift)} não localizado no extrato`,
    );
    if (typed === null) return;
    setBusyId(gift.id);
    try {
      await api.post(`/tithe/guests/${gift.id}/reject`, { reason: typed.trim() || undefined });
      notify.success(mismatch ? 'Oferta encerrada sem lançamento no Financeiro' : `${methodName(gift)} marcado como não localizado`);
      await fetchGuests();
    } catch (error) {
      notify.error(friendlyError(error, 'Erro ao processar'));
    } finally {
      setBusyId(null);
    }
  };

  /** Cobrança do provedor: consulta a situação lá (cobre webhook atrasado) e recarrega a lista */
  const sync = async (gift: GuestGift) => {
    setBusyId(gift.id);
    try {
      const res = await api.post<{ id: string; status?: GuestStatus; providerStatus?: string | null }>(`/tithe/guests/${gift.id}/sync`, {});
      const nextStatus = res.data?.status;
      const providerStatus = res.data?.providerStatus?.toLowerCase() ?? null;
      if (nextStatus === 'CONFIRMED') {
        notify.success('Pago no provedor — oferta confirmada e lançada no Financeiro');
        onDataChanged?.();
      } else if (nextStatus === 'CANCELLED') {
        notify.warning('Cobrança cancelada no provedor — oferta encerrada');
      } else if (providerStatus === 'mismatch') {
        notify.warning('Divergência de valor no provedor — confira o valor e concilie manualmente');
      } else if (providerStatus === 'in_review') {
        notify.info('Cartão em análise de risco no provedor — aguarde a liberação');
      } else {
        notify.info('Ainda aguardando pagamento no provedor');
      }
      await fetchGuests();
    } catch (error) {
      notify.error(friendlyError(error, 'Erro ao consultar o provedor'));
    } finally {
      setBusyId(null);
    }
  };

  const resendReceipt = async (gift: GuestGift) => {
    setBusyId(gift.id);
    try {
      const res = await api.post<{ id: string; sent: boolean }>(`/tithe/guests/${gift.id}/resend-receipt`, {});
      if (res.data?.sent) {
        notify.success(`Recibo reenviado para ${gift.email ?? 'o e-mail do visitante'}`);
        await fetchGuests();
      } else {
        notify.warning('Não foi possível enviar o recibo — confira o e-mail do visitante e o serviço de e-mail do servidor');
      }
    } catch (error) {
      notify.error(friendlyError(error, 'Erro ao reenviar o recibo'));
    } finally {
      setBusyId(null);
    }
  };

  const receiptCell = (gift: GuestGift) => {
    if (gift.status !== 'CONFIRMED') return '—';
    return gift.receiptSentAt ? (
      <span style={{ color: '#0f6e56' }} title={`Enviado em ${formatDateTime(gift.receiptSentAt)}`}>✓ enviado</span>
    ) : (
      <span style={{ color: '#b45309' }}>pendente</span>
    );
  };

  return (
    <>
      <p style={{ ...hintStyle, margin: '0 0 1rem' }}>
        Ofertas feitas pela página pública da paróquia por quem não tem o app: o visitante informa nome, e-mail e CPF, paga e avisa;
        você confere no extrato e confirma aqui. Ao confirmar, a oferta entra como receita no Financeiro e o recibo vai por e-mail.
      </p>

      {!parishId ? (
        <div className="empty-state">Escolha a paróquia acima para ver as ofertas de visitantes.</div>
      ) : (
        <>
          <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>🔗 Link público de doação</div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                ref={linkRef}
                type="text"
                readOnly
                className="filter-input"
                value={publicLink}
                aria-label="Link público de doação"
                onFocus={(e) => e.currentTarget.select()}
                style={{ flex: '1 1 320px', maxWidth: 560, fontFamily: 'monospace', fontSize: '0.85rem' }}
              />
              <button type="button" className="btn-small" onClick={() => void copyLink()}>📋 Copiar link</button>
              <a className="btn-small" href={publicLink} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Abrir</a>
            </div>
            <p style={hintStyle}>Compartilhe nas redes/boletim: quem não tem o app doa por aqui.</p>
          </div>

          <div className="filters-bar">
            <select className="filter-select" value={status} onChange={(e) => setStatus(e.target.value as GuestFilter)} aria-label="Situação">
              {FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <button type="button" className="btn-small" onClick={() => void fetchGuests()} disabled={loading}>↻ Atualizar</button>
          </div>

          {loading && gifts.length === 0 && <div className="loading">Carregando...</div>}
          {!loading && gifts.length === 0 && (
            <p style={{ color: '#666' }}>
              {status === 'DECLARED' ? 'Nenhuma oferta de visitante aguardando conferência.' : 'Nada por aqui.'}
            </p>
          )}
          {gifts.length > 0 && (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Nome</th>
                    <th>E-mail</th>
                    <th>CPF</th>
                    <th>Valor</th>
                    <th>Campanha</th>
                    <th>Meio</th>
                    <th>Mensagem / intenção</th>
                    <th>Situação</th>
                    <th>Recibo</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {gifts.map((gift) => {
                    const badge = STATUS_BADGE[gift.status] ?? { label: gift.status, color: 'gray' };
                    const busy = busyId === gift.id;
                    return (
                      <tr key={gift.id} style={isMismatch(gift) ? { background: '#fffbeb' } : undefined}>
                        <td>
                          {formatDateTime(gift.declaredAt ?? gift.createdAt)}
                          {!gift.declaredAt && gift.status === 'CREATED' && <div style={smallStyle}>gerada, ainda não informada</div>}
                        </td>
                        <td><strong>{gift.name}</strong></td>
                        <td style={{ wordBreak: 'break-all' }}>{gift.email || '—'}</td>
                        <td>{gift.cpfMasked || '—'}</td>
                        <td>
                          {formatBRL(gift.amount)}
                          {gift.amountPaid != null && Math.round(gift.amountPaid * 100) !== Math.round(gift.amount * 100) && (
                            <div style={smallStyle}>pago {formatBRL(gift.amountPaid)}</div>
                          )}
                        </td>
                        <td>{gift.campaign?.name ?? '—'}</td>
                        <td>
                          {methodLabel(gift)}
                          {gift.method === 'GATEWAY' ? (
                            <div style={{ fontSize: '0.72rem', color: isMismatch(gift) ? '#b45309' : '#0f6e56' }}>
                              via provedor{providerStatusLabel(gift.providerStatus) ? ` · ${providerStatusLabel(gift.providerStatus)}` : ''}
                            </div>
                          ) : (
                            <div style={{ fontSize: '0.72rem', color: '#555' }}>Pix da paróquia (conferir no extrato)</div>
                          )}
                          {gift.txid && <div style={{ fontSize: '0.72rem', color: '#888' }}><code>{gift.txid}</code></div>}
                        </td>
                        <td style={{ maxWidth: 260, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.85rem' }}>{gift.message || '—'}</td>
                        <td>
                          <span className={`status-badge ${badge.color}`}>{badge.label}</span>
                          {gift.note && gift.status === 'CANCELLED' ? <div style={{ fontSize: '0.75rem', color: '#888' }}>{gift.note}</div> : null}
                          {isMismatch(gift) && gift.note ? (
                            <div style={{ fontSize: '0.75rem', color: '#b45309', fontWeight: 600 }}>⚠ Provedor informou: {gift.note}</div>
                          ) : null}
                        </td>
                        <td>{receiptCell(gift)}</td>
                        <td className="actions-cell">
                          {needsManualCheck(gift) && (
                            <>
                              <button type="button" className="btn-small success" disabled={busyId !== null} onClick={() => openConfirm(gift)}>Confirmar</button>
                              <button
                                type="button"
                                className="btn-small"
                                disabled={busyId !== null}
                                title={isMismatch(gift) ? 'O provedor consta pago com outro valor; encerra sem lançar no Financeiro' : undefined}
                                onClick={() => void reject(gift)}
                              >
                                {isMismatch(gift) ? 'Encerrar sem lançar' : 'Não localizado'}
                              </button>
                            </>
                          )}
                          {canSync(gift) && (
                            <button
                              type="button"
                              className="btn-small"
                              disabled={busyId !== null}
                              title="O provedor confirma sozinho; consulte se o webhook atrasou"
                              onClick={() => void sync(gift)}
                            >
                              {busy ? 'Consultando...' : 'Consultar provedor'}
                            </button>
                          )}
                          {gift.status === 'CONFIRMED' && (
                            <button
                              type="button"
                              className="btn-small"
                              disabled={busyId !== null || !gift.email}
                              title={gift.email ? `Reenvia o recibo para ${gift.email}` : 'Visitante sem e-mail'}
                              onClick={() => void resendReceipt(gift)}
                            >
                              {busy ? 'Enviando...' : '✉ Reenviar recibo'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {confirmTarget && (
        <div className="module-modal-overlay" onClick={() => setConfirmTarget(null)}>
          <div className="module-modal" role="dialog" aria-modal="true" aria-labelledby="guest-confirm-title" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <h2 id="guest-confirm-title">Confirmar oferta de visitante</h2>
            <p style={{ fontSize: '0.85rem', color: '#666' }}>
              {confirmTarget.name} · {methodName(confirmTarget)} · {formatBRL(confirmTarget.amount)}
              {confirmTarget.txid ? ` · id ${confirmTarget.txid}` : ''}
              {confirmTarget.campaign ? ` · campanha ${confirmTarget.campaign.name}` : ''}
            </p>
            {isMismatch(confirmTarget) && confirmTarget.note ? (
              <p style={{ fontSize: '0.85rem', color: '#b45309', fontWeight: 600 }}>
                ⚠ Provedor informou: {confirmTarget.note} — confira o valor que caiu antes de lançar.
              </p>
            ) : null}
            <form onSubmit={submitConfirm}>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="guest-confirm-date">Data em que caiu no extrato *</label>
                  <input id="guest-confirm-date" type="date" required max={todayIso()} value={confirmForm.date} onChange={(e) => setConfirmForm({ ...confirmForm, date: e.target.value })} />
                </div>
                <div className="form-group">
                  <label htmlFor="guest-confirm-amount">Valor que caiu (R$) *</label>
                  <input id="guest-confirm-amount" type="number" step="0.01" min="0.01" required inputMode="decimal" value={confirmForm.amountPaid} onChange={(e) => setConfirmForm({ ...confirmForm, amountPaid: e.target.value })} />
                </div>
              </div>
              <p style={hintStyle}>
                {confirmTarget.email
                  ? `O recibo vai por e-mail para ${confirmTarget.email} assim que confirmar.`
                  : 'Visitante sem e-mail: não há recibo para enviar.'}
              </p>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setConfirmTarget(null)}>Cancelar</button>
                <button type="submit" className="btn-submit" disabled={busyId !== null}>{busyId ? 'Confirmando...' : 'Confirmar e lançar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default GuestsTab;
