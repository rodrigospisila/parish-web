import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import './LoginPage.css';

const API_URL = import.meta.env.VITE_API_URL;

/**
 * Recuperação de senha por autoatendimento (roadmap 1.4).
 * Etapa 1: solicitar o token (por e-mail ou telefone).
 * Etapa 2: informar o token recebido + nova senha.
 * A resposta da solicitação é sempre genérica (sem enumeração de contas).
 */
const ForgotPasswordPage: React.FC = () => {
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const res = await axios.post(`${API_URL}/auth/forgot-password`, { email });
      setMessage(res.data.message);
      setStep('reset');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Não foi possível processar a solicitação.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }

    setLoading(true);
    try {
      const res = await axios.post(`${API_URL}/auth/reset-password`, {
        token: token.trim(),
        newPassword,
      });
      setMessage(`${res.data.message}`);
      setStep('request');
      setToken('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Token inválido ou expirado.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Recuperar Senha</h1>
        <p className="login-subtitle">
          {step === 'request'
            ? 'Informe seu e-mail para receber o código de redefinição'
            : 'Informe o código recebido e sua nova senha'}
        </p>

        {error && <div className="error-message">{error}</div>}
        {message && (
          <div className="error-message" style={{ background: '#e8f5e9', color: '#1b5e20' }}>
            {message}
          </div>
        )}

        {step === 'request' ? (
          <form onSubmit={handleRequest} className="login-form">
            <div className="form-group">
              <label htmlFor="fp-email">E-mail</label>
              <input
                id="fp-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="seu@email.com"
              />
            </div>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Enviando...' : 'Enviar código'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleReset} className="login-form">
            <div className="form-group">
              <label htmlFor="fp-token">Código de redefinição</label>
              <input
                id="fp-token"
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                placeholder="cole o código recebido"
              />
            </div>
            <div className="form-group">
              <label htmlFor="fp-new">Nova senha</label>
              <input
                id="fp-new"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                placeholder="mínimo 8 caracteres"
              />
            </div>
            <div className="form-group">
              <label htmlFor="fp-confirm">Confirmar nova senha</label>
              <input
                id="fp-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                placeholder="repita a nova senha"
              />
            </div>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Redefinindo...' : 'Redefinir senha'}
            </button>
            <button
              type="button"
              className="login-btn"
              style={{ background: 'transparent', color: '#666', marginTop: 8 }}
              onClick={() => setStep('request')}
            >
              Solicitar outro código
            </button>
          </form>
        )}

        <p style={{ textAlign: 'center', marginTop: 16 }}>
          <Link to="/login">Voltar ao login</Link>
        </p>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
