import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { eventStatuses, eventTypes } from '../constants/eventOptions';
import { notify } from '../services/notification.service';
import { applyDuration, generateRecurrenceDates, getEventDuration } from '../utils/recurrenceHelper';
import RecurrenceForm from './RecurrenceForm';
import RoomSelect from './RoomSelect';
import { useAuth } from '../contexts/AuthContext';
import './CreateEventModal.css';

const API_URL = import.meta.env.VITE_API_URL;

interface Community {
  id: string;
  name: string;
  parish?: {
    id: string;
    name: string;
  };
}

interface Pastoral {
  id: string;
  name: string;
  communityId: string;
}

interface EventPastoral {
  communityPastoralId: string;
  requiredPeople?: number;
  communityPastoral?: {
    name?: string;
    globalPastoral?: {
      name: string;
    };
  };
}

interface EventFormData {
  title: string;
  description: string;
  type: string;
  startDate: string;
  endDate: string;
  location: string;
  isRecurring: boolean;
  recurrenceType: string;
  recurrenceInterval: number;
  recurrenceDays: string;
  recurrenceEndDate: string;
  maxParticipants: string;
  isPublic: boolean;
  status: string;
  communityId: string;
}

interface SelectedPastoral {
  id: string;
  name: string;
  requiredPeople: number;
}

interface CreateEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  communities: Community[];
  pastorals: Pastoral[];
  editingEvent?: {
    id: string;
    title: string;
    description?: string;
    type: string;
    startDate: string;
    endDate?: string;
    location?: string;
    isRecurring: boolean;
    maxParticipants?: number;
    isPublic: boolean;
    status: string;
    community: Community;
    eventPastorals?: EventPastoral[];
  } | null;
  initialStartDate?: string;
}

const buildInitialForm = (communityId = '', initialStartDate = ''): EventFormData => ({
  title: '',
  description: '',
  type: 'MASS',
  startDate: initialStartDate,
  endDate: '',
  location: '',
  isRecurring: false,
  recurrenceType: '',
  recurrenceInterval: 1,
  recurrenceDays: '[]',
  recurrenceEndDate: '',
  maxParticipants: '',
  isPublic: true,
  status: 'DRAFT',
  communityId,
});

const CreateEventModal: React.FC<CreateEventModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  communities,
  pastorals,
  editingEvent,
  initialStartDate = '',
}) => {
  const { user: currentUser } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<EventFormData>(buildInitialForm());
  const [pastoralSearch, setPastoralSearch] = useState('');
  const [selectedPastorals, setSelectedPastorals] = useState<SelectedPastoral[]>([]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (editingEvent) {
      setFormData({
        title: editingEvent.title,
        description: editingEvent.description || '',
        type: editingEvent.type,
        startDate: editingEvent.startDate.slice(0, 16),
        endDate: editingEvent.endDate ? editingEvent.endDate.slice(0, 16) : '',
        location: editingEvent.location || '',
        isRecurring: false,
        recurrenceType: '',
        recurrenceInterval: 1,
        recurrenceDays: '[]',
        recurrenceEndDate: '',
        maxParticipants: editingEvent.maxParticipants?.toString() || '',
        isPublic: editingEvent.isPublic,
        status: editingEvent.status,
        communityId: editingEvent.community.id,
      });

      setSelectedPastorals(
        editingEvent.eventPastorals?.map((eventPastoral) => ({
          id: eventPastoral.communityPastoralId,
          name:
            eventPastoral.communityPastoral?.globalPastoral?.name ||
            eventPastoral.communityPastoral?.name ||
            'Pastoral',
          requiredPeople: eventPastoral.requiredPeople || 0,
        })) || [],
      );
    } else {
      setFormData(buildInitialForm(currentUser?.communityId || '', initialStartDate));
      setSelectedPastorals([]);
    }

    setPastoralSearch('');
    setCurrentStep(1);
  }, [currentUser?.communityId, editingEvent, initialStartDate, isOpen]);

  const availablePastorals = useMemo(() => {
    const selectedCommunityId = formData.communityId || currentUser?.communityId;
    if (!selectedCommunityId) {
      return [];
    }

    let scopedPastorals = pastorals.filter((pastoral) => pastoral.communityId === selectedCommunityId);

    if (currentUser?.role === 'PASTORAL_COORDINATOR' && currentUser.pastoralIds?.length) {
      scopedPastorals = scopedPastorals.filter((pastoral) => currentUser.pastoralIds?.includes(pastoral.id));
    }

    if (pastoralSearch.trim()) {
      const searchTerm = pastoralSearch.toLowerCase();
      scopedPastorals = scopedPastorals.filter((pastoral) => pastoral.name.toLowerCase().includes(searchTerm));
    }

    return scopedPastorals;
  }, [currentUser, formData.communityId, pastoralSearch, pastorals]);

  const closeAndReset = () => {
    setFormData(buildInitialForm(currentUser?.communityId || '', initialStartDate));
    setSelectedPastorals([]);
    setPastoralSearch('');
    setCurrentStep(1);
    onClose();
  };

  const validateStep1 = () => {
    if (!formData.title.trim()) {
      notify.warning('Título é obrigatório');
      return false;
    }

    if (!formData.startDate) {
      notify.warning('Data e hora de início são obrigatórias');
      return false;
    }

    if (!formData.communityId) {
      notify.warning('Comunidade é obrigatória');
      return false;
    }

    if (formData.endDate && new Date(formData.endDate) < new Date(formData.startDate)) {
      notify.warning('Data de fim não pode ser anterior ao início');
      return false;
    }

    return true;
  };

  const validateStep2 = () => {
    if (formData.isRecurring && !editingEvent) {
      if (!formData.recurrenceType) {
        notify.warning('Selecione o tipo de recorrência');
        return false;
      }

      if (formData.recurrenceType === 'CUSTOM') {
        const selectedDays = formData.recurrenceDays ? JSON.parse(formData.recurrenceDays) : [];
        if (selectedDays.length === 0) {
          notify.warning('Selecione ao menos um dia da semana para a recorrência');
          return false;
        }
      }
    }

    return true;
  };

  const goToNextStep = () => {
    if (currentStep === 1 && !validateStep1()) {
      return;
    }

    if (currentStep === 2 && !validateStep2()) {
      return;
    }

    setCurrentStep((step) => Math.min(step + 1, 3));
  };

  const goToPreviousStep = () => {
    setCurrentStep((step) => Math.max(step - 1, 1));
  };

  const handlePastoralToggle = (pastoral: Pastoral) => {
    const isSelected = selectedPastorals.some((selectedPastoral) => selectedPastoral.id === pastoral.id);

    if (isSelected) {
      setSelectedPastorals((selected) => selected.filter((selectedPastoral) => selectedPastoral.id !== pastoral.id));
      return;
    }

    setSelectedPastorals((selected) => [
      ...selected,
      { id: pastoral.id, name: pastoral.name, requiredPeople: 0 },
    ]);
  };

  const handlePastoralRequirementChange = (pastoralId: string, requiredPeople: number) => {
    setSelectedPastorals((selected) =>
      selected.map((pastoral) =>
        pastoral.id === pastoralId ? { ...pastoral, requiredPeople: Math.max(0, requiredPeople) } : pastoral,
      ),
    );
  };

  const buildEventPayload = (startDate = formData.startDate, endDate = formData.endDate) => ({
    title: formData.title.trim(),
    description: formData.description.trim() || undefined,
    type: formData.type,
    startDate,
    endDate: endDate || undefined,
    location: formData.location.trim() || undefined,
    isRecurring: editingEvent?.isRecurring || false,
    maxParticipants: formData.maxParticipants ? parseInt(formData.maxParticipants, 10) : undefined,
    isPublic: formData.isPublic,
    status: formData.status,
    communityId: formData.communityId,
  });

  const syncEventPastorals = async (
    eventId: string,
    selected: SelectedPastoral[],
    currentPastoralIds: string[],
    token: string | null,
  ) => {
    const headers = { Authorization: `Bearer ${token}` };
    const selectedIds = selected.map((pastoral) => pastoral.id);
    const removedIds = currentPastoralIds.filter((pastoralId) => !selectedIds.includes(pastoralId));

    await Promise.all([
      ...selected.map((pastoral) =>
        axios.post(
          `${API_URL}/events/${eventId}/pastorals`,
          {
            communityPastoralId: pastoral.id,
            requiredPeople: pastoral.requiredPeople,
          },
          { headers },
        ),
      ),
      ...removedIds.map((pastoralId) =>
        axios.delete(`${API_URL}/events/${eventId}/pastorals/${pastoralId}`, { headers }),
      ),
    ]);
  };

  const createRecurringEvents = async (token: string | null) => {
    const headers = { Authorization: `Bearer ${token}` };
    const duration = getEventDuration(formData.startDate, formData.endDate);
    const days = formData.recurrenceDays ? JSON.parse(formData.recurrenceDays) : [];
    const dates = generateRecurrenceDates(formData.startDate, {
      type: formData.recurrenceType as 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM',
      interval: formData.recurrenceInterval,
      days,
      endDate: formData.recurrenceEndDate || undefined,
    });

    for (const date of dates) {
      const response = await axios.post(
        `${API_URL}/events`,
        buildEventPayload(date, applyDuration(date, duration)),
        { headers },
      );

      await syncEventPastorals(response.data.id, selectedPastorals, [], token);
    }

    return dates.length;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!validateStep1() || !validateStep2()) {
      return;
    }

    if (currentUser?.role === 'PASTORAL_COORDINATOR' && selectedPastorals.length === 0) {
      notify.warning('Selecione ao menos uma pastoral para este evento');
      return;
    }

    setIsSubmitting(true);

    try {
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };

      if (editingEvent) {
        await axios.patch(`${API_URL}/events/${editingEvent.id}`, buildEventPayload(), { headers });
        await syncEventPastorals(
          editingEvent.id,
          selectedPastorals,
          editingEvent.eventPastorals?.map((eventPastoral) => eventPastoral.communityPastoralId) || [],
          token,
        );
        notify.success('Evento atualizado com sucesso!');
      } else if (formData.isRecurring) {
        const createdCount = await createRecurringEvents(token);
        notify.success(`${createdCount} eventos criados com sucesso!`);
      } else {
        const response = await axios.post(`${API_URL}/events`, buildEventPayload(), { headers });
        await syncEventPastorals(response.data.id, selectedPastorals, [], token);
        notify.success('Evento criado com sucesso!');
      }

      onSuccess();
      closeAndReset();
    } catch (error: any) {
      console.error('Erro ao salvar evento:', error);
      notify.error(error.response?.data?.message || 'Erro ao salvar evento');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay create-event-modal-overlay" onClick={closeAndReset}>
      <div className="modal-content create-event-modal" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={closeAndReset} type="button" aria-label="Fechar">
          ×
        </button>

        <div className="modal-header">
          <div className="modal-headline">
            <h2>{editingEvent ? 'Editar evento' : 'Criar evento'}</h2>
            <p className="modal-subtitle">
              Organize dados, recorrência e pastorais antes de salvar na agenda.
            </p>
          </div>

          <div className="step-indicator" aria-label="Etapas do formulário">
            {['Dados', 'Detalhes', 'Pastorais'].map((label, index) => {
              const step = index + 1;
              return (
                <div key={label} className={`step ${currentStep >= step ? 'active' : ''}`}>
                  <span className="step-number">{step}</span>
                  <span className="step-label">{label}</span>
                </div>
              );
            })}
          </div>

          <div className="step-progress">
            <div className="step-progress-bar" style={{ width: `${(currentStep / 3) * 100}%` }} />
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-wrapper">
            <section className={`step-content ${currentStep === 1 ? 'active' : ''}`}>
              <div className="form-section">
                <h3>Dados do evento</h3>

                <div className="form-row">
                  <div className="form-group">
                    <label>Título *</label>
                    <input
                      type="text"
                      required
                      value={formData.title}
                      onChange={(event) => setFormData({ ...formData, title: event.target.value })}
                      placeholder="Nome do evento"
                    />
                  </div>

                  <div className="form-group">
                    <label>Tipo *</label>
                    <select
                      required
                      value={formData.type}
                      onChange={(event) => setFormData({ ...formData, type: event.target.value })}
                    >
                      {eventTypes.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Comunidade *</label>
                    <select
                      required
                      value={formData.communityId}
                      onChange={(event) => {
                        setFormData({ ...formData, communityId: event.target.value });
                        setSelectedPastorals([]);
                        setPastoralSearch('');
                      }}
                      disabled={currentUser?.role === 'PASTORAL_COORDINATOR'}
                    >
                      <option value="">Selecione uma comunidade</option>
                      {communities.map((community) => (
                        <option key={community.id} value={community.id}>
                          {community.parish ? `${community.name} - ${community.parish.name}` : community.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Status *</label>
                    <select
                      required
                      value={formData.status}
                      onChange={(event) => setFormData({ ...formData, status: event.target.value })}
                    >
                      {eventStatuses.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Data/hora início *</label>
                    <input
                      type="datetime-local"
                      required
                      value={formData.startDate}
                      onChange={(event) => setFormData({ ...formData, startDate: event.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label>Data/hora fim</label>
                    <input
                      type="datetime-local"
                      value={formData.endDate}
                      onChange={(event) => setFormData({ ...formData, endDate: event.target.value })}
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className={`step-content ${currentStep === 2 ? 'active' : ''}`}>
              <div className="form-section">
                <h3>Detalhes e recorrência</h3>

                <div className="form-group">
                  <label>Descrição</label>
                  <textarea
                    value={formData.description}
                    onChange={(event) => setFormData({ ...formData, description: event.target.value })}
                    placeholder="Detalhes sobre o evento"
                    rows={3}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Local</label>
                    <RoomSelect
                      communityId={formData.communityId || currentUser?.communityId || undefined}
                      value={formData.location}
                      onChange={(location) => setFormData({ ...formData, location })}
                      placeholder="Local do evento"
                    />
                  </div>

                  <div className="form-group">
                    <label>Máximo de participantes</label>
                    <input
                      type="number"
                      min="1"
                      value={formData.maxParticipants}
                      onChange={(event) => setFormData({ ...formData, maxParticipants: event.target.value })}
                      placeholder="Deixe vazio para ilimitado"
                    />
                  </div>
                </div>

                <div className="form-checkboxes">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={formData.isPublic}
                      onChange={(event) => setFormData({ ...formData, isPublic: event.target.checked })}
                    />
                    <span>Evento público</span>
                  </label>

                  {!editingEvent && (
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={formData.isRecurring}
                        onChange={(event) =>
                          setFormData({
                            ...formData,
                            isRecurring: event.target.checked,
                            recurrenceType: event.target.checked ? formData.recurrenceType : '',
                          })
                        }
                      />
                      <span>Criar recorrência</span>
                    </label>
                  )}
                </div>

                {formData.isRecurring && !editingEvent && (
                  <RecurrenceForm
                    isRecurring={formData.isRecurring}
                    recurrenceType={formData.recurrenceType}
                    recurrenceInterval={formData.recurrenceInterval}
                    recurrenceDays={formData.recurrenceDays}
                    recurrenceEndDate={formData.recurrenceEndDate}
                    onChange={(field, value) => setFormData({ ...formData, [field]: value })}
                  />
                )}
              </div>
            </section>

            <section className={`step-content ${currentStep === 3 ? 'active' : ''}`}>
              <div className="form-section">
                <h3>Pastorais envolvidas</h3>
                <p className="section-description">
                  Selecione as pastorais responsáveis ou participantes e informe a quantidade de vagas planejada.
                </p>

                <div className="pastoral-search">
                  <input
                    type="text"
                    placeholder="Buscar pastoral..."
                    value={pastoralSearch}
                    onChange={(event) => setPastoralSearch(event.target.value)}
                    className="search-input"
                  />
                </div>

                <div className="pastoral-selection">
                  {availablePastorals.length === 0 ? (
                    <div className="empty-state">
                      <p>
                        {formData.communityId || currentUser?.communityId
                          ? 'Nenhuma pastoral encontrada para esta comunidade'
                          : 'Selecione uma comunidade para listar as pastorais'}
                      </p>
                    </div>
                  ) : (
                    <div className="pastoral-grid">
                      {availablePastorals.map((pastoral) => {
                        const selectedPastoral = selectedPastorals.find((selected) => selected.id === pastoral.id);
                        const isSelected = Boolean(selectedPastoral);

                        return (
                          <div
                            key={pastoral.id}
                            className={`pastoral-card ${isSelected ? 'selected' : ''}`}
                            onClick={() => handlePastoralToggle(pastoral)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                handlePastoralToggle(pastoral);
                              }
                            }}
                          >
                            <div className="pastoral-card-header">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(event) => {
                                  event.stopPropagation();
                                  handlePastoralToggle(pastoral);
                                }}
                              />
                              <h4>{pastoral.name}</h4>
                            </div>

                            {isSelected && (
                              <div className="pastoral-card-config" onClick={(event) => event.stopPropagation()}>
                                <label>
                                  Vagas planejadas
                                  <input
                                    type="number"
                                    min="0"
                                    value={selectedPastoral?.requiredPeople || 0}
                                    onChange={(event) =>
                                      handlePastoralRequirementChange(
                                        pastoral.id,
                                        parseInt(event.target.value, 10) || 0,
                                      )
                                    }
                                  />
                                </label>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {selectedPastorals.length > 0 && (
                  <div className="selected-pastorals-summary">
                    <h4>Selecionadas ({selectedPastorals.length})</h4>
                    <div className="summary-list">
                      {selectedPastorals.map((pastoral) => (
                        <div key={pastoral.id} className="summary-item">
                          <span className="pastoral-name">{pastoral.name}</span>
                          <span className="pastoral-requirement">
                            {pastoral.requiredPeople > 0 ? `${pastoral.requiredPeople} vagas` : 'Sem vagas definidas'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-cancel" onClick={closeAndReset}>
              Cancelar
            </button>

            {currentStep > 1 && (
              <button type="button" className="btn-secondary" onClick={goToPreviousStep}>
                Anterior
              </button>
            )}

            {currentStep < 3 ? (
              <button key="next" type="button" className="btn-primary" onClick={goToNextStep}>
                Próximo
              </button>
            ) : (
              <button key="submit" type="submit" className="btn-submit" disabled={isSubmitting}>
                {isSubmitting ? 'Salvando...' : editingEvent ? 'Atualizar' : 'Criar'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateEventModal;
