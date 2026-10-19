import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import api, { getErrorMessage } from '../../services/api';
import { track } from '../../services/analytics';
import { maskBrPhone, phoneForApi } from '../../utils/phone';
import { SUPPORT_EMAIL, supportMailto, supportWhatsappUrl } from './LandingSupport';

/**
 * "Pedir demonstração" (saas-implantacao-14/18): cria um Lead no backend
 * (POST /public/leads). E-mail OU telefone obrigatório, consentimento para o
 * contato comercial (LGPD) e um campo-isca `website` escondido: robô que
 * preenche tudo recebe "enviado" sem nada sair do navegador.
 */

export interface DemoPrefill {
  parishId?: string;
  parishName?: string;
  city?: string;
  state?: string;
  /** Mensagem inicial (ex.: "Quero cuidar desta paróquia no Parish") */
  message?: string;
}

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

const CARGOS = [
  'Pároco ou administrador paroquial',
  'Vigário',
  'Secretária(o) paroquial',
  'Coordenação de pastoral ou comunidade',
  'Ecônomo / financeiro',
  'Cúria diocesana',
  'Outro',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface Props {
  prefill?: DemoPrefill | null;
  /** Muda a cada novo pré-preenchimento (para recarregar os campos) */
  prefillKey?: number;
}

const DemoRequestForm: React.FC<Props> = ({ prefill, prefillKey }) => {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [parishName, setParishName] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [parishId, setParishId] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(''); // isca para robôs
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!prefill) return;
    setParishId(prefill.parishId);
    if (prefill.parishName) setParishName(prefill.parishName);
    if (prefill.city) setCity(prefill.city);
    if (prefill.state) setState(prefill.state);
    if (prefill.message) setMessage(prefill.message);
    setSent(false);
    setError('');
  }, [prefill, prefillKey]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const nome = name.trim();
    const mail = email.trim();
    const fone = phoneForApi(phone);
    if (nome.length < 2) return setError('Informe o seu nome.');
    if (!mail && !fone) return setError('Informe um e-mail ou um telefone para respondermos.');
    if (mail && !EMAIL_RE.test(mail)) return setError('O e-mail parece incompleto.');
    if (fone && !/^\+55\d{10,11}$/.test(fone)) return setError('Confira o telefone com DDD.');
    if (!consent) return setError('Para respondermos, marque a autorização de contato.');

    // Robô (campo invisível preenchido): finge que deu certo e não envia
    if (website.trim()) {
      setSent(true);
      return;
    }

    setSending(true);
    try {
      await api.post(
        '/public/leads',
        {
          name: nome,
          ...(mail ? { email: mail } : {}),
          ...(fone ? { phone: fone } : {}),
          ...(role ? { role } : {}),
          ...(parishName.trim() ? { parishName: parishName.trim() } : {}),
          ...(city.trim() ? { city: city.trim() } : {}),
          ...(state ? { state } : {}),
          ...(parishId ? { parishId } : {}),
          ...(message.trim() ? { message: message.trim().slice(0, 2000) } : {}),
          source: 'DEMO_REQUEST',
          consent: true,
        },
        { timeout: 15_000 },
      );
      track('demo_request_sent');
      setSent(true);
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status === 429) {
        setError(`Recebemos muitos pedidos deste endereço. Tente de novo mais tarde ou escreva para ${SUPPORT_EMAIL}.`);
      } else if (status === 404 || !axios.isAxiosError(err) || !err.response) {
        setError(`Não conseguimos enviar agora. Escreva para ${SUPPORT_EMAIL} que respondemos por lá.`);
      } else {
        setError(getErrorMessage(err, 'Não foi possível enviar o pedido. Tente de novo.'));
      }
    } finally {
      setSending(false);
    }
  };

  const whats = supportWhatsappUrl('Olá! Quero conhecer o Parish para a minha paróquia.');

  if (sent) {
    return (
      <div className="lp-card lp-demo-ok" role="status">
        <h3 className="lp-h3">Pedido recebido. Obrigado!</h3>
        <p>
          Vamos falar com você em até 2 dias úteis para combinar a demonstração. Se preferir, adiante a conversa:
        </p>
        <p className="lp-demo-ok-links">
          <a href={supportMailto('Demonstração do Parish')}>{SUPPORT_EMAIL}</a>
          {whats && (
            <>
              {' · '}
              <a href={whats} target="_blank" rel="noopener noreferrer">
                WhatsApp
              </a>
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <form className="lp-card lp-form" onSubmit={submit} noValidate aria-describedby={error ? 'lp-demo-erro' : undefined}>
      <div className="lp-form-grid">
        <label className="lp-field">
          <span>Seu nome *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} required />
        </label>
        <label className="lp-field">
          <span>Cargo na paróquia</span>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Selecione</option>
            {CARGOS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="lp-field">
          <span>E-mail</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={160} />
        </label>
        <label className="lp-field">
          <span>Celular / WhatsApp</span>
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(maskBrPhone(e.target.value))}
            autoComplete="tel-national"
            placeholder="(42) 99999-8888"
          />
        </label>
        <label className="lp-field lp-field-largo">
          <span>Paróquia</span>
          <input value={parishName} onChange={(e) => { setParishName(e.target.value); setParishId(undefined); }} maxLength={160} />
        </label>
        <label className="lp-field">
          <span>Cidade</span>
          <input value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" maxLength={120} />
        </label>
        <label className="lp-field">
          <span>UF</span>
          <select value={state} onChange={(e) => setState(e.target.value)} autoComplete="address-level1">
            <option value="">—</option>
            {UFS.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </select>
        </label>
        <label className="lp-field lp-field-largo">
          <span>Conte um pouco do que a paróquia precisa (opcional)</span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={2000} />
        </label>
      </div>

      {/* Isca para robôs: fora da tela, fora do Tab e invisível para leitores de tela */}
      <div className="lp-hp" aria-hidden="true">
        <label>
          Site
          <input name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>

      <label className="lp-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          Autorizo o Parish a entrar em contato comigo por e-mail, telefone ou WhatsApp sobre este pedido. Veja a{' '}
          <Link to="/privacidade">Política de Privacidade</Link>.
        </span>
      </label>

      {error && (
        <p id="lp-demo-erro" className="lp-form-erro" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="lp-btn lp-btn-primary lp-btn-largo" disabled={sending} aria-busy={sending}>
        {sending ? 'Enviando…' : 'Pedir demonstração'}
      </button>
    </form>
  );
};

export default DemoRequestForm;
