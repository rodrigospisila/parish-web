import React, { useState } from 'react';
import '../pages/modules/ModulePages.css';

/**
 * Avatar de santo: foto quando há imageUrl; senão, medalhão com as iniciais
 * (cor estável por nome). Compartilhado entre a página de Santos e o
 * gerenciador de padroeiros das entidades.
 */

const AVATAR_COLORS = ['#6f42c1', '#0d6efd', '#198754', '#b02a37', '#fd7e14', '#20c997', '#6610f2', '#d63384'];

export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  // Ignora prefixos comuns (santos e entidades) para pegar o nome próprio
  const skip = new Set([
    'são', 'santo', 'santa', "sant'ana", 'nossa', 'senhora', 'de', 'da', 'do', 'dos', 'das', 'frei',
    'paróquia', 'paroquia', 'diocese', 'arquidiocese', 'comunidade', 'capela',
  ]);
  const parts = name.split(/\s+/).filter((p) => !skip.has(p.toLowerCase()));
  const source = parts.length ? parts : name.split(/\s+/);
  return source.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
}

interface SaintAvatarProps {
  saint: { name: string; imageUrl?: string | null };
  large?: boolean;
  small?: boolean;
}

const SaintAvatar: React.FC<SaintAvatarProps> = ({ saint, large, small }) => {
  const [broken, setBroken] = useState(false);
  const sizeClass = large ? 'large' : small ? 'small' : '';
  if (saint.imageUrl && !broken) {
    return (
      <img
        className={`entity-avatar ${sizeClass}`}
        src={saint.imageUrl}
        alt={saint.name}
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <div
      className={`entity-avatar-fallback ${sizeClass}`}
      style={{ background: avatarColor(saint.name) }}
      title={saint.name}
    >
      {initials(saint.name)}
    </div>
  );
};

export default SaintAvatar;
