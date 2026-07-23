import React, { useState, useEffect, useCallback } from 'react';
import api, { getErrorMessage } from '../../services/api';
import { notify, confirm } from '../../services/notification.service';
import './ModulePages.css';

interface PastoralDocument {
  id: string;
  title: string;
  category: string;
  currentVersion: number;
  fileUrl?: string | null;
  storageKey?: string | null;
  validUntil?: string | null;
  isArchived: boolean;
  communityId?: string | null;
  createdAt: string;
}

interface DocumentVersion {
  id: string;
  version: number;
  fileUrl?: string | null;
  notes?: string | null;
  createdAt: string;
}

interface DocumentDetail extends PastoralDocument {
  versions: DocumentVersion[];
}

interface Community {
  id: string;
  name: string;
}

const CATEGORIES = ['Ata', 'Regimento', 'Ofício', 'Comunicado', 'Formulário', 'Prestação de contas', 'Outros'];

const DocumentsPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<PastoralDocument[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: '', category: '', communityId: '', fileUrl: '', validUntil: '' });

  const [showVersionModal, setShowVersionModal] = useState(false);
  const [versionForm, setVersionForm] = useState({ fileUrl: '', notes: '' });

  const fetchData = useCallback(async () => {
    try {
      const [docsRes, communitiesRes] = await Promise.all([
        api.get('/documents', {
          params: {
            category: categoryFilter || undefined,
            includeArchived: includeArchived ? 'true' : undefined,
          },
        }),
        api.get('/communities'),
      ]);
      setDocuments(docsRes.data);
      setCommunities(communitiesRes.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar documentos'));
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, includeArchived]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openDetail = async (id: string) => {
    try {
      const res = await api.get(`/documents/${id}`);
      setDetail(res.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar o documento'));
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/documents', {
        title: form.title,
        category: form.category,
        communityId: form.communityId || undefined,
        fileUrl: form.fileUrl || undefined,
        validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : undefined,
      });
      notify.success('Documento cadastrado!');
      setShowModal(false);
      setForm({ title: '', category: '', communityId: '', fileUrl: '', validUntil: '' });
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao cadastrar documento'));
    }
  };

  const handleAddVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    try {
      await api.post(`/documents/${detail.id}/versions`, {
        fileUrl: versionForm.fileUrl || undefined,
        notes: versionForm.notes || undefined,
      });
      notify.success('Nova versão registrada!');
      setShowVersionModal(false);
      setVersionForm({ fileUrl: '', notes: '' });
      openDetail(detail.id);
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao registrar versão'));
    }
  };

  const handleArchive = async (doc: PastoralDocument, isArchived: boolean) => {
    try {
      await api.patch(`/documents/${doc.id}/archive`, { isArchived });
      notify.success(isArchived ? 'Documento arquivado!' : 'Documento restaurado!');
      if (detail?.id === doc.id) openDetail(doc.id);
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao arquivar documento'));
    }
  };

  const handleDelete = async (doc: PastoralDocument) => {
    const confirmed = await confirm.delete(`o documento "${doc.title}"`);
    if (!confirmed) return;
    try {
      await api.delete(`/documents/${doc.id}`);
      notify.success('Documento excluído!');
      if (detail?.id === doc.id) setDetail(null);
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao excluir documento'));
    }
  };

  const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleDateString('pt-BR') : '—');
  const isExpired = (doc: PastoralDocument) => doc.validUntil && new Date(doc.validUntil).getTime() < Date.now();

  if (loading) return <div className="module-page"><div className="loading">Carregando...</div></div>;

  return (
    <div className="module-page">
      <div className="page-header">
        <h1>📁 Documentos</h1>
        <div className="header-actions">
          <button className="btn-primary" onClick={() => setShowModal(true)}>+ Novo Documento</button>
        </div>
      </div>

      <div className="filters">
        <select className="filter-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">Todas as categorias</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#555' }}>
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
          Mostrar arquivados
        </label>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Título</th>
              <th>Categoria</th>
              <th>Versão</th>
              <th>Validade</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id}>
                <td><strong>{doc.title}</strong></td>
                <td><span className="status-badge gray">{doc.category}</span></td>
                <td>v{doc.currentVersion}</td>
                <td>
                  {formatDate(doc.validUntil)}
                  {isExpired(doc) && <span className="status-badge red" style={{ marginLeft: 6 }}>Vencido</span>}
                </td>
                <td>
                  {doc.isArchived
                    ? <span className="status-badge yellow">Arquivado</span>
                    : <span className="status-badge green">Vigente</span>}
                </td>
                <td className="actions-cell">
                  <button className="btn-small" onClick={() => openDetail(doc.id)}>Detalhes</button>
                  {doc.fileUrl && (
                    <a className="btn-small" style={{ textDecoration: 'none' }} href={doc.fileUrl} target="_blank" rel="noreferrer">Abrir arquivo</a>
                  )}
                  {doc.isArchived ? (
                    <button className="btn-small" onClick={() => handleArchive(doc, false)}>Restaurar</button>
                  ) : (
                    <button className="btn-small warning" onClick={() => handleArchive(doc, true)}>Arquivar</button>
                  )}
                  <button className="btn-small danger" onClick={() => handleDelete(doc)}>Excluir</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {documents.length === 0 && <div className="empty-state">Nenhum documento encontrado.</div>}
      </div>

      {detail && (
        <div className="detail-panel">
          <h2>{detail.title} <span className="status-badge gray">{detail.category}</span></h2>
          <div className="detail-section">
            <div className="inline-form">
              <button className="btn-small success" onClick={() => setShowVersionModal(true)}>+ Nova versão</button>
              <button className="btn-small" onClick={() => setDetail(null)}>Fechar</button>
            </div>
          </div>
          <div className="detail-section">
            <h4>Histórico de versões</h4>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr><th>Versão</th><th>Data</th><th>Observações</th><th>Arquivo</th></tr>
                </thead>
                <tbody>
                  {detail.versions.map((v) => (
                    <tr key={v.id}>
                      <td>v{v.version}</td>
                      <td>{formatDate(v.createdAt)}</td>
                      <td>{v.notes || '—'}</td>
                      <td>{v.fileUrl ? <a href={v.fileUrl} target="_blank" rel="noreferrer">Abrir</a> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detail.versions.length === 0 && <div className="empty-state">Sem versões registradas.</div>}
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="module-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Novo Documento</h2>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label>Título *</label>
                <input type="text" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Categoria *</label>
                  <input
                    type="text"
                    required
                    list="doc-categories"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                  />
                  <datalist id="doc-categories">
                    {CATEGORIES.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div className="form-group">
                  <label>Comunidade (opcional)</label>
                  <select value={form.communityId} onChange={(e) => setForm({ ...form, communityId: e.target.value })}>
                    <option value="">Paróquia inteira</option>
                    {communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Link do arquivo (Drive, OneDrive etc.)</label>
                <input type="url" placeholder="https://..." value={form.fileUrl} onChange={(e) => setForm({ ...form, fileUrl: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Válido até (opcional)</label>
                <input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Cadastrar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showVersionModal && detail && (
        <div className="module-modal-overlay" onClick={() => setShowVersionModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Nova versão de "{detail.title}"</h2>
            <form onSubmit={handleAddVersion}>
              <div className="form-group">
                <label>Link do arquivo</label>
                <input type="url" placeholder="https://..." value={versionForm.fileUrl} onChange={(e) => setVersionForm({ ...versionForm, fileUrl: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Observações</label>
                <textarea rows={3} value={versionForm.notes} onChange={(e) => setVersionForm({ ...versionForm, notes: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowVersionModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Registrar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentsPage;
