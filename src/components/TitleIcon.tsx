import React from 'react';

/**
 * Ícone colorido de título de página (Identidade Visual v2.2 — 30 símbolos).
 * SVGs em /public/title-icons (versão "com fundo", squircle da paleta Parish).
 */
const TitleIcon: React.FC<{ name: string; size?: number }> = ({ name, size = 34 }) => (
  <img
    src={`/title-icons/${name}.svg`}
    alt=""
    aria-hidden="true"
    width={size}
    height={size}
    style={{ verticalAlign: 'middle', marginRight: 10, borderRadius: 8, flexShrink: 0 }}
  />
);

export default TitleIcon;
