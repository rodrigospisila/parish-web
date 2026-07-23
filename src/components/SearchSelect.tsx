import React, { useEffect, useRef, useState } from 'react';
import '../pages/modules/ModulePages.css';

/**
 * Combobox com busca para escolher entidades (diocese, paróquia, comunidade...).
 * Cada opção mostra o nome em destaque e uma linha de contexto (sublabel) —
 * ex.: paróquia com a diocese e a cidade. Busca ignora acentos.
 */

export interface SearchSelectOption {
  value: string;
  label: string;
  sublabel?: string;
  /** Ícone/avatar exibido à esquerda (ex.: foto do santo padroeiro) */
  icon?: React.ReactNode;
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

interface SearchSelectProps {
  options: SearchSelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** Texto exibido sem seleção; com `allOption`, vira também a opção "todos" */
  placeholder: string;
  /** Inclui a opção de limpar a seleção (para filtros) */
  allOption?: boolean;
  searchPlaceholder?: string;
}

const SearchSelect: React.FC<SearchSelectProps> = ({
  options,
  value,
  onChange,
  placeholder,
  allOption,
  searchPlaceholder,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const selected = options.find((option) => option.value === value);
  const filtered = options.filter(
    (option) =>
      !search.trim() ||
      normalize(`${option.label} ${option.sublabel ?? ''}`).includes(normalize(search)),
  );

  const pick = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    setSearch('');
  };

  return (
    <div className="search-select" ref={rootRef}>
      <button type="button" className="search-select-toggle" onClick={() => setOpen(!open)}>
        <span className={`search-select-value ${selected ? '' : 'search-select-placeholder'}`}>
          {selected?.icon}
          {selected ? selected.label : placeholder}
        </span>
        <span className="search-select-caret">▾</span>
      </button>

      {open && (
        <div className="search-select-menu">
          <input
            autoFocus
            type="text"
            className="saint-picker-search"
            placeholder={searchPlaceholder ?? 'Buscar...'}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="saint-picker-list">
            {allOption && (
              <button
                type="button"
                className={`saint-picker-item ${!value ? 'selected' : ''}`}
                onClick={() => pick('')}
              >
                <span className="picker-info">
                  <span className="picker-name">{placeholder}</span>
                </span>
                {!value && <span className="picker-check">✓</span>}
              </button>
            )}
            {filtered.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`saint-picker-item ${value === option.value ? 'selected' : ''}`}
                onClick={() => pick(option.value)}
              >
                {option.icon}
                <span className="picker-info">
                  <span className="picker-name">{option.label}</span>
                  {option.sublabel && (
                    <span className="picker-meta" style={{ display: 'block' }}>{option.sublabel}</span>
                  )}
                </span>
                {value === option.value && <span className="picker-check">✓</span>}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="saint-picker-empty">Nada encontrado para "{search}".</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchSelect;
