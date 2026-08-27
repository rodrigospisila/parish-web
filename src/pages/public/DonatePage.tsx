import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PublicShell from './PublicShell';
import GiftPaymentPanel from './GiftPaymentPanel';
import {
  KIND_LABEL,
  MAX_AMOUNT,
  METHOD_LABEL,
  MIN_AMOUNT,
  STATUS_INFO,
  amountToInput,
  clearStoredGiftToken,
  createGift,
  declareGift,
  fetchDonatePage,
  fetchGift,
  formatDate,
  formatDateTime,
  isGiftOpen,
  isNotFoundError,
  isValidCpf,
  maskCpf,
  money,
  parseAmount,
  publicErrorMessage,
  readStoredGiftToken,
  receiptPdfUrl,
  storeGiftToken,
  useGiftPolling,
  type DonatePageData,
  type Gift,
  type PaymentMethod,
} from './publicTithe';
import './DonatePage.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALL_METHODS: PaymentMethod[] = ['PIX', 'CARD', 'BOLETO'];

/**
 * Página pública de doação (Dízimo D4.6) — sem login.
 * Rota: /doar/:parishId
 */
const DonatePage: React.FC = () => {
  const { parishId = '' } = useParams<{ parishId: string }>();

  const [data, setData] = useState<DonatePageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // formulário
  const [amountInput, setAmountInput] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [cpf, setCpf] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('PIX');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // resultado
  const [gift, setGift] = useState<Gift | null>(null);
  const [pending, setPending] = useState<Gift | null>(null);
  const [declaring, setDeclaring] = useState(false);
  const [actionError, setActionError] = useState('');

  const { exhausted } = useGiftPolling(gift, setGift);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setData(null);
    fetchDonatePage(parishId)
      .then((page) => {
        if (!cancelled) setData(page);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          isNotFoundError(error)
            ? 'Paróquia não encontrada. Confira o link recebido.'
            : publicErrorMessage(error, 'Não foi possível carregar a página de doação. Tente novamente em instantes.'),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [parishId]);

  useEffect(() => {
    const previous = document.title;
    document.title = data ? `Doar — ${data.parish.name}` : 'Doar — Parish';
    return () => {
      document.title = previous;
    };
  }, [data]);

  // Oferta em aberto lembrada neste navegador: reabrir o Pix sem gerar outra cobrança
  useEffect(() => {
    const token = readStoredGiftToken(parishId);
    if (!token) return undefined;
    let cancelled = false;
    fetchGift(token)
      .then((stored) => {
        if (cancelled) return;
        if (isGiftOpen(stored.status)) setPending(stored);
        else clearStoredGiftToken(parishId);
      })
      .catch((error: unknown) => {
        if (!cancelled && isNotFoundError(error)) clearStoredGiftToken(parishId);
      });
    return () => {
      cancelled = true;
    };
  }, [parishId]);

  const campaigns = data?.campaigns ?? [];
  const selectedCampaign = campaigns.find((c) => c.id === campaignId) ?? null;
  const chips =
    selectedCampaign && selectedCampaign.suggestedAmounts.length > 0 ? selectedCampaign.suggestedAmounts : (data?.suggestedAmounts ?? []);
  const amountValue = parseAmount(amountInput);
  const gateway = data?.gateway;
  const showCpf = Boolean(gateway?.available);
  const methods = ALL_METHODS.filter((m) => gateway?.methods.includes(m));
  const showMethods = methods.length > 1;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!data || submitting) return;
    setFormError('');

    const amount = parseAmount(amountInput);
    if (amount === null || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
      setFormError(`Informe um valor entre ${money(MIN_AMOUNT)} e ${money(MAX_AMOUNT)}.`);
      return;
    }
    if (name.trim().length < 2) {
      setFormError('Informe seu nome.');
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setFormError('Informe um e-mail válido para receber o comprovante.');
      return;
    }
    const cpfDigits = cpf.replace(/\D/g, '');
    if (method !== 'PIX' && !cpfDigits) {
      setFormError('Para cartão ou boleto, informe o CPF.');
      return;
    }
    if (cpfDigits && !isValidCpf(cpfDigits)) {
      setFormError('CPF inválido. Confira os números digitados.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await createGift(parishId, {
        name: name.trim(),
        email: email.trim(),
        amount,
        ...(cpfDigits ? { cpf: cpfDigits } : {}),
        ...(campaignId ? { campaignId } : {}),
        ...(message.trim() ? { message: message.trim() } : {}),
        paymentMethod: method,
        website,
      });
      storeGiftToken(parishId, created.token);
      setGift(created);
      setPending(null);
      setActionError('');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setFormError(publicErrorMessage(error, 'Não foi possível registrar sua oferta agora. Tente novamente em instantes.'));
    } finally {
      setSubmitting(false);
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

  const resetForm = () => {
    setGift(null);
    setActionError('');
    setFormError('');
    setAmountInput('');
    setCampaignId('');
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <PublicShell kicker="Oferta online" title="Carregando…">
        <section className="donate-card donate-center donate-muted">Buscando os dados da paróquia…</section>
      </PublicShell>
    );
  }

  if (!data) {
    return (
      <PublicShell kicker="Oferta online" title="Parish">
        <section className="donate-card">
          <div className="donate-alert is-error" role="alert">
            {loadError || 'Não foi possível carregar a página.'}
          </div>
        </section>
      </PublicShell>
    );
  }

  const { parish } = data;

  const pendingView = pending && (
    <section className="donate-card">
      <div className="donate-alert is-info" style={{ marginBottom: 12 }} role="status">
        Você já tem uma oferta de <strong>{money(pending.amount)}</strong> em aberto ({STATUS_INFO[pending.status].label.toLowerCase()}).
      </div>
      <div className="donate-actions is-row" style={{ marginTop: 0 }}>
        <button
          type="button"
          className="donate-btn is-secondary"
          onClick={() => {
            setGift(pending);
            setPending(null);
          }}
        >
          Continuar essa oferta
        </button>
        <Link className="donate-btn is-ghost" to={`/doar/recibo/${pending.token}`}>
          Acompanhar
        </Link>
      </div>
    </section>
  );

  const formView = (
    <section className="donate-card">
      <h2 className="donate-section-title">Fazer uma oferta</h2>
      <form onSubmit={handleSubmit} noValidate>
        {formError && (
          <div className="donate-alert is-error" role="alert">
            {formError}
          </div>
        )}

        {campaigns.length > 0 && (
          <div className="donate-field">
            <span className="donate-label" id="donate-destino-label">
              Para onde vai sua oferta?
            </span>
            <div className="donate-options" role="radiogroup" aria-labelledby="donate-destino-label">
              <button
                type="button"
                role="radio"
                aria-checked={campaignId === ''}
                className={`donate-option${campaignId === '' ? ' is-active' : ''}`}
                onClick={() => setCampaignId('')}
              >
                <div className="donate-option-title">Dízimo e ofertas da paróquia</div>
                <div className="donate-option-desc">Sustenta a vida da comunidade: liturgia, pastorais e manutenção.</div>
              </button>
              {campaigns.map((c) => {
                const active = campaignId === c.id;
                const meta = [c.goalAmount ? `Meta: ${money(c.goalAmount)}` : null, c.endsAt ? `até ${formatDate(c.endsAt)}` : null]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`donate-option${active ? ' is-active' : ''}`}
                    onClick={() => setCampaignId(c.id)}
                  >
                    <div className="donate-option-title">
                      <span>{c.name}</span>
                      <span className="donate-tag">{KIND_LABEL[c.kind]}</span>
                    </div>
                    {c.description && <div className="donate-option-desc">{c.description}</div>}
                    {meta && <div className="donate-option-meta">{meta}</div>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="donate-field">
          <label className="donate-label" htmlFor="donate-amount">
            Valor da oferta
          </label>
          {chips.length > 0 && (
            <div className="donate-chips">
              {chips.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`donate-chip${amountValue === value ? ' is-active' : ''}`}
                  onClick={() => setAmountInput(amountToInput(value))}
                >
                  {money(value)}
                </button>
              ))}
            </div>
          )}
          <div className="donate-amount-wrap">
            <span className="donate-amount-prefix" aria-hidden="true">
              R$
            </span>
            <input
              id="donate-amount"
              className="donate-input"
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              onBlur={() => {
                const parsed = parseAmount(amountInput);
                if (parsed !== null) setAmountInput(amountToInput(parsed));
              }}
              required
            />
          </div>
          <div className="donate-hint">Qualquer valor a partir de {money(MIN_AMOUNT)}.</div>
        </div>

        <div className="donate-field">
          <label className="donate-label" htmlFor="donate-name">
            Seu nome
          </label>
          <input
            id="donate-name"
            className="donate-input"
            type="text"
            autoComplete="name"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="donate-field">
          <label className="donate-label" htmlFor="donate-email">
            E-mail
          </label>
          <input
            id="donate-email"
            className="donate-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={120}
            placeholder="seu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <div className="donate-hint">Enviaremos o comprovante para este e-mail.</div>
        </div>

        {showCpf && (
          <div className="donate-field">
            <label className="donate-label" htmlFor="donate-cpf">
              CPF{method === 'PIX' ? ' (opcional)' : ''}
            </label>
            <input
              id="donate-cpf"
              className="donate-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="000.000.000-00"
              value={cpf}
              onChange={(e) => setCpf(maskCpf(e.target.value))}
              required={method !== 'PIX'}
            />
            <div className="donate-hint">
              {gateway?.needsCpfForAuto
                ? 'Com o CPF sua oferta é confirmada automaticamente.'
                : 'Usado apenas para identificar o pagamento.'}
            </div>
          </div>
        )}

        {showMethods && (
          <div className="donate-field">
            <span className="donate-label" id="donate-method-label">
              Como prefere pagar?
            </span>
            <div className="donate-segment" role="radiogroup" aria-labelledby="donate-method-label">
              {methods.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={method === m}
                  className={method === m ? 'is-active' : ''}
                  onClick={() => setMethod(m)}
                >
                  {METHOD_LABEL[m]}
                </button>
              ))}
            </div>
            {method !== 'PIX' && <div className="donate-hint">Cartão e boleto exigem CPF.</div>}
          </div>
        )}

        <div className="donate-field">
          <label className="donate-label" htmlFor="donate-message">
            Intenção ou mensagem (opcional)
          </label>
          <textarea
            id="donate-message"
            className="donate-input"
            maxLength={200}
            rows={3}
            placeholder="Ex.: em ação de graças, pela saúde de..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="donate-hint">{message.length}/200</div>
        </div>

        {/* Honeypot anti-robô: invisível e fora do fluxo de tabulação; pessoas nunca preenchem */}
        <div className="donate-honeypot" aria-hidden="true">
          <label htmlFor="donate-website">Website</label>
          <input
            id="donate-website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>

        <button type="submit" className="donate-btn" disabled={submitting} aria-busy={submitting}>
          {submitting ? 'Gerando…' : method === 'PIX' ? 'Gerar Pix' : 'Continuar'}
        </button>
        <p className="donate-hint donate-center" style={{ marginTop: 12 }}>
          Seus dados são usados apenas para registrar esta oferta e enviar o comprovante.{' '}
          <Link to="/privacidade">Política de privacidade</Link>
        </p>
      </form>
    </section>
  );

  const resultView = (current: Gift) => {
    const info = STATUS_INFO[current.status];
    const first = current.name.trim().split(/\s+/)[0] || current.name;
    const open = isGiftOpen(current.status);
    return (
      <section className="donate-card">
        <div className="donate-status">
          <span className={`donate-status-badge tone-${info.tone}`}>{info.label}</span>
          <h2 className="donate-status-title">{current.status === 'CONFIRMED' ? `Deus lhe pague, ${first}!` : `Obrigado, ${first}!`}</h2>
          <p className="donate-muted">
            Sua oferta de <strong>{money(current.amount)}</strong>
            {current.campaign ? (
              <>
                {' '}
                para <strong>{current.campaign.name}</strong>
              </>
            ) : null}
            {current.status === 'CONFIRMED' ? ' foi confirmada.' : ' foi registrada.'}
          </p>
        </div>

        {actionError && (
          <div className="donate-alert is-error" role="alert">
            {actionError}
          </div>
        )}

        {current.status === 'CONFIRMED' && (
          <>
            <div className="donate-alert is-success" role="status">
              Pagamento confirmado{current.confirmedAt ? ` em ${formatDateTime(current.confirmedAt)}` : ''}.{' '}
              {current.receiptSentAt ? 'O comprovante foi enviado' : 'O comprovante será enviado'}
              {email ? (
                <>
                  {' '}
                  para <strong>{email}</strong>.
                </>
              ) : (
                ' para o seu e-mail.'
              )}
            </div>
            <a className="donate-btn" href={receiptPdfUrl(current.token)} target="_blank" rel="noopener noreferrer">
              Baixar comprovante (PDF)
            </a>
          </>
        )}

        {current.status === 'CANCELLED' && (
          <div className="donate-alert is-warning" role="status">
            Esta oferta foi cancelada{current.note ? `: ${current.note}` : '.'} Se quiser, faça uma nova oferta.
          </div>
        )}

        {open && (
          <GiftPaymentPanel gift={current} merchantName={data.recipient?.merchantName} onDeclare={handleDeclare} declaring={declaring} />
        )}
        {open && (
          <p className="donate-muted donate-center" style={{ marginTop: 14 }}>
            {exhausted
              ? 'Paramos de atualizar automaticamente. Use "Acompanhar" para conferir depois.'
              : 'Esta página atualiza sozinha quando o pagamento for identificado.'}
          </p>
        )}

        <div className="donate-actions is-row">
          <Link className="donate-btn is-secondary" to={`/doar/recibo/${current.token}`}>
            Acompanhar esta oferta
          </Link>
          <button type="button" className="donate-btn is-ghost" onClick={resetForm}>
            Fazer outra oferta
          </button>
        </div>
        <p className="donate-hint donate-center">Guarde o link de acompanhamento para conferir a situação depois.</p>
      </section>
    );
  };

  return (
    <PublicShell kicker="Oferta online" title={parish.name} subtitle={parish.city} logoUrl={parish.logoUrl}>
      {parish.message && (
        <section className="donate-card">
          <p className="donate-message">{parish.message}</p>
        </section>
      )}

      {!data.available ? (
        <section className="donate-card">
          <div className="donate-alert is-warning" role="status">
            Esta paróquia ainda não recebe ofertas online.
          </div>
          <p className="donate-muted">Procure a secretaria paroquial para contribuir presencialmente. Deus lhe pague pela generosidade!</p>
        </section>
      ) : gift ? (
        resultView(gift)
      ) : (
        <>
          {pendingView}
          {formView}
        </>
      )}
    </PublicShell>
  );
};

export default DonatePage;
