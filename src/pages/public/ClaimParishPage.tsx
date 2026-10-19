import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PublicFrame, { postWithOptionalSession, publicApi, publicMessage } from '../../components/team/PublicFrame';
import { httpStatus } from '../../components/team/teamApi';
import { maskBrPhone, phoneForApi, whatsappNumber } from '../../utils/phone';
import { SUPPORT_EMAIL } from './LandingSupport';

/**
 * "Esta paróquia é minha" (Onda 1 — contrato C1; ux-acesso-24).
 * Rota pública: /reivindicar/:parishId
 *
 * O pedido SEMPRE passa pela aprovação da equipe do Parish. O código enviado
 * ao contato OFICIAL da paróquia (cadastro do território) é só evidência.
 */

interface ClaimInfo {
  parishId: string;
  parishName: string;
  city?: string | null;
  state?: string | null;
  diocese?: string | null;
  managed: boolean;
  officialPhoneMasked?: string | null;
  officialEmailMasked?: string | null;
}

type Channel = 'PHONE' | 'EMAIL';
type Step = 'form' | 'verify' | 'code' | 'done';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Prazo de análise anunciado (dias úteis); configurável sem mexer no código. */
const REVIEW_DAYS = Number(import.meta.env.VITE_CLAIM_REVIEW_DAYS) > 0 ? Number(import.meta.env.VITE_CLAIM_REVIEW_DAYS) : 2;

/** Cargos aceitos no pedido (texto livre no servidor). */
const CLAIM_ROLES = [
  'Pároco',
  'Administrador paroquial',
  'Vigário paroquial',
  'Diácono',
  'Secretária(o) paroquial',
  'Coordenador(a) de comunidade',
  'Ecônomo / tesoureiro(a)',
  'Membro do conselho paroquial',
  'Outro',
];

const ClaimParishPage: React.FC = () => {
  const { parishId = '' } = useParams<{ parishId: string }>();
  const [info, setInfo] = useState<ClaimInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('');
  const [message, setMessage] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const [claimId, setClaimId] = useState('');
  const [canVerifyBy, setCanVerifyBy] = useState<Channel[]>([]);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [verifyNotice, setVerifyNotice] = useState('');
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);

  const stepHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    publicApi
      .get<ClaimInfo>(`/public/parishes/${encodeURIComponent(parishId)}/claim-info`)
      .then(({ data }) => {
        if (!cancelled) setInfo(data);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(
          httpStatus(error) === 404
            ? 'Paróquia não encontrada. Confira o link ou procure a paróquia no mapa do Parish.'
            : publicMessage(error, 'Não foi possível carregar os dados da paróquia. Tente novamente em instantes.'),
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
    document.title = info ? `Pedir acesso — ${info.parishName}` : 'Pedir acesso — Parish';
    return () => {
      document.title = previous;
    };
  }, [info]);

  // Leva o foco para o título de cada etapa (leitor de tela acompanha a troca)
  useEffect(() => {
    if (step !== 'form') stepHeadingRef.current?.focus();
  }, [step]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting || !info) return;
    setFormError('');
    if (name.trim().length < 3) return setFormError('Informe o seu nome completo.');
    if (!EMAIL_RE.test(email.trim())) return setFormError('Informe um e-mail válido para recebermos a resposta.');
    if (phone.trim() && !whatsappNumber(phone)) return setFormError('Confira o celular: DDD + número.');
    if (!role) return setFormError('Escolha o seu cargo na paróquia.');
    if (evidenceUrl.trim() && !/^https?:\/\/\S+$/i.test(evidenceUrl.trim())) {
      return setFormError('O link do documento deve começar com http:// ou https://');
    }
    if (!consent) return setFormError('Para enviar, autorize o uso dos dados para analisar o pedido.');

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        email: email.trim(),
        role,
        consent: true,
      };
      const phoneValue = phoneForApi(phone);
      if (phoneValue) body.phone = phoneValue;
      if (message.trim()) body.message = message.trim();
      if (evidenceUrl.trim()) body.evidenceUrl = evidenceUrl.trim();
      const data = await postWithOptionalSession<{ claimId: string; canVerifyBy?: Channel[] }>(
        `/public/parishes/${encodeURIComponent(info.parishId || parishId)}/claims`,
        body,
      );
      setClaimId(data.claimId);
      const channels = (data.canVerifyBy ?? []).filter((c) => c === 'PHONE' || c === 'EMAIL');
      setCanVerifyBy(channels);
      setChannel(channels[0] ?? null);
      setStep(channels.length > 0 ? 'verify' : 'done');
    } catch (error) {
      setFormError(publicMessage(error, 'Não foi possível enviar o pedido. Tente novamente em instantes.'));
    } finally {
      setSubmitting(false);
    }
  };

  const sendCode = async () => {
    if (!channel || busy) return;
    setBusy(true);
    setVerifyError('');
    setVerifyNotice('');
    try {
      const { data } = await publicApi.post<{ sentTo?: string }>(`/public/claims/${encodeURIComponent(claimId)}/send-code`, {
        channel,
      });
      setSentTo(data?.sentTo ?? '');
      setCode('');
      setStep('code');
    } catch (error) {
      if (httpStatus(error) === 503) {
        setVerifyNotice(
          channel === 'PHONE'
            ? 'O envio de código por SMS não está disponível agora. Sem problema: o seu pedido já foi registrado e a equipe do Parish confirma por outro meio.'
            : 'O envio de código por e-mail não está disponível agora. Sem problema: o seu pedido já foi registrado e a equipe do Parish confirma por outro meio.',
        );
      } else {
        setVerifyError(publicMessage(error, 'Não foi possível enviar o código. Tente de novo ou pule esta etapa.'));
      }
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) {
      setVerifyError('Digite os 6 números do código.');
      return;
    }
    setBusy(true);
    setVerifyError('');
    try {
      await publicApi.post(`/public/claims/${encodeURIComponent(claimId)}/verify`, { code: digits });
      setVerified(true);
      setStep('done');
    } catch (error) {
      setVerifyError(publicMessage(error, 'Código incorreto ou vencido. Confira e tente de novo.'));
    } finally {
      setBusy(false);
    }
  };

  const subtitle = info
    ? [info.city && info.state ? `${info.city} - ${info.state}` : info.city, info.diocese].filter(Boolean).join(' · ')
    : null;

  if (loading) {
    return (
      <PublicFrame kicker="Parish para paróquias" title="Pedir acesso">
        <section className="donate-card donate-center donate-muted" role="status">
          Buscando os dados da paróquia…
        </section>
      </PublicFrame>
    );
  }

  if (loadError || !info) {
    return (
      <PublicFrame kicker="Parish para paróquias" title="Pedir acesso">
        <section className="donate-card">
          <div className="donate-alert is-error" role="alert">
            {loadError || 'Paróquia não encontrada.'}
          </div>
          <p className="donate-muted">
            Precisa de ajuda? Escreva para <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
        </section>
      </PublicFrame>
    );
  }

  const officialFor = (c: Channel) => (c === 'PHONE' ? info.officialPhoneMasked : info.officialEmailMasked);

  return (
    <PublicFrame kicker="Sou da equipe desta paróquia" title={info.parishName} subtitle={subtitle}>
      {step === 'form' && (
        <>
          <section className="donate-card">
            <h2 className="donate-section-title">Quero usar o Parish nesta paróquia</h2>
            <p className="donate-muted" style={{ marginTop: 0 }}>
              Envie o pedido de gestão. A equipe do Parish confere quem é você e libera o acesso de administrador. Depois
              da aprovação, as comunidades ganham <strong>30 dias de teste</strong> com todos os recursos.
            </p>
            {info.managed && (
              <div className="donate-alert is-warning" role="status">
                Esta paróquia já tem uma equipe usando o Parish. Se você faz parte dela, peça um convite à administração
                da paróquia. Se acha que é um engano, envie o pedido mesmo assim: ele será analisado com cuidado.
              </div>
            )}
          </section>

          <section className="donate-card">
            <form onSubmit={submit} noValidate>
              {formError && (
                <div className="donate-alert is-error" role="alert" style={{ marginBottom: 12 }}>
                  {formError}
                </div>
              )}
              <div className="donate-field">
                <label className="donate-label" htmlFor="claim-name">
                  Seu nome completo *
                </label>
                <input
                  id="claim-name"
                  className="donate-input"
                  autoComplete="name"
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="donate-field">
                <label className="donate-label" htmlFor="claim-email">
                  E-mail *
                </label>
                <input
                  id="claim-email"
                  className="donate-input"
                  type="email"
                  autoComplete="email"
                  maxLength={160}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  aria-describedby="claim-email-hint"
                />
                <div className="donate-hint" id="claim-email-hint">
                  Prefira o e-mail institucional da paróquia ou da diocese.
                </div>
              </div>
              <div className="donate-field">
                <label className="donate-label" htmlFor="claim-phone">
                  Celular (WhatsApp)
                </label>
                <input
                  id="claim-phone"
                  className="donate-input"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(00) 90000-0000"
                  value={phone}
                  onChange={(e) => setPhone(maskBrPhone(e.target.value))}
                />
              </div>
              <div className="donate-field">
                <label className="donate-label" htmlFor="claim-role">
                  Seu cargo na paróquia *
                </label>
                <select id="claim-role" className="donate-input" value={role} onChange={(e) => setRole(e.target.value)} required>
                  <option value="">Selecione</option>
                  {CLAIM_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div className="donate-field">
                <label className="donate-label" htmlFor="claim-message">
                  Mensagem (opcional)
                </label>
                <textarea
                  id="claim-message"
                  className="donate-input"
                  rows={3}
                  maxLength={1000}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Ex.: sou a secretária desde 2019; o pároco é o Pe. João."
                />
              </div>
              <div className="donate-field">
                <label className="donate-label" htmlFor="claim-evidence">
                  Link da provisão ou carta do pároco (opcional)
                </label>
                <input
                  id="claim-evidence"
                  className="donate-input"
                  type="url"
                  inputMode="url"
                  maxLength={500}
                  placeholder="https://"
                  value={evidenceUrl}
                  onChange={(e) => setEvidenceUrl(e.target.value)}
                  aria-describedby="claim-evidence-hint"
                />
                <div className="donate-hint" id="claim-evidence-hint">
                  Um documento compartilhado (Drive, site da diocese) agiliza a análise.
                </div>
              </div>
              <label className="donate-field" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0 }}
                />
                <span className="donate-hint" style={{ fontSize: '0.88rem' }}>
                  Autorizo o Parish a usar estes dados para analisar o pedido e entrar em contato comigo. Veja a{' '}
                  <Link to="/privacidade" target="_blank" rel="noopener noreferrer">
                    Política de Privacidade
                  </Link>
                  .
                </span>
              </label>
              <button type="submit" className="donate-btn" disabled={submitting} aria-busy={submitting}>
                {submitting ? 'Enviando…' : 'Enviar pedido'}
              </button>
              <p className="donate-hint donate-center" style={{ marginTop: 12 }}>
                Já tem acesso? <Link to="/login">Entrar no painel</Link>
              </p>
            </form>
          </section>
        </>
      )}

      {(step === 'verify' || step === 'code') && (
        <section className="donate-card">
          <h2 className="donate-section-title" tabIndex={-1} ref={stepHeadingRef}>
            Pedido registrado. Quer agilizar?
          </h2>
          <p className="donate-muted" style={{ marginTop: 0 }}>
            Opcional: confirme pelo contato <strong>oficial</strong> da paróquia (o do cadastro público). Isso ajuda a
            equipe do Parish a conferir o pedido — a aprovação continua sendo feita por ela.
          </p>

          {step === 'verify' && (
            <>
              <div className="donate-options" role="radiogroup" aria-label="Onde receber o código">
                {canVerifyBy.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={channel === c}
                    className={`donate-option${channel === c ? ' is-active' : ''}`}
                    onClick={() => setChannel(c)}
                  >
                    <div className="donate-option-title">
                      {c === 'PHONE' ? 'Código no telefone oficial' : 'Código no e-mail oficial'}
                    </div>
                    <div className="donate-option-desc">{officialFor(c) || 'Contato do cadastro da paróquia'}</div>
                  </button>
                ))}
              </div>
              {verifyNotice && (
                <div className="donate-alert is-info" role="status" style={{ marginTop: 12 }}>
                  {verifyNotice}
                </div>
              )}
              {verifyError && (
                <div className="donate-alert is-error" role="alert" style={{ marginTop: 12 }}>
                  {verifyError}
                </div>
              )}
              <div className="donate-actions is-row">
                <button type="button" className="donate-btn" onClick={() => void sendCode()} disabled={!channel || busy}>
                  {busy ? 'Enviando…' : 'Enviar código'}
                </button>
                <button type="button" className="donate-btn is-ghost" onClick={() => setStep('done')} disabled={busy}>
                  Pular esta etapa
                </button>
              </div>
            </>
          )}

          {step === 'code' && (
            <form onSubmit={verify} noValidate>
              <div className="donate-alert is-success" role="status" style={{ marginBottom: 12 }}>
                Enviamos um código de 6 números para {sentTo || officialFor(channel ?? 'PHONE') || 'o contato oficial'}. Ele
                vale por 30 minutos.
              </div>
              {verifyError && (
                <div className="donate-alert is-error" role="alert" style={{ marginBottom: 12 }}>
                  {verifyError}
                </div>
              )}
              <div className="donate-field">
                <label className="donate-label" htmlFor="claim-code">
                  Código recebido
                </label>
                <input
                  id="claim-code"
                  className="donate-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  style={{ letterSpacing: '0.3em', fontSize: '1.3rem', textAlign: 'center' }}
                />
              </div>
              <div className="donate-actions is-row">
                <button type="submit" className="donate-btn" disabled={busy} aria-busy={busy}>
                  {busy ? 'Conferindo…' : 'Confirmar código'}
                </button>
                <button type="button" className="donate-btn is-secondary" onClick={() => setStep('verify')} disabled={busy}>
                  Reenviar / trocar canal
                </button>
                <button type="button" className="donate-btn is-ghost" onClick={() => setStep('done')} disabled={busy}>
                  Pular esta etapa
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {step === 'done' && (
        <section className="donate-card">
          <div className="donate-status">
            <span className="donate-status-badge tone-declared">Pedido recebido</span>
            <h2 className="donate-status-title" tabIndex={-1} ref={stepHeadingRef}>
              Obrigado{name.trim() ? `, ${name.trim().split(/\s+/)[0]}` : ''}!
            </h2>
            <p className="donate-muted">
              A equipe do Parish analisa o pedido em até <strong>{REVIEW_DAYS} dias úteis</strong>.
            </p>
          </div>
          {verified && (
            <div className="donate-alert is-success" role="status">
              Contato oficial confirmado — isso agiliza a análise.
            </div>
          )}
          <ol className="donate-muted" style={{ paddingLeft: '1.2rem', lineHeight: 1.6 }}>
            <li>Conferimos o pedido (e, se preciso, falamos com você por {email.trim() ? 'e-mail' : 'telefone'}).</li>
            <li>Aprovado, você recebe um link para criar o seu acesso de administrador da paróquia.</li>
            <li>As comunidades da paróquia ganham 30 dias de teste, sem cartão e sem compromisso.</li>
          </ol>
          <p className="donate-hint">
            Dúvidas? Escreva para <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
        </section>
      )}
    </PublicFrame>
  );
};

export default ClaimParishPage;
