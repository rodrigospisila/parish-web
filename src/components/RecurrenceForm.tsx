import React from 'react';
import './RecurrenceForm.css';

interface RecurrenceFormProps {
  isRecurring: boolean;
  recurrenceType: string;
  recurrenceInterval: number;
  recurrenceDays: string;
  recurrenceEndDate: string;
  onChange: (field: string, value: any) => void;
}

const RecurrenceForm: React.FC<RecurrenceFormProps> = ({
  isRecurring,
  recurrenceType,
  recurrenceInterval,
  recurrenceDays,
  recurrenceEndDate,
  onChange,
}) => {
  const recurrenceTypes = [
    { value: 'DAILY', label: 'Diário' },
    { value: 'WEEKLY', label: 'Semanal' },
    { value: 'MONTHLY', label: 'Mensal' },
    { value: 'CUSTOM', label: 'Personalizado' },
  ];

  const weekDays = [
    { value: 0, label: 'Dom' },
    { value: 1, label: 'Seg' },
    { value: 2, label: 'Ter' },
    { value: 3, label: 'Qua' },
    { value: 4, label: 'Qui' },
    { value: 5, label: 'Sex' },
    { value: 6, label: 'Sáb' },
  ];

  const selectedDays = recurrenceDays ? JSON.parse(recurrenceDays) : [];

  const toggleDay = (day: number) => {
    const days = selectedDays.includes(day)
      ? selectedDays.filter((d: number) => d !== day)
      : [...selectedDays, day].sort((a, b) => a - b);
    onChange('recurrenceDays', JSON.stringify(days));
  };

  if (!isRecurring) return null;

  return (
    <div className="recurrence-form">
      <div className="recurrence-header">
        <span className="recurrence-icon">🔄</span>
        <h4>Configurar Recorrência</h4>
      </div>

      <div className="form-group">
        <label>Tipo de Recorrência *</label>
        <select
          value={recurrenceType}
          onChange={(e) => onChange('recurrenceType', e.target.value)}
          required
        >
          <option value="">Selecione o tipo</option>
          {recurrenceTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </div>

      {recurrenceType && recurrenceType !== 'CUSTOM' && (
        <div className="form-group">
          <label>
            Repetir a cada{' '}
            {recurrenceType === 'DAILY' && 'dia(s)'}
            {recurrenceType === 'WEEKLY' && 'semana(s)'}
            {recurrenceType === 'MONTHLY' && 'mês(es)'}
          </label>
          <input
            type="number"
            min="1"
            max="12"
            value={recurrenceInterval}
            onChange={(e) => onChange('recurrenceInterval', parseInt(e.target.value))}
            required
          />
        </div>
      )}

      {recurrenceType === 'CUSTOM' && (
        <div className="form-group">
          <label>Dias da Semana *</label>
          <div className="weekday-selector">
            {weekDays.map((day) => (
              <button
                key={day.value}
                type="button"
                className={`weekday-btn ${selectedDays.includes(day.value) ? 'selected' : ''}`}
                onClick={() => toggleDay(day.value)}
              >
                {day.label}
              </button>
            ))}
          </div>
          <small className="form-hint">Selecione os dias da semana em que o evento se repete</small>
        </div>
      )}

      <div className="form-group">
        <label>Data de Término</label>
        <input
          type="date"
          value={recurrenceEndDate}
          onChange={(e) => onChange('recurrenceEndDate', e.target.value)}
        />
        <small className="form-hint">Deixe em branco para repetir indefinidamente</small>
      </div>

      <div className="recurrence-summary">
        <strong>Resumo:</strong>{' '}
        {recurrenceType === 'DAILY' && `Repete a cada ${recurrenceInterval} dia(s)`}
        {recurrenceType === 'WEEKLY' && `Repete a cada ${recurrenceInterval} semana(s)`}
        {recurrenceType === 'MONTHLY' && `Repete a cada ${recurrenceInterval} mês(es)`}
        {recurrenceType === 'CUSTOM' && selectedDays.length > 0 && (
          <>
            Repete toda(s):{' '}
            {selectedDays
              .map((d: number) => weekDays.find((wd) => wd.value === d)?.label)
              .join(', ')}
          </>
        )}
        {recurrenceEndDate && ` até ${new Date(recurrenceEndDate).toLocaleDateString('pt-BR')}`}
      </div>
    </div>
  );
};

export default RecurrenceForm;
