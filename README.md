> Este repositório foi criado automaticamente pelo Manus para o desenvolvimento da interface web do Parish.

# Parish Web

Interface web administrativa do sistema Parish, projetada para a gestão completa por administradores diocesanos, paroquiais e coordenadores.

## 1. Visão Geral

Este repositório contém o código-fonte do frontend web do sistema Parish. A aplicação permite que os administradores gerenciem todos os aspectos da plataforma, desde a estrutura eclesial até os relatórios financeiros e de engajamento.

## 2. Tecnologias

- **Framework**: [React](https://react.dev/) (v18.x)
- **Linguagem**: TypeScript
- **UI Framework**: [Material-UI (MUI)](https://mui.com/) ou [Ant Design](https://ant.design/)
- **Roteamento**: [React Router](https://reactrouter.com/) (v6)
- **Gerenciamento de Estado**: [Zustand](https://zustand-demo.pmnd.rs/) (ou Redux Toolkit)
- **Requisições API**: [TanStack Query (React Query)](https://tanstack.com/query/latest)
- **Formulários**: [React Hook Form](https://react-hook-form.com/) + [Zod](https://zod.dev/)
- **Tabelas**: [TanStack Table](https://tanstack.com/table/v8)
- **Gráficos**: [Recharts](https://recharts.org/) ou [Chart.js](https://www.chartjs.org/)
- **Build Tool**: [Vite](https://vitejs.dev/)

## 3. Funcionalidades Principais (MVP)

- **Dashboard**: Visão geral com os principais indicadores da diocese/paróquia.
- **Gestão da Estrutura**: CRUD completo de dioceses, paróquias e comunidades.
- **Gestão de Membros**: Cadastro, edição e visualização de fiéis, com filtros e busca.
- **Calendário e Eventos**: Criação e gestão de eventos, missas e atividades pastorais.
- **Gestão de Escalas**: Criação de escalas, atribuição de voluntários e monitoramento.
- **Moderação**: Aprovação de pedidos de oração e outros conteúdos gerados pelos usuários.
- **Gestão Financeira**: Lançamento de receitas, despesas e geração de relatórios básicos.
- **Relatórios**: Visualização de dados de engajamento, participação e crescimento.
- **Comunicação**: Envio de notificações e emails em massa para segmentos de usuários.

## 4. Estrutura do Projeto

A estrutura do projeto é baseada em features, promovendo a componentização e o baixo acoplamento.

```
src/
├── components/         # Componentes de UI reutilizáveis (Button, Input, etc.)
│   ├── common/
│   ├── layout/         # Layouts principais (DashboardLayout, AuthLayout)
│   └── features/       # Componentes específicos de cada feature
├── pages/              # Páginas da aplicação (ligadas ao roteador)
│   ├── Dashboard.tsx
│   ├── Members/
│   ├── Events/
│   └── ...
├── hooks/              # Hooks customizados
├── services/           # Lógica de comunicação com a API
├── store/              # Gerenciamento de estado global (Zustand/Redux)
├── utils/              # Funções utilitárias
└── App.tsx             # Componente raiz e configuração de rotas
```

## 5. Como Começar

### Pré-requisitos

- Node.js (v20.x ou 22.x)
- Git

### Instalação

1. **Clone o repositório:**
   ```bash
   git clone https://github.com/rodrigospisila/parish-web.git
   cd parish-web
   ```

2. **Instale as dependências:**
   ```bash
   npm install
   ```

3. **Configure as variáveis de ambiente:**
   - Crie um arquivo `.env.local` na raiz do projeto.
   - Adicione a variável `VITE_API_URL` com o endereço do seu backend (ex: `VITE_API_URL=http://localhost:3000/api/v1`).

4. **Inicie a aplicação em modo de desenvolvimento:**
   ```bash
   npm run dev
   ```

A aplicação estará disponível em `http://localhost:5173`.

## 6. Build para Produção

Para gerar a versão otimizada para produção, execute:

```bash
npm run build
```

Os arquivos estáticos serão gerados no diretório `dist/`.

## 7. Testes

- **Testes Unitários e de Componente**: `npm run test`
- **Testes End-to-End (E2E)**: `npm run test:e2e` (requer configuração do Playwright/Cypress)

## 8. Contribuição

Consulte o arquivo `CONTRIBUTING.md` para mais detalhes sobre como contribuir com o projeto.

