import React, { useState, useRef, useEffect } from 'react';
import './TimeInput24h.css';

interface TimeInput24hProps {
  value: string; // Formato: "HH:mm"
  onChange: (value: string) => void;
}

const TimeInput24h: React.FC<TimeInput24hProps> = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hours, minutes] = value.split(':');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleHourChange = (hour: string) => {
    onChange(`${hour}:${minutes}`);
  };

  const handleMinuteChange = (minute: string) => {
    onChange(`${hours}:${minute}`);
  };

  // Gerar array de horas (00-23)
  const hoursArray = Array.from({ length: 24 }, (_, i) => 
    i.toString().padStart(2, '0')
  );

  // Gerar array de minutos (00, 15, 30, 45)
  const minutesArray = ['00', '15', '30', '45'];

  return (
    <div className="time-input-24h" ref={dropdownRef}>
      <button
        type="button"
        className="time-display"
        onClick={() => setIsOpen(!isOpen)}
      >
        🕐 {value}
      </button>

      {isOpen && (
        <div className="time-dropdown">
          <div className="time-column">
            <div className="time-column-header">Hora</div>
            <div className="time-options">
              {hoursArray.map((hour) => (
                <button
                  key={hour}
                  type="button"
                  className={`time-option ${hours === hour ? 'selected' : ''}`}
                  onClick={() => {
                    handleHourChange(hour);
                    setIsOpen(false);
                  }}
                >
                  {hour}
                </button>
              ))}
            </div>
          </div>

          <div className="time-column">
            <div className="time-column-header">Min</div>
            <div className="time-options">
              {minutesArray.map((minute) => (
                <button
                  key={minute}
                  type="button"
                  className={`time-option ${minutes === minute ? 'selected' : ''}`}
                  onClick={() => {
                    handleMinuteChange(minute);
                    setIsOpen(false);
                  }}
                >
                  {minute}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimeInput24h;
