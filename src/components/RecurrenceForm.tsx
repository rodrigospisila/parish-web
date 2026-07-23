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

const parseSelectedDays = (recurrenceDays: string) => {
  try {
    const days = recurrenceDays ? JSON.parse(recurrenceDays) : [];
    return Array.isArray(days) ? days : [];
  } catch {
    return [];
  }
};

const RecurrenceForm: React.FC<RecurrenceFormProps> = ({
  isRecurring,
  recurrenceType,
  recurrenceInterval,
  recurrenceDays,
  recurrenceEndDate,
  onChange,
}) => {
  const selectedDays = parseSelectedDays(recurrenceDays);

  const toggleDay = (day: number) => {
    const days = selectedDays.includes(day)
      ? selectedDays.filter((selectedDay: number) => selectedDay !== day)
      : [...selectedDays, day].sort((a, b) => a - b);
    onChange('recurrenceDays', JSON.stringify(days));
  };

  if (!isRecurring) {
    return null;
  }

  return (
    <div className="recurrence-form">
      <div className="recurrence-header">
        <h4>Configurar recorrência</h4>
      </div>

      <div className="form-group">
        <label>Tipo de recorrência *</label>
        <select value={recurrenceType} onChange={(event) => onChange('recurrenceType', event.target.value)} required>
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
            onChange={(event) => onChange('recurrenceInterval', parseInt(event.target.value, 10) || 1)}
            required
          />
        </div>
      )}

      {recurrenceType === 'CUSTOM' && (
        <div className="form-group">
          <label>Dias da semana *</label>
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
        </div>
      )}

      <div className="form-group">
        <label>Data de término</label>
        <input type="date" value={recurrenceEndDate} onChange={(event) => onChange('recurrenceEndDate', event.target.value)} />
      </div>

      <div className="recurrence-summary">
        <strong>Resumo:</strong>{' '}
        {recurrenceType === 'DAILY' && `Repete a cada ${recurrenceInterval} dia(s)`}
        {recurrenceType === 'WEEKLY' && `Repete a cada ${recurrenceInterval} semana(s)`}
        {recurrenceType === 'MONTHLY' && `Repete a cada ${recurrenceInterval} mês(es)`}
        {recurrenceType === 'CUSTOM' &&
          selectedDays.length > 0 &&
          `Repete em: ${selectedDays
            .map((day: number) => weekDays.find((weekDay) => weekDay.value === day)?.label)
            .join(', ')}`}
        {!recurrenceType && 'Selecione uma recorrência'}
        {recurrenceEndDate && ` até ${new Date(recurrenceEndDate).toLocaleDateString('pt-BR')}`}
      </div>
    </div>
  );
};

export default RecurrenceForm;
