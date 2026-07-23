import React, { useState, useEffect, useCallback } from 'react';
import api, { getErrorMessage } from '../../services/api';
import { notify } from '../../services/notification.service';
import './ModulePages.css';

interface Room {
  id: string;
  name: string;
  capacity?: number | null;
  resources?: string | null;
  communityId: string;
}

interface Reservation {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  status: string;
}

interface Community {
  id: string;
  name: string;
}

const RESERVATION_STATUS: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Pendente', color: 'yellow' },
  APPROVED: { label: 'Aprovada', color: 'green' },
  REJECTED: { label: 'Recusada', color: 'red' },
  CANCELLED: { label: 'Cancelada', color: 'gray' },
};

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const RoomsPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [communityFilter, setCommunityFilter] = useState('');

  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [agendaFrom, setAgendaFrom] = useState(startOfToday());
  const [agenda, setAgenda] = useState<Reservation[]>([]);
  const [agendaLoading, setAgendaLoading] = useState(false);

  const [showRoomModal, setShowRoomModal] = useState(false);
  const [roomForm, setRoomForm] = useState({ communityId: '', name: '', capacity: '', resources: '' });

  const [showReserveModal, setShowReserveModal] = useState(false);
  const [reserveForm, setReserveForm] = useState({ title: '', startTime: '', endTime: '' });

  const fetchData = useCallback(async () => {
    try {
      const [roomsRes, communitiesRes] = await Promise.all([
        api.get('/rooms', { params: { communityId: communityFilter || undefined } }),
        api.get('/communities'),
      ]);
      setRooms(roomsRes.data);
      setCommunities(communitiesRes.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar salas'));
    } finally {
      setLoading(false);
    }
  }, [communityFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const loadAgenda = useCallback(async (room: Room, from: string) => {
    setAgendaLoading(true);
    try {
      const res = await api.get(`/rooms/${room.id}/agenda`, { params: { from } });
      setAgenda(res.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar a agenda da sala'));
      setAgenda([]);
    } finally {
      setAgendaLoading(false);
    }
  }, []);

  const openRoom = (room: Room) => {
    setSelectedRoom(room);
    loadAgenda(room, agendaFrom);
  };

  const shiftWeek = (days: number) => {
    const next = new Date(agendaFrom);
    next.setDate(next.getDate() + days);
    const iso = next.toISOString();
    setAgendaFrom(iso);
    if (selectedRoom) loadAgenda(selectedRoom, iso);
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/rooms', {
        communityId: roomForm.communityId,
        name: roomForm.name,
        capacity: roomForm.capacity ? Number(roomForm.capacity) : undefined,
        resources: roomForm.resources || undefined,
      });
      notify.success('Espaço cadastrado!');
      setShowRoomModal(false);
      setRoomForm({ communityId: '', name: '', capacity: '', resources: '' });
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao cadastrar espaço'));
    }
  };

  const handleReserve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRoom) return;
    try {
      await api.post('/rooms/reservations', {
        roomId: selectedRoom.id,
        title: reserveForm.title,
        startTime: new Date(reserveForm.startTime).toISOString(),
        endTime: new Date(reserveForm.endTime).toISOString(),
      });
      notify.success('Reserva solicitada!');
      setShowReserveModal(false);
      setReserveForm({ title: '', startTime: '', endTime: '' });
      loadAgenda(selectedRoom, agendaFrom);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao reservar — verifique conflito de horário'));
    }
  };

  const handleReservationStatus = async (reservationId: string, status: string) => {
    try {
      await api.patch(`/rooms/reservations/${reservationId}/status`, { status });
      notify.success('Status da reserva atualizado!');
      if (selectedRoom) loadAgenda(selectedRoom, agendaFrom);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao atualizar reserva'));
    }
  };

  const formatDateTime = (value: string) =>
    new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  const weekLabel = () => {
    const start = new Date(agendaFrom);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${start.toLocaleDateString('pt-BR')} — ${end.toLocaleDateString('pt-BR')}`;
  };

  if (loading) return <div className="module-page"><div className="loading">Carregando...</div></div>;

  return (
    <div className="module-page">
      <div className="page-header">
        <h1>🏛️ Reserva de Espaços</h1>
        <div className="header-actions">
          <button className="btn-primary" onClick={() => setShowRoomModal(true)}>+ Novo Espaço</button>
        </div>
      </div>

      <div className="filters">
        <select className="filter-select" value={communityFilter} onChange={(e) => setCommunityFilter(e.target.value)}>
          <option value="">Todas as comunidades</option>
          {communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="module-grid">
        {rooms.map((room) => (
          <div key={room.id} className="module-card">
            <h3>{room.name}</h3>
            <p><strong>Comunidade:</strong> {communities.find((c) => c.id === room.communityId)?.name ?? '—'}</p>
            {room.capacity && <p><strong>Capacidade:</strong> {room.capacity} pessoas</p>}
            {room.resources && <p><strong>Recursos:</strong> {room.resources}</p>}
            <div className="card-footer">
              <button className="btn-small" onClick={() => openRoom(room)}>Ver agenda</button>
            </div>
          </div>
        ))}
      </div>
      {rooms.length === 0 && <div className="empty-state">Nenhum espaço cadastrado (salões, salas de catequese, auditórios...).</div>}

      {selectedRoom && (
        <div className="detail-panel">
          <h2>Agenda: {selectedRoom.name}</h2>
          <div className="detail-section">
            <div className="inline-form">
              <button className="btn-small" onClick={() => shiftWeek(-7)}>← Semana anterior</button>
              <span className="status-badge blue">{weekLabel()}</span>
              <button className="btn-small" onClick={() => shiftWeek(7)}>Próxima semana →</button>
              <button className="btn-small success" onClick={() => setShowReserveModal(true)}>+ Reservar</button>
              <button className="btn-small" onClick={() => setSelectedRoom(null)}>Fechar</button>
            </div>
          </div>

          {agendaLoading ? (
            <div className="loading">Carregando agenda...</div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Início</th>
                    <th>Fim</th>
                    <th>Atividade</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {agenda.map((reservation) => {
                    const st = RESERVATION_STATUS[reservation.status] ?? { label: reservation.status, color: 'gray' };
                    return (
                      <tr key={reservation.id}>
                        <td>{formatDateTime(reservation.startTime)}</td>
                        <td>{formatDateTime(reservation.endTime)}</td>
                        <td><strong>{reservation.title}</strong></td>
                        <td><span className={`status-badge ${st.color}`}>{st.label}</span></td>
                        <td className="actions-cell">
                          {reservation.status === 'PENDING' && (
                            <>
                              <button className="btn-small success" onClick={() => handleReservationStatus(reservation.id, 'APPROVED')}>Aprovar</button>
                              <button className="btn-small danger" onClick={() => handleReservationStatus(reservation.id, 'REJECTED')}>Recusar</button>
                            </>
                          )}
                          {(reservation.status === 'PENDING' || reservation.status === 'APPROVED') && (
                            <button className="btn-small warning" onClick={() => handleReservationStatus(reservation.id, 'CANCELLED')}>Cancelar</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {agenda.length === 0 && <div className="empty-state">Sem reservas nesta semana.</div>}
            </div>
          )}
        </div>
      )}

      {showRoomModal && (
        <div className="module-modal-overlay" onClick={() => setShowRoomModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Novo Espaço</h2>
            <form onSubmit={handleCreateRoom}>
              <div className="form-group">
                <label>Comunidade *</label>
                <select required value={roomForm.communityId} onChange={(e) => setRoomForm({ ...roomForm, communityId: e.target.value })}>
                  <option value="">Selecione</option>
                  {communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Nome *</label>
                <input type="text" required placeholder="Ex.: Salão Paroquial" value={roomForm.name} onChange={(e) => setRoomForm({ ...roomForm, name: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Capacidade</label>
                  <input type="number" min={1} value={roomForm.capacity} onChange={(e) => setRoomForm({ ...roomForm, capacity: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Recursos</label>
                  <input type="text" placeholder="Projetor, som..." value={roomForm.resources} onChange={(e) => setRoomForm({ ...roomForm, resources: e.target.value })} />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowRoomModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Cadastrar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showReserveModal && selectedRoom && (
        <div className="module-modal-overlay" onClick={() => setShowReserveModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Reservar {selectedRoom.name}</h2>
            <form onSubmit={handleReserve}>
              <div className="form-group">
                <label>Atividade *</label>
                <input type="text" required placeholder="Ex.: Encontro de casais" value={reserveForm.title} onChange={(e) => setReserveForm({ ...reserveForm, title: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Início *</label>
                  <input type="datetime-local" required value={reserveForm.startTime} onChange={(e) => setReserveForm({ ...reserveForm, startTime: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Fim *</label>
                  <input type="datetime-local" required value={reserveForm.endTime} onChange={(e) => setReserveForm({ ...reserveForm, endTime: e.target.value })} />
                </div>
              </div>
              <p style={{ color: '#777', fontSize: '0.85rem' }}>
                Conflitos de horário com reservas pendentes/aprovadas são bloqueados automaticamente.
              </p>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowReserveModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Reservar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoomsPage;
