import React, { useCallback, useEffect, useState } from 'react';
import TitleIcon from '../../components/TitleIcon';
import api from '../../services/api';
import { notify } from '../../services/notification.service';
import { dataHoraBR, mensagemDeErro } from './platformShared';
import '../modules/ModulePages.css';
import './PlatformPages.css';

/**
 * Avisos da plataforma aos clientes (saas-implantacao-29): novidade,
 * manutenção ou incidente, para gestores (ADMINS) ou todos (ALL), com início
 * e fim. Aparecem como faixa no painel (GET /announcements/active).
 */

type Kind = 'NEWS' | 'MAINTENANCE' | 'INCIDENT';
type Audience = 'ADMINS' | 'ALL';

interface Announcement {
  id: string;
  title: string;
  body: string;
  kind: Kind;
  audience: Audience;
  startsAt: string;
  endsAt: string | null;
  createdAt?: string;
}

interface FormState {
  id: string | null;
  title: string;
  body: string;
  kind: Kind;
  audience: Audience;
  startsAt: string;
  endsAt: string;
}

const KIND_LABEL: Record<Kind, string> = { NEWS: 'Novidade', MAINTENANCE: 'Manutenção', INCIDENT: 'Incidente' };
const KIND_TONE: Record<Kind, string> = { NEWS: 'blue', MAINTENANCE: 'yellow', INCIDENT: 'red' };
const AUDIENCE_LABEL: Record<Audience, string> = { ADMINS: 'Gestores (coordenação para cima)', ALL: 'Todos os usuários do painel' };

/** ISO → valor do <input type="datetime-local"> no fuso do navegador. */
const paraCampo = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** Valor do campo (hora local) → ISO; vazio = null. */
const doCampo = (v: string) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const situacao = (a: Announcement): { label: string; tone: string } => {
  const agora = Date.now();
  if (new Date(a.startsAt).getTime() > agora) return { label: 'Agendado', tone: 'blue' };
  if (a.endsAt && new Date(a.endsAt).getTime() <= agora) return { label: 'Encerrado', tone: 'gray' };
  return { label: 'No ar', tone: 'green' };
};

const novoForm = (): FormState => ({
  id: null,
  title: '',
  body: '',
  kind: 'NEWS',
  audience: 'ADMINS',
  startsAt: paraCampo(new Date().toISOString()),
  endsAt: '',
});

const asList = (data: any): Announcement[] => {
  const arr = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  return arr.filter((a: any) => a && typeof a.id === 'string');
};

const AnnouncementsPage: React.FC = () => {
  const [lista, setLista] = useState<Announcement[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [erroForm, setErroForm] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const { data } = await api.get('/platform/announcements');
      setLista(asList(data).sort((a, b) => b.startsAt.localeCompare(a.startsAt)));
    } catch (e) {
      setLista([]);
      setErro(mensagemDeErro(e, 'Não foi possível carregar os avisos.'));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setErroForm('');
    const title = form.title.trim();
    const body = form.body.trim();
    if (title.length < 3) return setErroForm('Escreva um título.');
    if (body.length < 3) return setErroForm('Escreva o texto do aviso.');
    const startsAt = doCampo(form.startsAt) ?? new Date().toISOString();
    const endsAt = doCampo(form.endsAt);
    if (endsAt && new Date(endsAt) <= new Date(startsAt)) return setErroForm('O fim precisa ser depois do início.');
    setSalvando(true);
    try {
      const payload = { title, body, kind: form.kind, audience: form.audience, startsAt, endsAt };
      if (form.id) await api.patch(`/platform/announcements/${encodeURIComponent(form.id)}`, payload);
      else await api.post('/platform/announcements', payload);
      notify.success(form.id ? 'Aviso atualizado.' : 'Aviso criado.');
      setForm(null);
      await carregar();
    } catch (err) {
      setErroForm(mensagemDeErro(err, 'Não foi possível salvar o aviso.'));
    } finally {
      setSalvando(false);
    }
  };

  const encerrarAgora = async (a: Announcement) => {
    try {
      await api.patch(`/platform/announcements/${encodeURIComponent(a.id)}`, { endsAt: new Date().toISOString() });
      notify.success('Aviso encerrado.');
      await carregar();
    } catch (err) {
      notify.error(mensagemDeErro(err, 'Não foi possível encerrar o aviso.'));
    }
  };

  const excluir = async (a: Announcement) => {
    try {
      await api.delete(`/platform/announcements/${encodeURIComponent(a.id)}`);
      setExcluindo(null);
      notify.success('Aviso excluído.');
      setLista((prev) => prev.filter((x) => x.id !== a.id));
    } catch (err) {
      notify.error(mensagemDeErro(err, 'Não foi possível excluir o aviso.'));
    }
  };

  return (
    <div className="module-page platform-page">
      <div className="page-header">
        <h1>
          <TitleIcon name="sino" /> Avisos aos clientes
        </h1>
        <div className="header-actions">
          <button type="button" className="pf-btn" onClick={() => void carregar()} disabled={carregando}>
            {carregando ? 'Atualizando…' : 'Atualizar'}
          </button>
          <button type="button" className="pf-btn pf-btn-primario" onClick={() => { setErroForm(''); setForm(novoForm()); }}>
            Novo aviso
          </button>
        </div>
      </div>
      <p className="pf-nota">Aparecem como faixa no topo do painel enquanto estiverem no ar. Cada pessoa pode dispensar o aviso.</p>

      {erro && (
        <p className="pf-erro">
          {erro}{' '}
          <button type="button" className="pf-link" onClick={() => void carregar()}>
            tentar de novo
          </button>
        </p>
      )}

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Aviso</th>
              <th scope="col">Tipo</th>
              <th scope="col">Para</th>
              <th scope="col">Período</th>
              <th scope="col">Situação</th>
              <th scope="col" aria-label="Ações" />
            </tr>
          </thead>
          <tbody>
            {carregando && lista.length === 0 && (
              <tr>
                <td colSpan={6} className="pf-vazio">
                  Carregando…
                </td>
              </tr>
            )}
            {!carregando && lista.length === 0 && (
              <tr>
                <td colSpan={6} className="pf-vazio">
                  Nenhum aviso ainda.
                </td>
              </tr>
            )}
            {lista.map((a) => {
              const st = situacao(a);
              return (
                <tr key={a.id}>
                  <td>
                    <strong className="pf-nome">{a.title}</strong>
                    <span className="pf-sub pf-anuncio-corpo">{a.body}</span>
                  </td>
                  <td>
                    <span className={`status-badge ${KIND_TONE[a.kind] ?? 'gray'}`}>{KIND_LABEL[a.kind] ?? a.kind}</span>
                  </td>
                  <td>{a.audience === 'ALL' ? 'Todos' : 'Gestores'}</td>
                  <td>
                    {dataHoraBR(a.startsAt)}
                    <span className="pf-sub">{a.endsAt ? `até ${dataHoraBR(a.endsAt)}` : 'sem data de fim'}</span>
                  </td>
                  <td>
                    <span className={`status-badge ${st.tone}`}>{st.label}</span>
                  </td>
                  <td className="pf-direita">
                    {excluindo === a.id ? (
                      <span className="pf-acoes">
                        <button type="button" className="pf-btn pf-btn-mini" onClick={() => setExcluindo(null)}>
                          Voltar
                        </button>
                        <button type="button" className="pf-btn pf-btn-mini pf-btn-perigo-cheio" onClick={() => void excluir(a)}>
                          Excluir mesmo
                        </button>
                      </span>
                    ) : (
                      <span className="pf-acoes">
                        <button
                          type="button"
                          className="pf-btn pf-btn-mini"
                          onClick={() => {
                            setErroForm('');
                            setForm({
                              id: a.id,
                              title: a.title,
                              body: a.body,
                              kind: a.kind,
                              audience: a.audience,
                              startsAt: paraCampo(a.startsAt),
                              endsAt: paraCampo(a.endsAt),
                            });
                          }}
                        >
                          Editar
                        </button>
                        {st.label === 'No ar' && (
                          <button type="button" className="pf-btn pf-btn-mini" onClick={() => void encerrarAgora(a)}>
                            Encerrar
                          </button>
                        )}
                        <button type="button" className="pf-btn pf-btn-mini pf-btn-perigo" onClick={() => setExcluindo(a.id)}>
                          Excluir
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="module-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && !salvando && setForm(null)}>
          <form className="module-modal" onSubmit={salvar} role="dialog" aria-modal="true" aria-labelledby="pf-aviso-titulo">
            <h2 id="pf-aviso-titulo">{form.id ? 'Editar aviso' : 'Novo aviso'}</h2>
            <div className="form-group">
              <label htmlFor="pf-aviso-title">Título</label>
              <input id="pf-aviso-title" value={form.title} maxLength={120} onChange={(e) => set('title', e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="pf-aviso-body">Texto</label>
              <textarea id="pf-aviso-body" rows={4} maxLength={1000} value={form.body} onChange={(e) => set('body', e.target.value)} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="pf-aviso-kind">Tipo</label>
                <select id="pf-aviso-kind" value={form.kind} onChange={(e) => set('kind', e.target.value as Kind)}>
                  {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="pf-aviso-aud">Para quem</label>
                <select id="pf-aviso-aud" value={form.audience} onChange={(e) => set('audience', e.target.value as Audience)}>
                  {(Object.keys(AUDIENCE_LABEL) as Audience[]).map((k) => (
                    <option key={k} value={k}>
                      {AUDIENCE_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="pf-aviso-ini">Início</label>
                <input id="pf-aviso-ini" type="datetime-local" value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="pf-aviso-fim">Fim (opcional)</label>
                <input id="pf-aviso-fim" type="datetime-local" value={form.endsAt} onChange={(e) => set('endsAt', e.target.value)} />
              </div>
            </div>
            {erroForm && <p className="pf-erro">{erroForm}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setForm(null)} disabled={salvando}>
                Cancelar
              </button>
              <button type="submit" className="btn-submit" disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar aviso'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default AnnouncementsPage;
