import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TitleIcon from '../components/TitleIcon';
import api, { getErrorMessage } from '../services/api';
import { notify, confirm } from '../services/notification.service';
import { useAuth } from '../contexts/AuthContext';
import { actionLabel, entityLabel, compactJson, formatDateTime } from '../utils/auditLabels';
import './modules/ModulePages.css';
import './SecurityPage.css';

interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: string | null;
  recommended: boolean;
  backupCodesLeft: number;
  serverReady: boolean;
}

interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

interface DeviceItem {
  id: string;
  label: string | null;
  lastIp: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  current: boolean;
}

interface ActivityItem {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
  actorEmail: string | null;
}

interface ActivityResponse {
  total: number;
  items: ActivityItem[];
}

const TOTP_PATTERN = /^\d{6}$/;

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Segurança da conta (Governança de acesso — Dízimo D4.7):
 * autenticação em duas etapas, dispositivos conhecidos e atividade recente.
 */
const SecurityPage: React.FC = () => {
  const { user, updateUser, logout, adoptSession } = useAuth();
  const navigate = useNavigate();

  // ---- 2FA
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [enableCode, setEnableCode] = useState('');
  const [enabling, setEnabling] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [codesSaved, setCodesSaved] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [disabling, setDisabling] = useState(false);

  // ---- Dispositivos
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesError, setDevicesError] = useState('');
  const [forgettingId, setForgettingId] = useState<string | null>(null);

  // ---- Atividade
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState('');

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError('');
    try {
      const { data } = await api.get<TwoFactorStatus>('/auth/2fa/status');
      setStatus(data);
      updateUser({ twoFactorEnabled: data.enabled });
    } catch (error) {
      setStatusError(
        getErrorMessage(error, 'Não foi possível carregar o status da autenticação em duas etapas'),
      );
    } finally {
      setStatusLoading(false);
    }
  }, [updateUser]);

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    setDevicesError('');
    try {
      const { data } = await api.get<DeviceItem[]>('/auth/devices');
      setDevices(Array.isArray(data) ? data : []);
    } catch (error) {
      setDevicesError(getErrorMessage(error, 'Não foi possível carregar os dispositivos'));
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  const loadActivity = useCallback(async () => {
    setActivityLoading(true);
    setActivityError('');
    try {
      const { data } = await api.get<ActivityResponse>('/auth/activity');
      const items = data.items ?? [];
      setActivity(items);
      setActivityTotal(data.total ?? items.length);
    } catch (error) {
      setActivityError(getErrorMessage(error, 'Não foi possível carregar a atividade recente'));
    } finally {
      setActivityLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadDevices();
    void loadActivity();
  }, [loadStatus, loadDevices, loadActivity]);

  // ---- 2FA: ativar
  const handleStartSetup = async () => {
    setSetupLoading(true);
    try {
      const { data } = await api.post<TwoFactorSetup>('/auth/2fa/setup');
      setSetup(data);
      setEnableCode('');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao iniciar a configuração do 2FA'));
    } finally {
      setSetupLoading(false);
    }
  };

  const handleEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = enableCode.trim();
    if (!TOTP_PATTERN.test(code)) {
      notify.warning('Informe o código de 6 dígitos exibido no aplicativo autenticador');
      return;
    }
    setEnabling(true);
    try {
      const { data } = await api.post<{
        enabled: boolean;
        backupCodes: string[];
        accessToken?: string;
        refreshToken?: string;
      }>('/auth/2fa/enable', { code });
      // As outras sessões caem; esta continua com os tokens novos
      adoptSession(data);
      setBackupCodes(data.backupCodes ?? []);
      setCodesSaved(false);
      setSetup(null);
      setEnableCode('');
      updateUser({ twoFactorEnabled: true });
      notify.success('Autenticação em duas etapas ativada!');
      void loadStatus();
      void loadActivity();
    } catch (error) {
      notify.error(
        getErrorMessage(error, 'Código inválido. Confira o horário do aparelho e tente de novo.'),
      );
    } finally {
      setEnabling(false);
    }
  };

  // ---- 2FA: desativar
  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disablePassword || !disableCode.trim()) {
      notify.warning('Informe sua senha e o código do autenticador');
      return;
    }
    setDisabling(true);
    try {
      await api.post<{ enabled: boolean }>('/auth/2fa/disable', {
        password: disablePassword,
        code: disableCode.trim(),
      });
      updateUser({ twoFactorEnabled: false });
      setDisableOpen(false);
      setDisablePassword('');
      setDisableCode('');
      notify.success('Autenticação em duas etapas desativada.');
      void loadStatus();
      void loadActivity();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Não foi possível desativar o 2FA'));
    } finally {
      setDisabling(false);
    }
  };

  const cancelDisable = () => {
    setDisableOpen(false);
    setDisablePassword('');
    setDisableCode('');
  };

  // ---- Códigos de recuperação (exibidos UMA vez)
  const codesText = () => (backupCodes ?? []).join('\n');

  const handleCopyCodes = async () => {
    if (await copyToClipboard(codesText())) {
      setCodesSaved(true);
      notify.success('Códigos copiados para a área de transferência');
    } else {
      notify.error('Não foi possível copiar automaticamente. Selecione e copie manualmente.');
    }
  };

  const handleDownloadCodes = () => {
    const header = [
      'Parish — códigos de recuperação da autenticação em duas etapas',
      `Conta: ${user?.email ?? ''}`,
      `Gerados em: ${new Date().toLocaleString('pt-BR')}`,
      '',
      'Cada código só pode ser usado uma vez. Guarde este arquivo em local seguro.',
      '',
    ].join('\n');
    const blob = new Blob([`${header}${codesText()}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'parish-codigos-recuperacao.txt';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setCodesSaved(true);
  };

  const handleCloseCodes = async () => {
    if (!codesSaved) {
      const ok = await confirm.action(
        'Você guardou os códigos?',
        'Eles não serão exibidos novamente. Sem eles, você depende do aplicativo autenticador para entrar.',
        'Já guardei',
        'Voltar',
      );
      if (!ok) return;
    }
    setBackupCodes(null);
  };

  const handleCopySecret = async () => {
    if (!setup) return;
    if (await copyToClipboard(setup.secret)) notify.success('Chave copiada');
    else notify.error('Não foi possível copiar automaticamente');
  };

  // ---- Dispositivos
  const handleForget = async (device: DeviceItem) => {
    const label = device.label || 'este dispositivo';
    const ok = await confirm.action(
      device.current ? 'Esquecer este dispositivo' : 'Esquecer dispositivo',
      device.current
        ? `Esquecer ${label}? As sessões dele serão encerradas — inclusive esta — e você precisará entrar novamente.`
        : `Esquecer ${label}? As sessões abertas nele serão encerradas e o próximo acesso será tratado como novo dispositivo.`,
      'Esquecer',
    );
    if (!ok) return;
    setForgettingId(device.id);
    try {
      const { data } = await api.delete<{
        forgotten: boolean;
        current?: boolean;
        accessToken?: string;
        refreshToken?: string;
      }>(`/auth/devices/${device.id}`);
      if (device.current || data.current) {
        notify.info('Dispositivo esquecido. Entre novamente para continuar.');
        logout();
        navigate('/login');
        return;
      }
      // Todas as sessões caíram; esta segue com os tokens novos
      adoptSession(data);
      notify.success('Dispositivo esquecido e sessões encerradas.');
      void loadDevices();
      void loadActivity();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao esquecer o dispositivo'));
    } finally {
      setForgettingId(null);
    }
  };

  const enabled = status?.enabled ?? user?.twoFactorEnabled ?? false;
  const serverReady = status?.serverReady ?? true;

  return (
    <div className="module-page security-page">
      <div className="page-header">
        <h1>
          <TitleIcon name="sino" /> Segurança
        </h1>
      </div>

      <div className="security-grid">
        {/* ===== Autenticação em duas etapas ===== */}
        <section className="security-card" aria-labelledby="sec-2fa">
          <h2 id="sec-2fa">Autenticação em duas etapas (2FA)</h2>
          <p className="card-hint">
            Além da senha, um código gerado no seu celular (Google Authenticator, Microsoft
            Authenticator, Authy…) passa a ser exigido a cada login.
          </p>

          {statusLoading ? (
            <p className="security-muted">Carregando status…</p>
          ) : statusError ? (
            <div className="security-notice red">{statusError}</div>
          ) : (
            <>
              {!serverReady && (
                <div className="security-notice red">
                  Servidor sem chave de criptografia — peça ao suporte. A ativação do 2FA fica
                  indisponível até lá.
                </div>
              )}
              {status?.recommended && !enabled && (
                <div className="security-notice amber">
                  <strong>Recomendado para quem administra finanças.</strong> Seu papel tem acesso a
                  dados financeiros; ative o 2FA para proteger a conta.
                </div>
              )}

              <div className="security-status-row">
                <span className={`status-badge ${enabled ? 'green' : 'gray'}`}>
                  {enabled ? 'Ativa' : 'Inativa'}
                </span>
                {enabled && status?.enabledAt && (
                  <span className="security-muted">desde {formatDateTime(status.enabledAt)}</span>
                )}
                {enabled && (
                  <span className="security-muted">
                    · {status?.backupCodesLeft ?? 0} código(s) de recuperação restante(s)
                  </span>
                )}
              </div>

              {!enabled && !setup && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void handleStartSetup()}
                  disabled={setupLoading || !serverReady}
                >
                  {setupLoading ? 'Preparando…' : 'Ativar 2FA'}
                </button>
              )}

              {!enabled && setup && (
                <div className="security-setup">
                  <img src={setup.qrDataUrl} alt="QR code para o aplicativo autenticador" />
                  <div>
                    <ol className="security-steps">
                      <li>Abra o aplicativo autenticador e escaneie o QR code.</li>
                      <li>
                        Não consegue escanear? Informe esta chave manualmente:
                        <div className="security-secret-row">
                          <code className="security-secret">{setup.secret}</code>
                          <button type="button" className="btn-small" onClick={() => void handleCopySecret()}>
                            Copiar
                          </button>
                        </div>
                      </li>
                      <li>Digite o código de 6 dígitos gerado pelo aplicativo para confirmar.</li>
                    </ol>
                    <form className="security-form" onSubmit={(e) => void handleEnable(e)}>
                      <label>
                        Código do autenticador
                        <input
                          type="text"
                          className="security-code-input"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          placeholder="000000"
                          value={enableCode}
                          onChange={(e) => setEnableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          required
                        />
                      </label>
                      <button type="submit" className="btn-primary" disabled={enabling}>
                        {enabling ? 'Confirmando…' : 'Confirmar e ativar'}
                      </button>
                      <button type="button" className="btn-small" onClick={() => setSetup(null)} disabled={enabling}>
                        Cancelar
                      </button>
                    </form>
                  </div>
                </div>
              )}

              {enabled && !disableOpen && (
                <button type="button" className="btn-small danger" onClick={() => setDisableOpen(true)}>
                  Desativar 2FA
                </button>
              )}

              {enabled && disableOpen && (
                <form className="security-form" onSubmit={(e) => void handleDisable(e)}>
                  <label>
                    Senha atual
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={disablePassword}
                      onChange={(e) => setDisablePassword(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Código do autenticador
                    <input
                      type="text"
                      className="security-code-input"
                      autoComplete="one-time-code"
                      maxLength={11}
                      placeholder="000000"
                      value={disableCode}
                      onChange={(e) => setDisableCode(e.target.value.replace(/[^a-z0-9-]/gi, '').slice(0, 11))}
                      required
                    />
                  </label>
                  <button type="submit" className="btn-small danger" disabled={disabling}>
                    {disabling ? 'Desativando…' : 'Confirmar desativação'}
                  </button>
                  <button type="button" className="btn-small" onClick={cancelDisable} disabled={disabling}>
                    Cancelar
                  </button>
                </form>
              )}
            </>
          )}
        </section>

        {/* ===== Dispositivos ===== */}
        <section className="security-card" aria-labelledby="sec-devices">
          <h2 id="sec-devices">Dispositivos</h2>
          <p className="card-hint">
            Navegadores e aparelhos que já acessaram sua conta. "Esquecer" encerra as sessões
            abertas naquele dispositivo.
          </p>

          {devicesLoading ? (
            <p className="security-muted">Carregando dispositivos…</p>
          ) : devicesError ? (
            <div className="security-notice red">{devicesError}</div>
          ) : devices.length === 0 ? (
            <p className="security-muted">Nenhum dispositivo registrado.</p>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Dispositivo</th>
                    <th>Último IP</th>
                    <th>Primeiro acesso</th>
                    <th>Último acesso</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((device) => (
                    <tr key={device.id} className={device.revokedAt ? 'security-row-revoked' : ''}>
                      <td>
                        <strong>{device.label || 'Dispositivo sem nome'}</strong>
                        {device.current && (
                          <span className="status-badge blue security-inline-badge">este dispositivo</span>
                        )}
                        {device.revokedAt && (
                          <span className="status-badge gray security-inline-badge">
                            esquecido em {formatDateTime(device.revokedAt)}
                          </span>
                        )}
                      </td>
                      <td>{device.lastIp || '—'}</td>
                      <td>{formatDateTime(device.firstSeenAt)}</td>
                      <td>{formatDateTime(device.lastSeenAt)}</td>
                      <td className="actions-cell">
                        {!device.revokedAt && (
                          <button
                            type="button"
                            className="btn-small danger"
                            onClick={() => void handleForget(device)}
                            disabled={forgettingId === device.id}
                          >
                            {forgettingId === device.id ? 'Esquecendo…' : 'Esquecer'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ===== Atividade recente ===== */}
        <section className="security-card" aria-labelledby="sec-activity">
          <h2 id="sec-activity">Atividade recente</h2>
          <p className="card-hint">
            Logins, alterações de segurança e outras ações registradas na sua conta
            {activityTotal > 0 ? ` (${activityTotal} no total)` : ''}.
          </p>

          {activityLoading ? (
            <p className="security-muted">Carregando atividade…</p>
          ) : activityError ? (
            <div className="security-notice red">{activityError}</div>
          ) : activity.length === 0 ? (
            <p className="security-muted">Nenhuma atividade registrada.</p>
          ) : (
            <ul className="security-activity">
              {activity.map((item) => {
                const summary = compactJson(item.metadata, 90);
                return (
                  <li key={item.id}>
                    <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                    <span className="security-activity-action">{actionLabel(item.action)}</span>
                    {item.entity && (
                      <span className="security-muted">
                        {entityLabel(item.entity)}
                        {item.entityId ? ` #${item.entityId}` : ''}
                      </span>
                    )}
                    {item.actorEmail && item.actorEmail !== user?.email && (
                      <span className="security-muted">por {item.actorEmail}</span>
                    )}
                    {summary && <code title={compactJson(item.metadata, 600)}>{summary}</code>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* ===== Modal: códigos de recuperação (mostrados UMA vez) ===== */}
      {backupCodes && (
        <div className="module-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="codes-title">
          <div className="module-modal">
            <h2 id="codes-title">Guarde seus códigos de recuperação</h2>
            <p className="security-modal-text">
              Use um destes códigos se perder o acesso ao aplicativo autenticador.{' '}
              <strong>Cada código vale uma única vez e eles não serão exibidos novamente.</strong>
            </p>
            {backupCodes.length === 0 ? (
              <div className="security-notice amber">
                O servidor não devolveu códigos de recuperação. Guarde bem o acesso ao aplicativo
                autenticador ou peça ao suporte.
              </div>
            ) : (
              <div className="security-codes">
                {backupCodes.map((code) => (
                  <span key={code}>{code}</span>
                ))}
              </div>
            )}
            <div className="security-codes-actions">
              <button type="button" className="btn-small" onClick={() => void handleCopyCodes()} disabled={backupCodes.length === 0}>
                Copiar
              </button>
              <button type="button" className="btn-small" onClick={handleDownloadCodes} disabled={backupCodes.length === 0}>
                Baixar .txt
              </button>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-submit" onClick={() => void handleCloseCodes()}>
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SecurityPage;
