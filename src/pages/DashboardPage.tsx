import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import './DashboardPage.css';

export default function DashboardPage() {
  const { user } = useAuth();

  const stats = [
    { label: 'Dioceses', value: '0', color: '#6B46C1' },
    { label: 'Paróquias', value: '0', color: '#10B981' },
    { label: 'Comunidades', value: '0', color: '#F59E0B' },
    { label: 'Membros', value: '0', color: '#EF4444' },
    { label: 'Eventos', value: '0', color: '#3B82F6' },
    { label: 'Escalas', value: '0', color: '#8B5CF6' },
  ];

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Bem-vindo, {user?.fullName}!</h1>
        <p>Painel administrativo do Parish</p>
      </div>

      <div className="stats-grid">
        {stats.map((stat, index) => (
          <div key={index} className="stat-card" style={{ borderLeftColor: stat.color }}>
            <div className="stat-value">{stat.value}</div>
            <div className="stat-label">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="dashboard-content">
        <div className="content-card">
          <h2>🚀 Bem-vindo ao Parish</h2>
          <p>
            Este é o painel administrativo do sistema Parish. Aqui você pode gerenciar
            dioceses, paróquias, comunidades, membros, eventos e muito mais.
          </p>
          <p>
            Use o menu lateral para navegar entre as diferentes funcionalidades do sistema.
          </p>
        </div>

        <div className="content-card">
          <h2>📊 Estatísticas</h2>
          <p>
            As estatísticas acima mostram um resumo rápido do sistema. Os valores serão
            atualizados conforme você adicionar dados ao sistema.
          </p>
        </div>
      </div>
    </div>
  );
}

