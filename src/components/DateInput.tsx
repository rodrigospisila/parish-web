import React, { useEffect, useRef, useState } from 'react';
import './DateInput.css';

/**
 * Campos de data/hora no formato brasileiro, independentes do idioma do
 * navegador: o `<input type="date">` nativo exibe mm/dd/yyyy e AM/PM quando o
 * Windows/Chrome está em inglês. Aqui o usuário digita dd/mm/aaaa (máscara) e
 * o componente entrega/recebe o valor ISO que o resto do sistema já usa
 * (`aaaa-mm-dd`, `HH:mm`, `aaaa-mm-ddTHH:mm`, `aaaa-mm`). O calendário nativo
 * continua disponível pelo ícone, só como atalho de escolha.
 */

const pad = (n: number) => String(n).padStart(2, '0');

const isoToBr = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

/** dd/mm/aaaa completo e válido → aaaa-mm-dd; senão null */
const brToIso = (text: string): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
};

/** Máscara progressiva dd/mm/aaaa a partir dos dígitos digitados */
const maskDate = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter((p, i) => p.length > 0 || i === 0);
  return parts.join('/');
};

const maskTime = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
};

const validTime = (text: string): string | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return `${m[1]}:${m[2]}`;
};

const maskMonth = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, 6);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}/${digits.slice(2)}`;
};

interface BaseProps {
  id?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
  autoFocus?: boolean;
  'aria-label'?: string;
}

interface DateInputProps extends BaseProps {
  /** ISO aaaa-mm-dd ('' = vazio) */
  value: string;
  onChange: (iso: string) => void;
  /** Limites ISO (aplicados ao calendário nativo e à validação ao sair do campo) */
  min?: string;
  max?: string;
}

export const DateInput: React.FC<DateInputProps> = ({ value, onChange, min, max, className, style, placeholder, ...rest }) => {
  const [text, setText] = useState(isoToBr(value));
  const [invalid, setInvalid] = useState(false);

  // Valor mudou por fora (reset do formulário, carga da edição)
  useEffect(() => {
    setText(isoToBr(value));
    setInvalid(false);
  }, [value]);

  const commit = (candidate: string) => {
    if (!candidate) {
      setInvalid(false);
      if (value) onChange('');
      return;
    }
    const iso = brToIso(candidate);
    const inRange = iso && (!min || iso >= min.slice(0, 10)) && (!max || iso <= max.slice(0, 10));
    if (iso && inRange) {
      setInvalid(false);
      if (iso !== value) onChange(iso);
    } else {
      setInvalid(true);
    }
  };

  return (
    <span className={`date-br${invalid ? ' is-invalid' : ''}`} style={style}>
      <input
        {...rest}
        type="text"
        inputMode="numeric"
        className={className}
        placeholder={placeholder ?? 'dd/mm/aaaa'}
        maxLength={10}
        pattern="\d{2}/\d{2}/\d{4}"
        title="Data no formato dd/mm/aaaa"
        value={text}
        onChange={(e) => {
          const masked = maskDate(e.target.value);
          setText(masked);
          if (masked.length === 10 || masked.length === 0) commit(masked);
        }}
        onBlur={() => {
          if (text.length !== 10 && text.length !== 0) {
            // Incompleto: volta para o último valor válido
            setText(isoToBr(value));
            setInvalid(false);
          }
        }}
      />
      <span className="date-br__pick" title="Abrir calendário" aria-hidden={rest.disabled ? true : undefined}>
        📅
        <input
          type="date"
          tabIndex={-1}
          aria-label="Escolher no calendário"
          value={value}
          min={min}
          max={max}
          disabled={rest.disabled}
          onChange={(e) => {
            const iso = e.target.value;
            setText(isoToBr(iso));
            setInvalid(false);
            onChange(iso);
          }}
        />
      </span>
    </span>
  );
};

interface TimeInputProps extends BaseProps {
  /** HH:mm ('' = vazio) */
  value: string;
  onChange: (time: string) => void;
}

export const TimeInput: React.FC<TimeInputProps> = ({ value, onChange, className, style, placeholder, ...rest }) => {
  const [text, setText] = useState(value ?? '');
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(value ?? '');
    setInvalid(false);
  }, [value]);

  return (
    <span className={`time-br${invalid ? ' is-invalid' : ''}`} style={style}>
      <input
        {...rest}
        type="text"
        inputMode="numeric"
        className={className}
        placeholder={placeholder ?? 'hh:mm'}
        maxLength={5}
        pattern="([01]\d|2[0-3]):[0-5]\d"
        title="Horário no formato 24 h (hh:mm)"
        value={text}
        onChange={(e) => {
          const masked = maskTime(e.target.value);
          setText(masked);
          if (masked.length === 0) {
            setInvalid(false);
            if (value) onChange('');
          } else if (masked.length === 5) {
            const time = validTime(masked);
            setInvalid(!time);
            if (time && time !== value) onChange(time);
          }
        }}
        onBlur={() => {
          if (text.length !== 5 && text.length !== 0) {
            setText(value ?? '');
            setInvalid(false);
          }
        }}
      />
      <span className="time-br__hint" aria-hidden="true">24h</span>
    </span>
  );
};

interface DateTimeInputProps extends BaseProps {
  /** aaaa-mm-ddTHH:mm ('' = vazio) — o mesmo formato do datetime-local */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
}

/** Data + hora lado a lado; só emite valor quando as duas partes estão preenchidas. */
export const DateTimeInput: React.FC<DateTimeInputProps> = ({ value, onChange, min, max, required, id, disabled, style, className }) => {
  const [datePart, setDatePart] = useState(value ? value.slice(0, 10) : '');
  const [timePart, setTimePart] = useState(value ? value.slice(11, 16) : '');
  // Limpar só a hora (ou só a data) esvazia o valor do pai; a outra metade
  // precisa continuar na tela para o usuário completar
  const selfCleared = useRef(false);

  useEffect(() => {
    if (value === '' && selfCleared.current) {
      selfCleared.current = false;
      return;
    }
    setDatePart(value ? value.slice(0, 10) : '');
    setTimePart(value ? value.slice(11, 16) : '');
  }, [value]);

  const emit = (date: string, time: string) => {
    const next = date && time ? `${date}T${time}` : '';
    if (next !== value) {
      selfCleared.current = next === '';
      onChange(next);
    }
  };

  return (
    <span className="datetime-br" style={style}>
      <DateInput
        id={id}
        className={className}
        required={required}
        disabled={disabled}
        value={datePart}
        min={min?.slice(0, 10)}
        max={max?.slice(0, 10)}
        onChange={(date) => {
          setDatePart(date);
          emit(date, timePart);
        }}
      />
      <TimeInput
        className={className}
        required={required}
        disabled={disabled}
        value={timePart}
        onChange={(time) => {
          setTimePart(time);
          emit(datePart, time);
        }}
      />
    </span>
  );
};

interface MonthInputProps extends BaseProps {
  /** aaaa-mm ('' = vazio) */
  value: string;
  onChange: (month: string) => void;
}

export const MonthInput: React.FC<MonthInputProps> = ({ value, onChange, className, style, placeholder, ...rest }) => {
  const toBr = (iso: string) => {
    const m = /^(\d{4})-(\d{2})$/.exec(iso ?? '');
    return m ? `${m[2]}/${m[1]}` : '';
  };
  const [text, setText] = useState(toBr(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(toBr(value));
    setInvalid(false);
  }, [value]);

  return (
    <span className={`date-br${invalid ? ' is-invalid' : ''}`} style={style}>
      <input
        {...rest}
        type="text"
        inputMode="numeric"
        className={className}
        placeholder={placeholder ?? 'mm/aaaa'}
        maxLength={7}
        pattern="\d{2}/\d{4}"
        title="Mês no formato mm/aaaa"
        value={text}
        onChange={(e) => {
          const masked = maskMonth(e.target.value);
          setText(masked);
          if (masked.length === 0) {
            setInvalid(false);
            if (value) onChange('');
          } else if (masked.length === 7) {
            const m = /^(\d{2})\/(\d{4})$/.exec(masked);
            const month = m ? Number(m[1]) : 0;
            const year = m ? Number(m[2]) : 0;
            const valid = !!m && month >= 1 && month <= 12 && year >= 1900 && year <= 2100;
            setInvalid(!valid);
            if (valid) {
              const iso = `${m![2]}-${m![1]}`;
              if (iso !== value) onChange(iso);
            }
          }
        }}
        onBlur={() => {
          if (text.length !== 7 && text.length !== 0) {
            setText(toBr(value));
            setInvalid(false);
          }
        }}
      />
      <span className="date-br__pick" title="Escolher o mês">
        📅
        <input
          type="month"
          tabIndex={-1}
          aria-label="Escolher o mês"
          value={value}
          disabled={rest.disabled}
          onChange={(e) => {
            setText(toBr(e.target.value));
            setInvalid(false);
            onChange(e.target.value);
          }}
        />
      </span>
    </span>
  );
};

export default DateInput;
