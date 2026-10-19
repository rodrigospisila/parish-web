import React, { useEffect, useMemo, useState } from 'react';
import SearchSelect, { type SearchSelectOption } from '../SearchSelect';
import api from '../../services/api';
import { isPagedResponse, useDebouncedValue } from '../../utils/useDebouncedValue';

interface Props {
  /** Lista paginada no servidor: as opções vêm da busca (GET /members?page&search) */
  serverSearch: boolean;
  /** Opções locais (lista inteira, servidor antigo) */
  localOptions: SearchSelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** Rótulo da seleção atual (ex.: nome do cônjuge já vinculado) */
  selectedLabel?: string;
  excludeId?: string;
  communityId?: string;
  placeholder: string;
}

/**
 * Seletor de membro (cônjuge, responsável). Com a lista de membros paginada no
 * servidor, a página atual não tem todo mundo: a busca vai ao servidor.
 */
const MemberPickerSelect: React.FC<Props> = ({
  serverSearch,
  localOptions,
  value,
  onChange,
  selectedLabel,
  excludeId,
  communityId,
  placeholder,
}) => {
  const [text, setText] = useState('');
  const debounced = useDebouncedValue(text.trim(), 350);
  const [remote, setRemote] = useState<SearchSelectOption[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!serverSearch) return;
    let cancelled = false;
    api
      .get('/members', { params: { page: 1, pageSize: 20, search: debounced || undefined, communityId: communityId || undefined } })
      .then(({ data }) => {
        if (cancelled) return;
        const rows: any[] = isPagedResponse<any>(data) ? data.items : Array.isArray(data) ? data : [];
        setTotal(isPagedResponse<any>(data) ? data.total : rows.length);
        setRemote(
          rows
            .filter((m) => m.id !== excludeId)
            .map((m) => ({ value: m.id, label: m.fullName, sublabel: m.community?.name })),
        );
      })
      .catch(() => {
        if (!cancelled) setRemote([]);
      });
    return () => {
      cancelled = true;
    };
  }, [serverSearch, debounced, communityId, excludeId]);

  const options = useMemo(() => {
    const base = serverSearch ? remote : localOptions;
    if (value && selectedLabel && !base.some((option) => option.value === value)) {
      return [{ value, label: selectedLabel }, ...base];
    }
    return base;
  }, [serverSearch, remote, localOptions, value, selectedLabel]);

  return (
    <SearchSelect
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      allOption
      searchPlaceholder="Buscar membro pelo nome..."
      onSearchChange={serverSearch ? setText : undefined}
      footer={serverSearch && total > remote.length ? `${remote.length} de ${total} — refine a busca` : undefined}
    />
  );
};

export default MemberPickerSelect;
