import React, { useEffect, useState } from 'react';
import TitleIcon from '../components/TitleIcon';
import api, { getErrorMessage } from '../services/api';
import { notify } from '../services/notification.service';

/** Módulos do painel controláveis por papel (mesmas chaves do backend). */
const MODULES: Array<{ key: string; label: string; section: string }> = [
  { key: 'dioceses', label: 'Dioceses', section: 'Estrutura' },
  { key: 'parishes', label: 'Paróquias', section: 'Estrutura' },
  { key: 'communities', label: 'Comunidades', section: 'Estrutura' },
  { key: 'members', label: 'Membros', section: 'Comunidade' },
  { key: 'events', label: 'Eventos', section: 'Comunidade' },
  { key: 'fixed-schedule', label: 'Agenda Fixa', section: 'Comunidade' },
  { key: 'schedules', label: 'Escalas', section: 'Comunidade' },
  { key: 'swaps', label: 'Trocas de Escala', section: 'Comunidade' },
  { key: 'clergy-messages', label: 'Palavra Pastoral', section: 'Pastoral' },
  { key: 'saints', label: 'Santos', section: 'Pastoral' },
  { key: 'pastorals', label: 'Pastorais', section: 'Pastoral' },
  { key: 'my-pastorals', label: 'Minhas Pastorais', section: 'Pastoral' },
  { key: 'catechesis', label: 'Catequese', section: 'Pastoral' },
  { key: 'planning', label: 'Planejamento', section: 'Pastoral' },
  { key: 'documents', label: 'Documentos', section: 'Pastoral' },
  { key: 'formation', label: 'Formação', section: 'Pastoral' },
  { key: 'rooms', label: 'Espaços', section: 'Pastoral' },
  { key: 'visitation', label: 'Visitação', section: 'Pastoral' },
  { key: 'finance', label: 'Financeiro', section: 'Gestão' },
  { key: 'sacrament-processes', label: 'Sacramentos', section: 'Gestão' },
  { key: 'users', label: 'Usuários', section: 'Gestão' },
  { key: 'audit', label: 'Auditoria', section: 'Gestão' },
];

const ROLES: Array<{ key: string; label: string }> = [
  { key: 'DIOCESAN_ADMIN', label: 'Adm. Diocesana' },
  { key: 'PARISH_ADMIN', label: 'Adm. Paroquial' },
  { key: 'COMMUNITY_COORDINATOR', label: 'Coord. Comunidade' },
  { key: 'PASTORAL_COORDINATOR', label: 'Coord. Pastoral' },
  { key: 'VOLUNTEER', label: 'Voluntariado' },
  { key: 'FAITHFUL', label: 'Fiel' },
];

/**
 * Configurações do sistema (SYSTEM_ADMIN): quais módulos do painel cada
 * perfil enxerga. Desmarcar esconde o módulo do menu daquele papel — o
 * controle de DADOS continua nos papéis do backend.
 */
const SystemSettingsPage: React.FC = () => {
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api
      .get('/settings/module-access')
      .then((res) => {
        setDisabled(
          new Set((res.data?.disabled ?? []).map((d: { moduleKey: string; role: string }) => `${d.moduleKey}:${d.role}`)),
        );
      })
      .catch((error) => notify.error(getErrorMessage(error, 'Erro ao carregar as configurações')))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (moduleKey: string, role: string) => {
    const key = `${moduleKey}:${role}`;
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setDirty(true);
  };

  const toggleRow = (moduleKey: string) => {
    // Linha inteira: se algum papel está ativo, desativa todos; senão reativa todos
    setDisabled((prev) => {
      const next = new Set(prev);
      const allOff = ROLES.every((r) => next.has(`${moduleKey}:${r.key}`));
      ROLES.forEach((r) => {
        const key = `${moduleKey}:${r.key}`;
        if (allOff) next.delete(key);
        else next.add(key);
      });
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = [...disabled].map((key) => {
        const [moduleKey, role] = key.split(':');
        return { moduleKey, role };
      });
      await api.put('/settings/module-access', { disabled: payload });
      setDirty(false);
      notify.success('Configurações salvas — o menu de cada perfil obedece na próxima carga.');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao salvar as configurações'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading">Carregando...</div>;

  let lastSection = '';
  return (
    <div className="members-page">
      <div className="page-header">
        <h1>
          <TitleIcon name="planejamento" /> Configurações do sistema
        </h1>
        <p>Marque quais módulos do painel cada perfil de acesso enxerga. Desmarcar esconde o módulo do menu — as permissões de dados continuam valendo no servidor.</p>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e4ebf4', borderRadius: 14, padding: '1rem 1.2rem', overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 760, width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '0.5rem 0.6rem', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b' }}>Módulo</th>
              {ROLES.map((role) => (
                <th key={role.key} style={{ padding: '0.5rem 0.4rem', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.03em', color: '#64748b', whiteSpace: 'nowrap' }}>
                  {role.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODULES.map((module) => {
              const sectionRow =
                module.section !== lastSection ? (
                  <tr key={`section-${module.section}`}>
                    <td colSpan={ROLES.length + 1} style={{ padding: '0.7rem 0.6rem 0.25rem', fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#94a3b8' }}>
                      {module.section}
                    </td>
                  </tr>
                ) : null;
              lastSection = module.section;
              return (
                <React.Fragment key={module.key}>
                  {sectionRow}
                  <tr style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.45rem 0.6rem', fontSize: '0.88rem', fontWeight: 600, color: '#1a2b3c' }}>
                      <button
                        type="button"
                        onClick={() => toggleRow(module.key)}
                        title="Ativar/desativar a linha inteira"
                        style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer', color: 'inherit' }}
                      >
                        {module.label}
                      </button>
                    </td>
                    {ROLES.map((role) => {
                      const off = disabled.has(`${module.key}:${role.key}`);
                      return (
                        <td key={role.key} style={{ textAlign: 'center', padding: '0.35rem 0.4rem' }}>
                          <input
                            type="checkbox"
                            checked={!off}
                            onChange={() => toggle(module.key, role.key)}
                            title={off ? 'Desativado para este perfil' : 'Ativo para este perfil'}
                            style={{ width: 17, height: 17, cursor: 'pointer', accentColor: '#075AA9' }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginTop: '1rem' }}>
          <button type="button" className="add-button" disabled={saving || !dirty} onClick={() => void save()}>
            {saving ? 'Salvando…' : 'Salvar configurações'}
          </button>
          {dirty && <span style={{ fontSize: '0.82rem', color: '#b45309', fontWeight: 600 }}>Alterações não salvas</span>}
          <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: '#94a3b8' }}>
            O perfil Administração do Sistema sempre vê tudo.
          </span>
        </div>
      </div>
    </div>
  );
};

export default SystemSettingsPage;
