import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import PublicFrame, {
  publicApi,
  publicMessage,
  sessionAccount,
  sessionAccountLabel,
  sessionAuthHeader,
} from '../../components/team/PublicFrame';
import { httpStatus, shortDate } from '../../components/team/teamApi';
import { maskBrPhone, phoneForApi, whatsappNumber } from '../../utils/phone';
import { SUPPORT_EMAIL } from './LandingSupport';

/**
 * Aceitar convite de equipe (Onda 1 — contrato C2; ux-acesso-05/29).
 * Rota pública: /convite/:token
 *
 * A pessoa confere quem convidou, cria a PRÓPRIA senha e aceita os termos. A
 * resposta do aceite é o mesmo corpo do POST /auth/login: a sessão é gravada
 * do mesmo jeito que o AuthContext grava no login (token, refreshToken e
 * user no localStorage) e a página recarrega no painel — o AuthProvider lê a
 * sessão no boot e o perfil é atualizado pelo /users/me.
 *
 * Com uma conta já conectada neste navegador, o convite pode ser aplicado
 * NELA (o servidor ignora senha, celular e e-mail nesse caso): o formulário
 * só pede o nome e o aceite, e diz que a senha continua a mesma. "Criar um
 * acesso novo" manda o pedido sem o Bearer.
 */

interface InviteInfo {
  role: string;
  roleLabel?: string | null;
  parishName?: string | null;
  communityName?: string | null;
  name?: string | null;
  emailMasked?: string | null;
  phoneMasked?: string | null;
  expiresAt?: string | null;
  invitedByName?: string | null;
}

interface LoginBody {
  requiresTwoFactor?: boolean;
  accessToken?: string;
  refreshToken?: string;
  user?: Record<string, unknown>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

const ROLE_WELCOME: Record<string, string> = {
  PARISH_ADMIN: 'Você vai cuidar da paróquia no painel: comunidades, equipe, membros e dízimo.',
  COMMUNITY_COORDINATOR: 'Você vai coordenar a comunidade: membros, pastorais, escalas e eventos.',
  PASTORAL_COORDINATOR: 'Você vai coordenar pastorais: montar escalas e acompanhar a equipe.',
  VOLUNTEER: 'Você vai ver as suas escalas, confirmar presença e pedir trocas pelo app.',
  FAITHFUL: 'Você vai acompanhar horários, avisos e a vida da comunidade pelo app.',
};

/** Força simples da senha (só orientação; a regra é a do servidor). */
function passwordStrength(value: string): { label: string; tone: string } | null {
  if (!value) return null;
  let score = 0;
  if (value.length >= MIN_PASSWORD) score++;
  if (value.length >= 12) score++;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
  if (/\d/.test(value)) score++;
  if (/[^A-Za-z0-9]/.test(value)) score++;
  if (value.length < MIN_PASSWORD) return { label: `Curta: use pelo menos ${MIN_PASSWORD} caracteres`, tone: '#b42318' };
  if (score <= 2) return { label: 'Fraca', tone: '#b54708' };
  if (score === 3) return { label: 'Boa', tone: '#075aa9' };
  return { label: 'Forte', tone: '#17643a' };
}

/** Grava a sessão como o AuthContext faz depois do POST /auth/login. */
function storeSession(data: LoginBody): boolean {
  if (!data?.accessToken || !data.user) return false;
  localStorage.setItem('token', data.accessToken);
  if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken);
  else localStorage.removeItem('refreshToken');
  localStorage.setItem('user', JSON.stringify(data.user));
  axios.defaults.headers.common['Authorization'] = `Bearer ${data.accessToken}`;
  return true;
}

const InviteAcceptPage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [gone, setGone] = useState('');
  const [loadError, setLoadError] = useState('');

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState(false);

  const [account] = useState(() => sessionAccount());
  /** Aplicar o convite na conta conectada (Bearer) em vez de criar outra */
  const [useOwnAccount, setUseOwnAccount] = useState(() => !!account);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    publicApi
      .get<InviteInfo>(`/public/invites/${encodeURIComponent(token)}`)
      .then(({ data }) => {
        if (cancelled) return;
        setInfo(data);
        setName((current) => current || data.name || account?.name || '');
      })
      .catch((error) => {
        if (cancelled) return;
        const status = httpStatus(error);
        if (status === 410 || status === 404) {
          setGone(publicMessage(error, 'Este convite não vale mais.'));
        } else {
          setLoadError(publicMessage(error, 'Não foi possível abrir o convite. Tente novamente em instantes.'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    const previous = document.title;
    document.title = info?.parishName ? `Convite — ${info.parishName}` : 'Convite — Parish';
    return () => {
      document.title = previous;
    };
  }, [info]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setFormError('');
    if (name.trim().length < 3) return setFormError('Informe o seu nome completo.');
    const withSession = useOwnAccount && !!account;
    const phoneValue = phoneForApi(phone);
    if (!withSession) {
      if (phone.trim() && !whatsappNumber(phone)) return setFormError('Confira o celular: DDD + número.');
      if (email.trim() && !EMAIL_RE.test(email.trim())) return setFormError('Confira o e-mail digitado.');
      if (!phoneValue && !email.trim()) {
        return setFormError('Informe o celular (ou um e-mail): é com ele que você vai entrar.');
      }
      if (password.length < MIN_PASSWORD) return setFormError(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
      if (password !== confirmPassword) return setFormError('As duas senhas não são iguais.');
    }
    if (!acceptTerms) return setFormError('Para continuar, aceite os Termos de Uso e a Política de Privacidade.');

    setSubmitting(true);
    try {
      const url = `/public/invites/${encodeURIComponent(token)}/accept`;
      let data: LoginBody;
      if (withSession) {
        // Conta conectada: o servidor aplica o papel nela e ignora senha/celular/e-mail — nada disso vai
        ({ data } = await publicApi.post<LoginBody>(url, { name: name.trim(), acceptTerms: true }, { headers: sessionAuthHeader() }));
      } else {
        const body: Record<string, unknown> = { name: name.trim(), password, acceptTerms: true };
        if (phoneValue) body.phone = phoneValue;
        if (email.trim()) body.email = email.trim();
        // Acesso novo: sem o Bearer (nunca liga o convite à conta conectada)
        ({ data } = await publicApi.post<LoginBody>(url, body));
      }
      if (data?.requiresTwoFactor) {
        // Conta existente com verificação em duas etapas: conclui pelo login normal
        navigate('/login', { replace: true });
        return;
      }
      if (!storeSession(data)) {
        setDone(true);
        return;
      }
      setDone(true);
      // Recarrega no painel: o AuthProvider lê a sessão gravada no boot
      window.location.replace('/admin');
    } catch (error) {
      const status = httpStatus(error);
      if (status === 410) {
        setGone(publicMessage(error, 'Este convite não vale mais.'));
        return;
      }
      if (status === 401 && useOwnAccount) {
        // Sessão deste navegador venceu: não dá para usar a conta sem entrar de novo
        setUseOwnAccount(false);
        setFormError(
          'Sua sessão neste navegador expirou. Entre de novo e abra este link outra vez para usar a sua conta — ou crie um acesso novo abaixo.',
        );
        return;
      }
      setFormError(publicMessage(error, 'Não foi possível criar o seu acesso. Tente novamente em instantes.'));
    } finally {
      setSubmitting(false);
    }
  };

  const where = info ? [info.communityName, info.parishName].filter(Boolean).join(' · ') : '';
  const strength = passwordStrength(password);
  const withSession = useOwnAccount && !!account;

  if (loading) {
    return (
      <PublicFrame kicker="Convite" title="Parish">
        <section className="donate-card donate-center donate-muted" role="status">
          Abrindo o convite…
        </section>
      </PublicFrame>
    );
  }

  if (gone) {
    return (
      <PublicFrame kicker="Convite" title="Este convite não vale mais">
        <section className="donate-card">
          <div className="donate-alert is-warning" role="alert">
            {gone}
          </div>
          <p className="donate-muted">
            Convites valem por 7 dias e só podem ser usados uma vez. Peça um novo link a quem convidou você (a secretaria
            ou a coordenação da paróquia).
          </p>
          <p className="donate-muted">
            Já criou o seu acesso? <Link to="/login">Entre com o seu celular ou e-mail</Link>.
          </p>
        </section>
      </PublicFrame>
    );
  }

  if (loadError || !info) {
    return (
      <PublicFrame kicker="Convite" title="Parish">
        <section className="donate-card">
          <div className="donate-alert is-error" role="alert">
            {loadError || 'Convite não encontrado.'}
          </div>
          <p className="donate-muted">
            Precisa de ajuda? Escreva para <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
        </section>
      </PublicFrame>
    );
  }

  const roleLabel = info.roleLabel || info.role;

  return (
    <PublicFrame kicker="Você recebeu um convite" title={info.parishName || 'Parish'} subtitle={info.communityName}>
      <section className="donate-card">
        <h2 className="donate-section-title">
          {info.invitedByName ? `${info.invitedByName} convidou você` : 'Você foi convidado(a)'} para o Parish
        </h2>
        <dl className="donate-details">
          <dt>Papel</dt>
          <dd>{roleLabel}</dd>
          {where && (
            <>
              <dt>Onde</dt>
              <dd>{where}</dd>
            </>
          )}
          {info.expiresAt && (
            <>
              <dt>Válido até</dt>
              <dd>{shortDate(info.expiresAt)}</dd>
            </>
          )}
        </dl>
        {ROLE_WELCOME[info.role] && <p className="donate-muted" style={{ marginBottom: 0 }}>{ROLE_WELCOME[info.role]}</p>}
      </section>

      <section className="donate-card">
        <h2 className="donate-section-title">{withSession ? 'Aceitar com a sua conta' : 'Crie o seu acesso'}</h2>
        {withSession && (
          <div className="donate-alert is-info" role="status" style={{ marginBottom: 12 }}>
            Você está conectado(a) como <strong>{sessionAccountLabel(account)}</strong>. O convite será aplicado nesta
            conta (vale se o celular ou o e-mail dela forem os do convite). <strong>Sua senha continua a mesma</strong> —
            não é preciso criar outra.{' '}
            <button
              type="button"
              className="donate-btn is-ghost"
              style={{ width: 'auto', padding: '4px 12px', marginTop: 8 }}
              onClick={() => {
                setUseOwnAccount(false);
                setFormError('');
              }}
            >
              Criar um acesso novo em vez disso
            </button>
          </div>
        )}
        {!withSession && account && (
          <div className="donate-alert is-info" role="status" style={{ marginBottom: 12 }}>
            O acesso novo será criado sem usar a conta conectada neste navegador.{' '}
            <button
              type="button"
              className="donate-btn is-ghost"
              style={{ width: 'auto', padding: '4px 12px', marginTop: 8 }}
              onClick={() => {
                setUseOwnAccount(true);
                setFormError('');
              }}
            >
              Usar a conta conectada
            </button>
          </div>
        )}
        <form onSubmit={submit} noValidate>
          {formError && (
            <div className="donate-alert is-error" role="alert" style={{ marginBottom: 12 }}>
              {formError}
            </div>
          )}
          <div className="donate-field">
            <label className="donate-label" htmlFor="invite-accept-name">
              Nome completo *
            </label>
            <input
              id="invite-accept-name"
              className="donate-input"
              autoComplete="name"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          {!withSession && (
            <>
              <div className="donate-field">
                <label className="donate-label" htmlFor="invite-accept-phone">
                  Celular *
                </label>
                <input
                  id="invite-accept-phone"
                  className="donate-input"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(00) 90000-0000"
                  value={phone}
                  onChange={(e) => setPhone(maskBrPhone(e.target.value))}
                  aria-describedby="invite-accept-phone-hint"
                />
                <div className="donate-hint" id="invite-accept-phone-hint">
                  Você vai entrar com este celular.
                  {info.phoneMasked ? ` O convite foi feito para ${info.phoneMasked}.` : ''}
                </div>
              </div>
              <div className="donate-field">
                <label className="donate-label" htmlFor="invite-accept-email">
                  E-mail (opcional)
                </label>
                <input
                  id="invite-accept-email"
                  className="donate-input"
                  type="email"
                  autoComplete="email"
                  maxLength={160}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-describedby="invite-accept-email-hint"
                />
                <div className="donate-hint" id="invite-accept-email-hint">
                  Serve para recuperar a senha.{info.emailMasked ? ` O convite foi feito para ${info.emailMasked}.` : ''}
                </div>
              </div>
              <div className="donate-field">
                <label className="donate-label" htmlFor="invite-accept-password">
                  Crie uma senha *
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    id="invite-accept-password"
                    className="donate-input"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-describedby="invite-accept-password-hint"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="donate-btn is-ghost"
                    style={{ width: 'auto', padding: '0 14px' }}
                    onClick={() => setShowPassword((v) => !v)}
                    aria-pressed={showPassword}
                    aria-controls="invite-accept-password"
                  >
                    {showPassword ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>
                <div className="donate-hint" id="invite-accept-password-hint" aria-live="polite">
                  {strength ? <span style={{ color: strength.tone, fontWeight: 600 }}>Senha: {strength.label}</span> : `Mínimo de ${MIN_PASSWORD} caracteres.`}
                </div>
              </div>
              <div className="donate-field">
                <label className="donate-label" htmlFor="invite-accept-password2">
                  Repita a senha *
                </label>
                <input
                  id="invite-accept-password2"
                  className="donate-input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            </>
          )}
          <label className="donate-field" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={acceptTerms}
              onChange={(e) => setAcceptTerms(e.target.checked)}
              style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0 }}
            />
            <span className="donate-hint" style={{ fontSize: '0.88rem' }}>
              Li e aceito os{' '}
              <Link to="/termos" target="_blank" rel="noopener noreferrer">
                Termos de Uso
              </Link>{' '}
              e a{' '}
              <Link to="/privacidade" target="_blank" rel="noopener noreferrer">
                Política de Privacidade
              </Link>
              .
            </span>
          </label>
          <button type="submit" className="donate-btn" disabled={submitting || done} aria-busy={submitting}>
            {submitting
              ? withSession
                ? 'Aplicando o convite…'
                : 'Criando o seu acesso…'
              : done
                ? 'Entrando…'
                : 'Aceitar convite e entrar'}
          </button>
          {done && (
            <p className="donate-hint donate-center" role="status" style={{ marginTop: 12 }}>
              {withSession ? 'Convite aceito!' : 'Acesso criado!'} Se a página não abrir sozinha, <Link to="/login">entre com o seu celular ou e-mail</Link>.
            </p>
          )}
        </form>
      </section>
    </PublicFrame>
  );
};

export default InviteAcceptPage;
