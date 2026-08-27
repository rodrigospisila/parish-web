import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth, AuthError } from '../contexts/AuthContext';
import { notify } from '../services/notification.service';
import './LoginPage.css';

type Step = 'credentials' | 'twoFactor';

// Código TOTP (6 dígitos) ou código de recuperação (XXXXX-XXXXX)
const TOTP_PATTERN = /^\d{6}$/;
const RECOVERY_PATTERN = /^[a-z0-9]{5}-[a-z0-9]{5}$/i;

function isValidCode(value: string): boolean {
  return TOTP_PATTERN.test(value) || RECOVERY_PATTERN.test(value);
}

const LoginPage: React.FC = () => {
  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [challengeName, setChallengeName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { login, loginWithTwoFactor } = useAuth();
  const navigate = useNavigate();

  /** Mesmo fluxo de sessão para login direto e para o login concluído com 2FA. */
  const finishLogin = (newDevice: boolean) => {
    if (newDevice) {
      notify.info('Primeiro acesso neste dispositivo');
    }
    navigate('/admin');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await login(email, password);
      if (result.requiresTwoFactor) {
        setChallengeToken(result.challengeToken);
        setChallengeName(result.user.name || result.user.email);
        setCode('');
        setStep('twoFactor');
        return;
      }
      finishLogin(result.newDevice);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer login');
    } finally {
      setLoading(false);
    }
  };

  const backToCredentials = (message = '') => {
    setStep('credentials');
    setChallengeToken('');
    setCode('');
    setPassword('');
    setError(message);
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!isValidCode(trimmed)) {
      setError('Informe o código de 6 dígitos do autenticador ou um código de recuperação (XXXXX-XXXXX).');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const result = await loginWithTwoFactor(challengeToken, trimmed);
      if (result.requiresTwoFactor) {
        setError('A verificação não foi concluída. Tente novamente.');
        return;
      }
      finishLogin(result.newDevice);
    } catch (err) {
      // Desafio expirado (401): volta à etapa de e-mail/senha
      const expired = err instanceof AuthError && err.status === 401 && /expir/i.test(err.message);
      if (expired) {
        backToCredentials('A verificação expirou. Faça login novamente.');
        return;
      }
      setError(err instanceof Error ? err.message : 'Código inválido');
    } finally {
      setLoading(false);
    }
  };

  const handleCodeChange = (value: string) => {
    // Mantém apenas dígitos, letras e hífen (código TOTP ou de recuperação)
    setCode(value.replace(/[^a-z0-9-]/gi, '').slice(0, 11));
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/brand/parish-logo-horizontal-cor.svg" alt="Parish" className="login-logo" />
        <p className="login-tagline">Comunidade, fé e serviço.</p>
        <p className="login-subtitle">
          {step === 'credentials' ? 'Faça login para continuar' : 'Verificação em duas etapas'}
        </p>

        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}

        {step === 'credentials' ? (
          <>
            <form onSubmit={handleSubmit} className="login-form">
              <div className="form-group">
                <label htmlFor="login-email">Email</label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="seu@email.com"
                />
              </div>

              <div className="form-group">
                <label htmlFor="login-password">Senha</label>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                />
              </div>

              <button type="submit" className="login-btn" disabled={loading} aria-busy={loading}>
                {loading ? 'Entrando...' : 'Entrar'}
              </button>
            </form>

            <p style={{ textAlign: 'center', marginTop: 16 }}>
              <Link to="/forgot-password">Esqueci minha senha</Link>
            </p>
          </>
        ) : (
          <>
            <p className="login-2fa-hint">
              Olá, <strong>{challengeName}</strong>. Digite o código do seu aplicativo autenticador.
              Se não tiver acesso a ele, use um dos seus códigos de recuperação.
            </p>

            <form onSubmit={handleCodeSubmit} className="login-form">
              <div className="form-group">
                <label htmlFor="login-2fa-code">Código do autenticador</label>
                <input
                  id="login-2fa-code"
                  type="text"
                  className="login-code-input"
                  inputMode="text"
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  autoFocus
                  value={code}
                  onChange={(e) => handleCodeChange(e.target.value)}
                  required
                  maxLength={11}
                  placeholder="000000"
                  aria-describedby="login-2fa-help"
                />
                <small id="login-2fa-help" className="login-2fa-help">
                  6 dígitos ou código de recuperação no formato XXXXX-XXXXX
                </small>
              </div>

              <button type="submit" className="login-btn" disabled={loading} aria-busy={loading}>
                {loading ? 'Verificando...' : 'Entrar'}
              </button>
            </form>

            <p style={{ textAlign: 'center', marginTop: 16 }}>
              <button
                type="button"
                className="login-link-btn"
                onClick={() => backToCredentials()}
                disabled={loading}
              >
                Voltar
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
