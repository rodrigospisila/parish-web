import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { notify } from '../services/notification.service';
import './LoginPage.css';

const MIN_LENGTH = 8;

/**
 * Trocar a senha (M18). Duas entradas:
 * - obrigatória: conta criada ou senha redefinida pela gestão
 *   (`forcePasswordChange`) — o painel só libera o resto depois da troca;
 * - voluntária: pela tela de Segurança.
 * Ao trocar, as sessões dos outros aparelhos são encerradas no servidor.
 */
const ChangePasswordPage: React.FC = () => {
  const { user, changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const forced = !!user?.forcePasswordChange;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < MIN_LENGTH) {
      setError(`A nova senha precisa ter pelo menos ${MIN_LENGTH} caracteres.`);
      return;
    }
    if (newPassword !== confirmation) {
      setError('A confirmação não confere com a nova senha.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('A nova senha precisa ser diferente da atual.');
      return;
    }
    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      notify.success('Senha alterada. Os outros aparelhos precisarão entrar de novo.');
      navigate(forced ? '/admin' : '/admin/security', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível trocar a senha.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/brand/parish-logo-horizontal-cor.svg" alt="Parish" className="login-logo" />
        <p className="login-subtitle">Trocar a senha</p>

        {forced && (
          <p className="login-2fa-hint">
            Olá{user?.name ? `, ${user.name}` : ''}. Sua conta foi criada (ou a senha foi redefinida) pela
            secretaria. Para continuar, escolha uma senha nova — só você vai conhecê-la.
          </p>
        )}

        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="login-form">
          <div className="form-group">
            <label htmlFor="cp-current">{forced ? 'Senha recebida da secretaria' : 'Senha atual'}</label>
            <input
              id="cp-current"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="cp-new">Nova senha</label>
            <input
              id="cp-new"
              type="password"
              autoComplete="new-password"
              minLength={MIN_LENGTH}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              aria-describedby="cp-new-help"
            />
            <small id="cp-new-help" className="login-2fa-help">
              Pelo menos {MIN_LENGTH} caracteres.
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="cp-confirm">Repita a nova senha</label>
            <input
              id="cp-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="login-btn" disabled={saving} aria-busy={saving}>
            {saving ? 'Salvando...' : 'Trocar a senha'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 16 }}>
          {forced ? (
            <button type="button" className="login-link-btn" onClick={logout} disabled={saving}>
              Sair
            </button>
          ) : (
            <Link to="/admin/security">Voltar</Link>
          )}
        </p>
      </div>
    </div>
  );
};

export default ChangePasswordPage;
