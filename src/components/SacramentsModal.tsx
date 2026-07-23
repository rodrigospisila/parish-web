import React, { useEffect, useState } from 'react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL;

type SacramentType =
  | 'BAPTISM'
  | 'FIRST_COMMUNION'
  | 'CONFIRMATION'
  | 'MARRIAGE'
  | 'HOLY_ORDERS'
  | 'ANOINTING_OF_THE_SICK';

const SACRAMENT_LABELS: Record<SacramentType, string> = {
  BAPTISM: 'Batismo',
  FIRST_COMMUNION: 'Primeira Eucaristia',
  CONFIRMATION: 'Crisma',
  MARRIAGE: 'Matrimônio',
  HOLY_ORDERS: 'Ordem',
  ANOINTING_OF_THE_SICK: 'Unção dos Enfermos',
};

interface Sacrament {
  id: string;
  type: SacramentType;
  date: string;
  place?: string;
  minister?: string;
  notes?: string;
}

interface Props {
  memberId: string;
  memberName: string;
  onClose: () => void;
}

/**
 * Histórico sacramental (roadmap 2.1). Acompanhamento pastoral — o registro
 * oficial (livro/folha/termo, certidões) é da secretaria (Fase 4).
 */
const SacramentsModal: React.FC<Props> = ({ memberId, memberName, onClose }) => {
  const [items, setItems] = useState<Sacrament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    type: 'BAPTISM' as SacramentType,
    date: '',
    place: '',
    minister: '',
    notes: '',
  });

  const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${API_URL}/sacraments`, {
        headers: authHeader(),
        params: { memberId },
      });
      setItems(res.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erro ao carregar sacramentos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await axios.post(
        `${API_URL}/sacraments`,
        { memberId, ...form, date: new Date(form.date).toISOString() },
        { headers: authHeader() },
      );
      setForm({ type: 'BAPTISM', date: '', place: '', minister: '', notes: '' });
      load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erro ao registrar sacramento');
    }
  };

  const handleRemove = async (id: string) => {
    if (!window.confirm('Remover este registro sacramental?')) return;
    try {
      await axios.delete(`${API_URL}/sacraments/${id}`, { headers: authHeader() });
      load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erro ao remover');
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={`Sacramentos de ${memberName}`}>
      <div className="modal-content" style={{ maxWidth: 640 }}>
        <h2>Sacramentos — {memberName}</h2>
        <p style={{ fontSize: 13, color: '#666' }}>
          Acompanhamento pastoral. A certidão oficial é emitida pela secretaria paroquial.
        </p>

        {error && <div className="error-message">{error}</div>}

        {loading ? (
          <p>Carregando...</p>
        ) : items.length === 0 ? (
          <p>Nenhum sacramento registrado.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Sacramento</th>
                <th style={{ textAlign: 'left' }}>Data</th>
                <th style={{ textAlign: 'left' }}>Local</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <td>{SACRAMENT_LABELS[s.type]}</td>
                  <td>{new Date(s.date).toLocaleDateString('pt-BR')}</td>
                  <td>{s.place || '-'}</td>
                  <td>
                    <button className="btn-icon danger" onClick={() => handleRemove(s.id)} title="Remover">
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form onSubmit={handleAdd}>
          <h3 style={{ fontSize: 15 }}>Registrar sacramento</h3>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="sac-type">Tipo</label>
              <select
                id="sac-type"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as SacramentType })}
              >
                {(Object.keys(SACRAMENT_LABELS) as SacramentType[]).map((t) => (
                  <option key={t} value={t}>
                    {SACRAMENT_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="sac-date">Data</label>
              <input
                id="sac-date"
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="sac-place">Local</label>
              <input
                id="sac-place"
                type="text"
                value={form.place}
                onChange={(e) => setForm({ ...form, place: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="sac-minister">Ministro/celebrante</label>
              <input
                id="sac-minister"
                type="text"
                value={form.minister}
                onChange={(e) => setForm({ ...form, minister: e.target.value })}
              />
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-cancel" onClick={onClose}>
              Fechar
            </button>
            <button type="submit" className="btn-submit">
              Registrar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SacramentsModal;
