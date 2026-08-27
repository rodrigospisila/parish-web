import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import PublicShell from './PublicShell';
import GiftPaymentPanel from './GiftPaymentPanel';
import {
  METHOD_LABEL,
  STATUS_INFO,
  declareGift,
  fetchGift,
  formatDateTime,
  isGiftOpen,
  isNotFoundError,
  money,
  publicErrorMessage,
  receiptPdfUrl,
  useGiftPolling,
  type Gift,
} from './publicTithe';
import './DonatePage.css';

/**
 * Acompanhamento / recibo de uma oferta (Dízimo D4.6) — sem login.
 * Rota: /doar/recibo/:token
 */
const GiftStatusPage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();

  const [gift, setGift] = useState<Gift | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [declaring, setDeclaring] = useState(false);
  const [actionError, setActionError] = useState('');

  const { exhausted, polling } = useGiftPolling(gift, setGift);

  const load = useCallback(async () => {
    try {
      setGift(await fetchGift(token));
      setLoadError('');
    } catch (error) {
      setLoadError(
        isNotFoundError(error)
          ? 'Oferta não encontrada. Confira o link recebido.'
          : publicErrorMessage(error, 'Não foi possível consultar a oferta agora. Tente novamente em instantes.'),
      );
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    const previous = document.title;
    document.title = 'Sua oferta — Parish';
    return () => {
      document.title = previous;
    };
  }, []);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setActionError('');
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const handleDeclare = async () => {
    if (!gift || declaring) return;
    setDeclaring(true);
    setActionError('');
    try {
      setGift(await declareGift(gift.token));
    } catch (error) {
      setActionError(publicErrorMessage(error, 'Não foi possível registrar o aviso. Tente novamente.'));
    } finally {
      setDeclaring(false);
    }
  };

  if (loading) {
    return (
      <PublicShell kicker="Acompanhamento" title="Sua oferta">
        <section className="donate-card donate-center donate-muted">Consultando a oferta…</section>
      </PublicShell>
    );
  }

  if (!gift) {
    return (
      <PublicShell kicker="Acompanhamento" title="Sua oferta">
        <section className="donate-card">
          <div className="donate-alert is-error" role="alert">
            {loadError || 'Não foi possível consultar a oferta.'}
          </div>
          <button type="button" className="donate-btn is-secondary" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? 'Consultando…' : 'Tentar novamente'}
          </button>
        </section>
      </PublicShell>
    );
  }

  const info = STATUS_INFO[gift.status];
  const open = isGiftOpen(gift.status);
  const first = gift.name.trim().split(/\s+/)[0] || gift.name;
  const title =
    gift.status === 'CONFIRMED' ? `Deus lhe pague, ${first}!` : gift.status === 'CANCELLED' ? 'Oferta cancelada' : `Olá, ${first}!`;

  return (
    <PublicShell kicker="Acompanhamento" title="Sua oferta" subtitle={`${gift.name} · ${money(gift.amount)}`}>
      <section className="donate-card">
        <div className="donate-status">
          <span className={`donate-status-badge tone-${info.tone}`}>{info.label}</span>
          <h2 className="donate-status-title">{title}</h2>
          <p className="donate-muted">{info.description}</p>
        </div>

        {loadError && (
          <div className="donate-alert is-warning" role="status">
            {loadError}
          </div>
        )}
        {actionError && (
          <div className="donate-alert is-error" role="alert">
            {actionError}
          </div>
        )}

        <dl className="donate-details">
          <div>
            <dt>Valor</dt>
            <dd>{money(gift.amount)}</dd>
          </div>
          {gift.amountPaid !== null && gift.amountPaid !== gift.amount && (
            <div>
              <dt>Valor pago</dt>
              <dd>{money(gift.amountPaid)}</dd>
            </div>
          )}
          <div>
            <dt>Destino</dt>
            <dd>{gift.campaign?.name ?? 'Dízimo e ofertas da paróquia'}</dd>
          </div>
          <div>
            <dt>Meio</dt>
            <dd>{METHOD_LABEL[gift.paymentMethod]}</dd>
          </div>
          <div>
            <dt>Identificador</dt>
            <dd>{gift.txid}</dd>
          </div>
          <div>
            <dt>Criada em</dt>
            <dd>{formatDateTime(gift.createdAt)}</dd>
          </div>
          {gift.declaredAt && (
            <div>
              <dt>Avisada em</dt>
              <dd>{formatDateTime(gift.declaredAt)}</dd>
            </div>
          )}
          {gift.confirmedAt && (
            <div>
              <dt>Confirmada em</dt>
              <dd>{formatDateTime(gift.confirmedAt)}</dd>
            </div>
          )}
        </dl>

        {gift.status === 'CONFIRMED' && (
          <div className="donate-actions" style={{ marginTop: 0 }}>
            <a className="donate-btn" href={receiptPdfUrl(gift.token)} target="_blank" rel="noopener noreferrer">
              Baixar comprovante (PDF)
            </a>
            <p className="donate-muted donate-center">
              {gift.receiptSentAt
                ? 'O comprovante também foi enviado para o seu e-mail.'
                : 'O comprovante será enviado para o seu e-mail em breve.'}
            </p>
          </div>
        )}

        {gift.status === 'CANCELLED' && gift.note && (
          <div className="donate-alert is-warning" role="status">
            Motivo: {gift.note}
          </div>
        )}

        {open && <GiftPaymentPanel gift={gift} onDeclare={handleDeclare} declaring={declaring} />}

        {open && (
          <div className="donate-actions" style={{ marginTop: 18 }}>
            <p className="donate-muted donate-center">
              {polling
                ? 'Atualizamos esta página automaticamente a cada 10 segundos.'
                : exhausted
                  ? 'Paramos de atualizar automaticamente. Toque em "Atualizar agora" para conferir.'
                  : ''}
            </p>
            <button type="button" className="donate-btn is-ghost" onClick={() => void refresh()} disabled={refreshing}>
              {refreshing ? 'Atualizando…' : 'Atualizar agora'}
            </button>
          </div>
        )}
      </section>
    </PublicShell>
  );
};

export default GiftStatusPage;
