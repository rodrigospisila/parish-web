import React, { useEffect, useState } from 'react';
import api from '../services/api';

interface Room {
  id: string;
  name: string;
  capacity?: number | null;
  status?: string;
}

// Cache por comunidade: vários formulários na mesma tela (Nova Turma, Editar,
// 📆 virada) não refazem o GET /rooms; um erro (ex.: 403 para papéis sem
// acesso ao módulo de Espaços) também não é re-tentado a cada render.
const roomsCache = new Map<string, Room[]>();
const roomsFailed = new Set<string>();

const OTHER = '__other__';

interface RoomSelectProps {
  /** Comunidade dona dos espaços; sem ela, vira input livre com dica */
  communityId?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/**
 * Combobox de espaço físico: lista os Espaços cadastrados da comunidade
 * (módulo Reserva de Espaços) em vez de texto livre. O valor continua sendo o
 * NOME (os campos de sala/local do backend são texto), então dados antigos
 * seguem válidos: valor fora do cadastro aparece como opção própria, e
 * “Outro (digitar)” cobre locais externos (praça, hospital, outra igreja).
 */
const RoomSelect: React.FC<RoomSelectProps> = ({ communityId, value, onChange, placeholder }) => {
  const [rooms, setRooms] = useState<Room[] | null>(() =>
    communityId ? roomsCache.get(communityId) ?? null : null,
  );
  const [failed, setFailed] = useState(() => (communityId ? roomsFailed.has(communityId) : false));
  const [freeText, setFreeText] = useState(false);

  useEffect(() => {
    let alive = true;
    setFreeText(false);
    if (!communityId) {
      setRooms(null);
      setFailed(false);
      return;
    }
    const cached = roomsCache.get(communityId);
    if (cached) {
      setRooms(cached);
      setFailed(false);
      return;
    }
    if (roomsFailed.has(communityId)) {
      setFailed(true);
      return;
    }
    setRooms(null);
    setFailed(false);
    api
      .get('/rooms', { params: { communityId } })
      .then((res) => {
        const list: Room[] = (res.data ?? []).filter((room: Room) => room.status !== 'INACTIVE');
        roomsCache.set(communityId, list);
        if (alive) setRooms(list);
      })
      .catch(() => {
        // Sem acesso ao módulo de Espaços (ou erro): o campo segue como texto
        roomsFailed.add(communityId);
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [communityId]);

  // Sem comunidade escolhida, sem permissão ou sem cadastro → texto livre
  if (!communityId || failed) {
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={!communityId ? 'Escolha a comunidade para listar os espaços' : placeholder ?? 'Ex.: Salão paroquial'}
      />
    );
  }
  if (rooms === null) {
    return (
      <select disabled>
        <option>Carregando espaços…</option>
      </select>
    );
  }
  if (rooms.length === 0) {
    return (
      <>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? 'Ex.: Salão paroquial'}
        />
        <small style={{ display: 'block', color: '#94a3b8', fontSize: '0.75rem', marginTop: 2 }}>
          Nenhum espaço cadastrado nesta comunidade — cadastre em “Espaços” para escolher daqui.
        </small>
      </>
    );
  }

  if (freeText) {
    return (
      <>
        <input
          type="text"
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? 'Digite o local'}
        />
        <button
          type="button"
          className="link-button"
          style={{ fontSize: '0.78rem', marginTop: 2 }}
          onClick={() => setFreeText(false)}
        >
          ☰ escolher um espaço cadastrado
        </button>
      </>
    );
  }

  const known = rooms.some((room) => room.name === value);
  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value === OTHER) {
          setFreeText(true);
          return;
        }
        onChange(e.target.value);
      }}
    >
      <option value="">— Sem local definido</option>
      {rooms.map((room) => (
        <option key={room.id} value={room.name}>
          {room.name}
          {room.capacity ? ` (cap. ${room.capacity})` : ''}
        </option>
      ))}
      {value && !known && <option value={value}>{value} (fora do cadastro)</option>}
      <option value={OTHER}>✏️ Outro local (digitar)…</option>
    </select>
  );
};

export default RoomSelect;
