# Parish Web - Frontend

Sistema de Gestão Paroquial - Interface Web Administrativa

## 🚀 Tecnologias

- **React 19.2.0** - Biblioteca para construção de interfaces
- **TypeScript 5.9.3** - Superset tipado do JavaScript
- **Vite 7.1.12** - Build tool e dev server
- **React Router DOM 7.9.5** - Roteamento
- **Axios 1.13.1** - Cliente HTTP
- **CSS Modules** - Estilização modular

## 📋 Pré-requisitos

- Node.js 18+ 
- pnpm (recomendado) ou npm
- Backend rodando em `http://localhost:3000`

## 🔧 Instalação

1. Clone o repositório:
```bash
git clone https://github.com/rodrigospisila/parish-web.git
cd parish-web
```

2. Instale as dependências:
```bash
pnpm install
# ou
npm install
```

3. Configure as variáveis de ambiente:
```bash
cp .env.example .env
```

4. Edite o arquivo `.env` com suas configurações:
```env
VITE_API_URL=http://localhost:3000/api/v1
```

## ▶️ Executando o Projeto

### Modo de Desenvolvimento
```bash
pnpm dev
# ou
npm run dev
```

O aplicativo estará disponível em `http://localhost:5173`

### Build para Produção
```bash
pnpm build
# ou
npm run build
```

### Preview da Build
```bash
pnpm preview
# ou
npm run preview
```

## 🔐 Credenciais Padrão

Após executar o seed do backend:

- **Email:** system@parish.app
- **Senha:** System@Admin123

## 📁 Estrutura do Projeto

```
parish-web/
├── src/
│   ├── components/          # Componentes reutilizáveis
│   │   ├── AdminLayout.tsx  # Layout principal com sidebar
│   │   └── AdminLayout.css
│   ├── contexts/            # Contextos React
│   │   └── AuthContext.tsx  # Contexto de autenticação
│   ├── pages/               # Páginas da aplicação
│   │   ├── LoginPage.tsx    # Página de login
│   │   ├── EventsPage.tsx   # Gestão de eventos
│   │   └── *.css           # Estilos das páginas
│   ├── App.tsx              # Componente raiz com rotas
│   ├── main.tsx             # Entry point
│   └── index.css            # Estilos globais
├── .env                     # Variáveis de ambiente (não commitado)
├── .env.example             # Exemplo de variáveis de ambiente
├── .gitignore
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## 🌐 Variáveis de Ambiente

O projeto utiliza variáveis de ambiente para configuração. Todas as variáveis devem ser prefixadas com `VITE_` para serem acessíveis no código.

### Variáveis Disponíveis

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `VITE_API_URL` | URL base da API do backend | `http://localhost:3000/api/v1` |

### Como Usar

No código TypeScript/React:
```typescript
const API_URL = import.meta.env.VITE_API_URL;
```

### Ambientes

- **Desenvolvimento:** `.env` (local, não commitado)
- **Produção:** Configure as variáveis no seu serviço de hospedagem

## 🎨 Funcionalidades

### Autenticação
- ✅ Login com JWT
- ✅ Logout
- ✅ Proteção de rotas
- ✅ Persistência de sessão

### Gestão de Eventos
- ✅ Listar eventos
- ✅ Criar evento
- ✅ Editar evento
- ✅ Excluir evento
- ✅ Filtros por tipo e status
- ✅ Busca por título/descrição

### Layout
- ✅ Sidebar responsiva
- ✅ Navegação entre módulos
- ✅ Informações do usuário
- ✅ Design moderno e limpo

## 🔒 Segurança

- Tokens JWT armazenados no localStorage
- Rotas protegidas com `ProtectedRoute`
- Interceptor do Axios para adicionar token automaticamente
- Variáveis de ambiente para URLs sensíveis
- `.env` não commitado no Git

## 📝 Boas Práticas

### Variáveis de Ambiente
- ✅ Todas as URLs da API usam `VITE_API_URL`
- ✅ Arquivo `.env.example` documentado
- ✅ `.env` no `.gitignore`
- ✅ Sem URLs hardcoded no código

### TypeScript
- ✅ Interfaces para todos os tipos
- ✅ Type safety em componentes
- ✅ Strict mode habilitado

### Código
- ✅ Componentes funcionais com hooks
- ✅ CSS modular por componente
- ✅ Nomenclatura consistente
- ✅ Separação de responsabilidades

## 🤝 Contribuindo

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/MinhaFeature`)
3. Commit suas mudanças (`git commit -m 'Adiciona MinhaFeature'`)
4. Push para a branch (`git push origin feature/MinhaFeature`)
5. Abra um Pull Request

## 📄 Licença

Este projeto é privado e proprietário.

## 🔗 Links

- **Backend:** https://github.com/rodrigospisila/parish-backend
- **Documentação da API:** http://localhost:3000/api (quando rodando)

## 📞 Suporte

Para dúvidas ou problemas, abra uma issue no GitHub.
