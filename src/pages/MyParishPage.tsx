import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import TitleIcon from '../components/TitleIcon';
import api, { getErrorMessage } from '../services/api';
import { notify } from '../services/notification.service';
import { useAuth } from '../contexts/AuthContext';
import { formatPhoneDisplay } from '../utils/phone';
import { todayStamp } from '../utils/csvExport';
import { SUPPORT_EMAIL } from './public/LandingSupport';
import { cnpjDigits, isValidCnpj, maskCnpj } from '../components/team/cnpj';
import './modules/ModulePages.css';
import './MyParishPage.css';

/**
 * "Minha paróquia" (Onda 1 — C5; cat-gestao-31, saas-implantacao-19).
 * Rota: /admin/minha-paroquia (administração paroquial)
 *
 * Dados da paróquia com CNPJ, exportação completa (ZIP com CSV por entidade)
 * e pedido de encerramento da conta (30 dias; nada é apagado sem a equipe do
 * Parish confirmar).
 */

interface ParishData {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  zipCode?: string | null;
  phone?: string | null;
  email?: string | null;
  cnpj?: string | null;
  diocese?: { id: string; name: string } | null;
  managedAt?: string | null;
  closureRequestedAt?: string | null;
  closureEffectiveAt?: string | null;
}

const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleDateString('pt-BR') : '');

const slugify = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'paroquia';

/** Erro de uma resposta em Blob (exportação): lê a mensagem JSON do corpo. */
async function blobErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
    try {
      const parsed = JSON.parse(await error.response.data.text());
      const message = Array.isArray(parsed?.message) ? parsed.message.join('; ') : parsed?.message;
      if (typeof message === 'string' && message.trim()) return message;
    } catch {
      // corpo não é JSON
    }
  }
  return getErrorMessage(error, fallback);
}

type Dialog = null | 'export' | 'closure';

/** Estado do pedido de encerramento: datas conhecidas, "existe mas sem data" (409) ou nenhum. */
interface ClosureState {
  requestedAt: string | null;
  effectiveAt: string | null;
}

/**
 * O GET /parishes/:id ainda não devolve closureRequestedAt/closureEffectiveAt
 * (select do ParishesService.findOne). Enquanto isso, a tela usa a resposta do
 * POST/DELETE de closure-request e guarda o pedido neste navegador; quando o GET
 * passar a trazer os campos, eles vencem.
 */
const closureKey = (parishId: string) => `parish-closure:${parishId}`;

function readStoredClosure(parishId: string): ClosureState | null {
  try {
    const raw = localStorage.getItem(closureKey(parishId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? { requestedAt: parsed.requestedAt ?? null, effectiveAt: parsed.effectiveAt ?? null }
      : null;
  } catch {
    return null;
  }
}

function storeClosure(parishId: string, value: ClosureState | null) {
  try {
    if (value) localStorage.setItem(closureKey(parishId), JSON.stringify(value));
    else localStorage.removeItem(closureKey(parishId));
  } catch {
    // armazenamento indisponível: só não lembra entre visitas
  }
}

const MyParishPage: React.FC = () => {
  const { user } = useAuth();
  const parishId = user?.parishId ?? '';
  const [parish, setParish] = useState<ParishData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [cnpj, setCnpj] = useState('');
  const [cnpjError, setCnpjError] = useState('');
  const [savingCnpj, setSavingCnpj] = useState(false);

  const [dialog, setDialog] = useState<Dialog>(null);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [working, setWorking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [closure, setClosure] = useState<ClosureState | null>(null);
  /** O GET traz os campos do encerramento? (senão, oferece "cancelar pedido existente") */
  const [closureFromServer, setClosureFromServer] = useState(false);

  const applyClosure = useCallback(
    (value: ClosureState | null) => {
      setClosure(value);
      if (parishId) storeClosure(parishId, value);
    },
    [parishId],
  );

  const load = useCallback(async () => {
    if (!parishId) {
      setLoading(false);
      setLoadError('Sua conta não está ligada a uma paróquia.');
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const { data } = await api.get<ParishData>(`/parishes/${parishId}`);
      setParish(data);
      setCnpj(maskCnpj(data.cnpj));
      if (data && 'closureRequestedAt' in data) {
        setClosureFromServer(true);
        const value = data.closureRequestedAt
          ? { requestedAt: data.closureRequestedAt, effectiveAt: data.closureEffectiveAt ?? null }
          : null;
        setClosure(value);
        storeClosure(parishId, value);
      } else {
        setClosureFromServer(false);
        setClosure(readStoredClosure(parishId));
      }
    } catch (error) {
      setLoadError(getErrorMessage(error, 'Não foi possível carregar os dados da paróquia'));
    } finally {
      setLoading(false);
    }
  }, [parishId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!dialog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !working) setDialog(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dialog, working]);

  const openDialog = (kind: Dialog) => {
    setPassword('');
    setReason('');
    setUnderstood(false);
    setDialogError('');
    setDialog(kind);
  };

  const saveCnpj = async (event: React.FormEvent) => {
    event.preventDefault();
    setCnpjError('');
    const digits = cnpjDigits(cnpj);
    if (digits && !isValidCnpj(digits)) {
      setCnpjError('CNPJ inválido. Confira os números (14 dígitos).');
      return;
    }
    setSavingCnpj(true);
    try {
      await api.patch(`/parishes/${parishId}`, { cnpj: digits || null });
      notify.success(digits ? 'CNPJ salvo. Ele passa a sair nos recibos e documentos.' : 'CNPJ removido.');
      await load();
    } catch (error) {
      setCnpjError(getErrorMessage(error, 'Não foi possível salvar o CNPJ'));
    } finally {
      setSavingCnpj(false);
    }
  };

  const exportAll = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password) {
      setDialogError('Digite a sua senha para confirmar.');
      return;
    }
    setWorking(true);
    setDialogError('');
    try {
      const response = await api.post(`/parishes/${parishId}/export`, { password }, { responseType: 'blob', timeout: 300_000 });
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `parish-${slugify(parish?.name ?? 'paroquia')}-${todayStamp()}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setDialog(null);
      notify.success('Exportação pronta. O arquivo foi baixado — guarde em local seguro: ele tem dados pessoais.');
    } catch (error) {
      setDialogError(await blobErrorMessage(error, 'Não foi possível gerar a exportação'));
    } finally {
      setWorking(false);
    }
  };

  const requestClosure = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reason.trim().length < 5) {
      setDialogError('Conte em poucas palavras o motivo do encerramento.');
      return;
    }
    if (!understood) {
      setDialogError('Confirme que entendeu como funciona o encerramento.');
      return;
    }
    if (!password) {
      setDialogError('Digite a sua senha para confirmar.');
      return;
    }
    setWorking(true);
    setDialogError('');
    try {
      const { data } = await api.post(`/parishes/${parishId}/closure-request`, { password, reason: reason.trim() });
      applyClosure({
        requestedAt: data?.closureRequestedAt ?? new Date().toISOString(),
        effectiveAt: data?.closureEffectiveAt ?? null,
      });
      setDialog(null);
      notify.info('Pedido de encerramento registrado. A equipe do Parish vai entrar em contato.');
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        // Já existe um pedido (feito por outra pessoa ou em outro navegador): mostra o estado e o botão de cancelar
        applyClosure(closure ?? { requestedAt: null, effectiveAt: null });
        setDialog(null);
        notify.info('Já existe um pedido de encerramento para esta paróquia. Você pode cancelá-lo no aviso do topo.');
      } else {
        setDialogError(getErrorMessage(error, 'Não foi possível registrar o pedido'));
      }
    } finally {
      setWorking(false);
    }
  };

  const cancelClosure = async () => {
    setCancelling(true);
    try {
      await api.delete(`/parishes/${parishId}/closure-request`);
      applyClosure(null);
      notify.success('Pedido de encerramento cancelado. A conta segue normalmente.');
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        // Não há pedido (já cancelado por outra pessoa)
        applyClosure(null);
        notify.info('Não há pedido de encerramento em andamento para esta paróquia.');
      } else {
        notify.error(getErrorMessage(error, 'Não foi possível cancelar o pedido'));
      }
    } finally {
      setCancelling(false);
    }
  };

  if (loading) return <div className="loading">Carregando…</div>;

  if (loadError || !parish) {
    return (
      <div className="module-page my-parish">
        <div className="my-parish__alert is-error" role="alert">
          {loadError || 'Paróquia não encontrada.'}{' '}
          <button type="button" className="btn-small" onClick={() => void load()}>
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  const closurePending = Boolean(closure);
  const cityState = [parish.city, parish.state].filter(Boolean).join(' - ');

  return (
    <div className="module-page my-parish">
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center' }}>
          <TitleIcon name="paroquia" /> Minha paróquia
        </h1>
      </div>

      {closurePending && (
        <div className="my-parish__alert is-warning" role="status">
          <strong>
            {closure?.requestedAt
              ? `Encerramento pedido em ${formatDate(closure.requestedAt)}.`
              : 'Há um pedido de encerramento da conta em andamento.'}
          </strong>{' '}
          {closure?.effectiveAt
            ? `Previsto para ${formatDate(closure.effectiveAt)}. `
            : 'Previsto para 30 dias após o pedido. '}
          Até lá tudo funciona normalmente e nada é apagado sem a confirmação da equipe do Parish.{' '}
          <button type="button" className="btn-small" onClick={() => void cancelClosure()} disabled={cancelling}>
            {cancelling ? 'Cancelando…' : 'Cancelar o pedido'}
          </button>
        </div>
      )}

      <section className="my-parish__card" aria-labelledby="my-parish-data">
        <h2 id="my-parish-data">Dados da paróquia</h2>
        <dl className="my-parish__details">
          <dt>Nome</dt>
          <dd>{parish.name}</dd>
          {parish.diocese?.name && (
            <>
              <dt>Diocese</dt>
              <dd>{parish.diocese.name}</dd>
            </>
          )}
          {cityState && (
            <>
              <dt>Cidade</dt>
              <dd>{cityState}</dd>
            </>
          )}
          {parish.address && (
            <>
              <dt>Endereço</dt>
              <dd>
                {parish.address}
                {parish.zipCode ? ` · CEP ${parish.zipCode}` : ''}
              </dd>
            </>
          )}
          {parish.phone && (
            <>
              <dt>Telefone</dt>
              <dd>{formatPhoneDisplay(parish.phone)}</dd>
            </>
          )}
          {parish.email && (
            <>
              <dt>E-mail</dt>
              <dd>{parish.email}</dd>
            </>
          )}
        </dl>
        <p className="my-parish__muted">
          Endereço, telefone e e-mail aparecem para os fiéis no app e no mapa.{' '}
          <Link to="/admin/parishes">Editar estes dados</Link>
        </p>

        <form onSubmit={saveCnpj} className="my-parish__cnpj" noValidate>
          <label htmlFor="my-parish-cnpj">CNPJ da paróquia</label>
          <div className="my-parish__row">
            <input
              id="my-parish-cnpj"
              inputMode="numeric"
              placeholder="00.000.000/0000-00"
              value={cnpj}
              onChange={(e) => setCnpj(maskCnpj(e.target.value))}
              aria-describedby="my-parish-cnpj-hint"
              aria-invalid={Boolean(cnpjError)}
            />
            <button type="submit" className="btn-primary" disabled={savingCnpj || cnpj === maskCnpj(parish.cnpj)}>
              {savingCnpj ? 'Salvando…' : 'Salvar CNPJ'}
            </button>
          </div>
          <span id="my-parish-cnpj-hint" className="my-parish__muted">
            Em geral, o CNPJ da filial da Mitra Diocesana. Sai nos recibos de doação, comprovantes de dízimo e balancetes.
          </span>
          {cnpjError && (
            <span className="my-parish__error" role="alert">
              {cnpjError}
            </span>
          )}
        </form>
      </section>

      <section className="my-parish__card" aria-labelledby="my-parish-export">
        <h2 id="my-parish-export">Exportar todos os dados</h2>
        <p>
          Baixe um arquivo .zip com planilhas (CSV) de tudo o que a paróquia registrou no Parish: membros, sacramentos,
          turmas e chamadas, escalas, dízimo, financeiro e documentos. Os dados são da paróquia — você pode levá-los
          quando quiser.
        </p>
        <p className="my-parish__muted">
          Disponível para o titular da paróquia. O arquivo contém dados pessoais: guarde-o em local seguro. A exportação
          fica registrada na auditoria.
        </p>
        <button type="button" className="btn-primary" onClick={() => openDialog('export')}>
          Exportar todos os dados
        </button>
      </section>

      <section className="my-parish__card is-danger" aria-labelledby="my-parish-closure">
        <h2 id="my-parish-closure">Encerrar a conta da paróquia</h2>
        <ul className="my-parish__list">
          <li>O encerramento vale 30 dias depois do pedido. Até lá, tudo funciona e você pode cancelar.</li>
          <li>Antes de encerrar, exporte os dados: a paróquia fica com a cópia completa.</li>
          <li>
            <strong>Nada é apagado automaticamente.</strong> A equipe do Parish entra em contato para confirmar antes de
            eliminar qualquer dado; o perfil público da paróquia (endereço e horários de missa) continua no mapa.
          </li>
        </ul>
        {!closurePending ? (
          <>
            <button type="button" className="btn-small danger" onClick={() => openDialog('closure')}>
              Pedir o encerramento da conta
            </button>
            {!closureFromServer && (
              <p className="my-parish__muted">
                Alguém da paróquia já pediu o encerramento?{' '}
                <button type="button" className="btn-small" onClick={() => void cancelClosure()} disabled={cancelling}>
                  {cancelling ? 'Cancelando…' : 'Cancelar o pedido existente'}
                </button>
              </p>
            )}
          </>
        ) : (
          <p className="my-parish__muted">Já existe um pedido em andamento (veja o aviso no topo da página).</p>
        )}
        <p className="my-parish__muted">
          Dúvidas? Fale com a gente: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </section>

      {dialog && (
        <div className="module-modal-overlay">
          <div
            className="module-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="my-parish-dialog-title"
            style={{ maxWidth: 480 }}
          >
            <h2 id="my-parish-dialog-title">{dialog === 'export' ? 'Exportar todos os dados' : 'Encerrar a conta'}</h2>
            <form onSubmit={dialog === 'export' ? exportAll : requestClosure} noValidate>
              {dialogError && (
                <div className="my-parish__alert is-error" role="alert">
                  {dialogError}
                </div>
              )}
              {dialog === 'export' ? (
                <p className="my-parish__muted" style={{ marginTop: 0 }}>
                  Pode levar alguns minutos em paróquias grandes. Não feche esta página até o download começar.
                </p>
              ) : (
                <>
                  <div className="form-group">
                    <label htmlFor="closure-reason">Motivo *</label>
                    <textarea
                      id="closure-reason"
                      rows={3}
                      maxLength={1000}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <label className="form-check">
                    <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
                    <span>
                      Entendi: o encerramento vale em 30 dias, posso cancelar até lá e nada é apagado sem a confirmação
                      da equipe do Parish.
                    </span>
                  </label>
                </>
              )}
              <div className="form-group">
                <label htmlFor="my-parish-password">Sua senha *</label>
                <input
                  id="my-parish-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus={dialog === 'export'}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setDialog(null)} disabled={working}>
                  Voltar
                </button>
                <button type="submit" className="btn-submit" disabled={working} aria-busy={working}>
                  {working
                    ? dialog === 'export'
                      ? 'Gerando o arquivo…'
                      : 'Registrando…'
                    : dialog === 'export'
                      ? 'Baixar o .zip'
                      : 'Pedir o encerramento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyParishPage;
