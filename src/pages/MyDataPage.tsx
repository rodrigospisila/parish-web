import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { getErrorMessage } from '../services/api';
import TitleIcon from '../components/TitleIcon';
import { useAuth } from '../contexts/AuthContext';
import { notify, Swal } from '../services/notification.service';

type ConsentType = 'DATA_PROCESSING' | 'IMAGE_USE' | 'COMMUNICATIONS';

interface ConsentRow {
  type: ConsentType;
  granted: boolean;
  grantedAt?: string | null;
  revokedAt?: string | null;
}

const CONSENT_COPY: Record<ConsentType, { title: string; description: string }> = {
  COMMUNICATIONS: {
    title: 'Comunicações não essenciais',
    description:
      'Notícias, liturgia do dia e lembretes de eventos. Avisos de escala e do dízimo que você pediu continuam chegando.',
  },
  IMAGE_USE: {
    title: 'Uso de imagem',
    description: 'Fotos suas em publicações da comunidade (site, redes sociais, murais).',
  },
  DATA_PROCESSING: {
    title: 'Tratamento dos dados do cadastro',
    description:
      'Uso do seu cadastro pela comunidade (pastorais, escalas, sacramentos). Ao revogar, a coordenação deixa de poder usá-lo para isso; para apagar tudo, exclua a conta.',
  },
};

const CONSENT_ORDER: ConsentType[] = ['COMMUNICATIONS', 'IMAGE_USE', 'DATA_PROCESSING'];

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e4ebf4',
  borderRadius: 14,
  padding: '1.2rem 1.4rem',
  marginBottom: '1rem',
  maxWidth: 760,
};

/**
 * Privacidade e meus dados (B62 da auditoria): o titular revoga
 * consentimentos, sai das comunicações, baixa os próprios dados e exclui a
 * conta — direitos do art. 18 da LGPD, pelas rotas que a API já tinha.
 */
const MyDataPage: React.FC = () => {
  const { logout } = useAuth();
  const [memberId, setMemberId] = useState<string | null>(null);
  const [consents, setConsents] = useState<ConsentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingType, setSavingType] = useState<ConsentType | null>(null);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: me } = await api.get('/users/me');
      const id: string | null = me?.member?.id ?? null;
      setMemberId(id);
      if (id) {
        const { data } = await api.get<ConsentRow[]>(`/members/${id}/consents`);
        setConsents(Array.isArray(data) ? data : []);
      } else {
        setConsents([]);
      }
    } catch (error) {
      notify.error(getErrorMessage(error, 'Não foi possível carregar os seus dados'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleConsent = async (type: ConsentType, granted: boolean) => {
    if (!memberId) return;
    if (type === 'DATA_PROCESSING' && !granted) {
      const result = await Swal.fire({
        title: 'Revogar o tratamento do cadastro?',
        text: CONSENT_COPY.DATA_PROCESSING.description,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Revogar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#dc3545',
        reverseButtons: true,
      });
      if (!result.isConfirmed) return;
    }
    setSavingType(type);
    try {
      await api.put(`/members/${memberId}/consents`, { type, granted });
      setConsents((previous) => {
        const others = previous.filter((row) => row.type !== type);
        return [...others, { type, granted }];
      });
      notify.success(granted ? 'Consentimento concedido' : 'Consentimento revogado');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Não foi possível salvar a preferência'));
    } finally {
      setSavingType(null);
    }
  };

  const downloadData = async () => {
    setExporting(true);
    try {
      const [{ data: account }, memberExport] = await Promise.all([
        api.get('/users/me'),
        memberId ? api.get(`/members/${memberId}/export`).then((response) => response.data) : Promise.resolve(null),
      ]);
      const payload = {
        exportedAt: new Date().toISOString(),
        account,
        member: memberExport?.member ?? null,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `meus-dados-parish-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Não foi possível gerar o arquivo agora'));
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    const result = await Swal.fire({
      title: 'Excluir minha conta',
      html:
        'A conta é apagada e o seu cadastro anonimizado: você sai das pastorais, das escalas futuras e das comunidades. ' +
        'Não dá para desfazer.<br/><br/>Digite <strong>EXCLUIR</strong> para confirmar.',
      input: 'text',
      inputPlaceholder: 'EXCLUIR',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Excluir definitivamente',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc3545',
      reverseButtons: true,
      preConfirm: (value: string) => {
        if ((value ?? '').trim().toUpperCase() !== 'EXCLUIR') {
          Swal.showValidationMessage('Digite EXCLUIR para confirmar');
          return false;
        }
        return true;
      },
    });
    if (!result.isConfirmed) return;

    // O servidor exige a senha atual para excluir a conta (reautenticação):
    // só a sessão aberta no navegador não basta
    const confirmation = await Swal.fire({
      title: 'Confirme a sua senha',
      text: 'Por segurança, digite a sua senha atual para excluir a conta.',
      input: 'password',
      inputPlaceholder: 'Senha atual',
      inputAttributes: { autocomplete: 'current-password', autocapitalize: 'off', autocorrect: 'off' },
      showCancelButton: true,
      confirmButtonText: 'Excluir definitivamente',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc3545',
      reverseButtons: true,
      preConfirm: (value: string) => {
        if (!value) {
          Swal.showValidationMessage('Digite a sua senha atual');
          return false;
        }
        return value;
      },
    });
    if (!confirmation.isConfirmed || typeof confirmation.value !== 'string') return;

    setDeleting(true);
    try {
      await api.delete('/users/me', { data: { password: confirmation.value } });
      notify.success('Sua conta foi excluída.');
      logout();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Não foi possível excluir a conta agora'));
      setDeleting(false);
    }
  };

  const consentOf = (type: ConsentType) => consents.find((row) => row.type === type);

  return (
    <div className="members-page">
      <div className="page-header">
        <h1>
          <TitleIcon name="membros" /> Privacidade e meus dados
        </h1>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 0.6rem' }}>Consentimentos</h3>
        {loading ? (
          <p style={{ color: '#66788c' }}>Carregando...</p>
        ) : !memberId ? (
          <p style={{ color: '#66788c', margin: 0 }}>
            Sua conta não tem cadastro de membro numa comunidade, então não há consentimentos a gerir aqui.
          </p>
        ) : (
          CONSENT_ORDER.map((type) => {
            const row = consentOf(type);
            const granted = !!row?.granted;
            return (
              <div
                key={type}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '1rem',
                  padding: '0.7rem 0',
                  borderTop: '1px solid #eef2f7',
                }}
              >
                <div>
                  <strong>{CONSENT_COPY[type].title}</strong>
                  <p style={{ margin: '0.2rem 0 0', color: '#66788c', fontSize: '0.92rem' }}>
                    {CONSENT_COPY[type].description}
                  </p>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}>
                  <input
                    type="checkbox"
                    checked={granted}
                    disabled={savingType === type}
                    onChange={(event) => void toggleConsent(type, event.target.checked)}
                  />
                  {granted ? 'Autorizado' : 'Não autorizado'}
                </label>
              </div>
            );
          })
        )}
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 0.6rem' }}>Baixar meus dados</h3>
        <p style={{ margin: '0 0 0.8rem', color: '#66788c' }}>
          Arquivo com a sua conta, o seu cadastro, consentimentos, catequese, dízimo e notificações recebidas.
        </p>
        <button type="button" className="btn-primary" onClick={downloadData} disabled={exporting || loading}>
          {exporting ? 'Gerando...' : 'Baixar meus dados'}
        </button>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 0.6rem' }}>Termos e política</h3>
        <p style={{ margin: 0, display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <Link to="/termos" target="_blank">Termos de uso</Link>
          <Link to="/privacidade" target="_blank">Política de privacidade</Link>
        </p>
      </div>

      <div style={{ ...card, borderColor: '#f3c7cb' }}>
        <h3 style={{ margin: '0 0 0.6rem', color: '#b02a37' }}>Excluir minha conta</h3>
        <p style={{ margin: '0 0 0.8rem', color: '#66788c' }}>
          Apaga a conta e anonimiza o seu cadastro. Registros que a paróquia precisa guardar (sacramentos,
          contribuições) ficam sem identificar você.
        </p>
        <button
          type="button"
          onClick={deleteAccount}
          disabled={deleting}
          style={{
            background: '#dc3545',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '0.55rem 1rem',
            fontWeight: 700,
            cursor: deleting ? 'not-allowed' : 'pointer',
          }}
        >
          {deleting ? 'Excluindo...' : 'Excluir minha conta'}
        </button>
      </div>
    </div>
  );
};

export default MyDataPage;
