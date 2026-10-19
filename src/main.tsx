import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'
import { initMonitoring } from './services/monitoring'
import { installPlanErrorHandler } from './services/planErrors'
import './index.css'

// Sentry só com VITE_SENTRY_DSN (sem DSN, nada muda)
initMonitoring()
// Aviso de plano (PLAN_REQUIRED / PLAN_MEMBER_LIMIT) na instância `api` e no axios global
installPlanErrorHandler()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary variant="app">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
