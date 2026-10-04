import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GraphModel, LAYER_LABEL, LAYER_ORDER } from './model/GraphModel';
import { loadInitialGraph, readGraphFile, type LoadState } from './model/loadGraph';
import { useHashState, type UiState, type View } from './state/useHashState';
import { ServiceMap } from './views/ServiceMap';
import { DetailPanel } from './views/DetailPanel';
import { EndpointsView } from './views/EndpointsView';
import { FlowsView } from './views/FlowsView';
import { IssuesView } from './views/IssuesView';

const VIEWS: { id: View; label: string }[] = [
  { id: 'map', label: 'Service map' },
  { id: 'endpoints', label: 'Endpoints' },
  { id: 'flows', label: 'Flows' },
  { id: 'issues', label: 'Issues' },
];

const EDGE_KINDS = ['http', 'publish', 'consume', 'declared'] as const;
const STATUSES = ['declared', 'observed', 'both'] as const;

type Theme = 'light' | 'dark';

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('codegraph.theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      /* ignore */
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('codegraph.theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

export function App() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [state, update] = useHashState();
  const [theme, toggleTheme] = useTheme();
  const [dragging, setDragging] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadInitialGraph().then(setLoad);
  }, []);

  const model = useMemo(() => (load.status === 'ready' ? new GraphModel(load.graph) : undefined), [load]);

  const acceptFile = useCallback(async (file: File) => {
    try {
      const graph = await readGraphFile(file);
      setLoad({ status: 'ready', graph, source: file.name });
    } catch (e) {
      setLoad({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === 'Escape') {
        if (typing && target === searchRef.current && state.q) update({ q: '' });
        else update({ sel: undefined, ep: undefined, focus: false });
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.q, update]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void acceptFile(file);
    },
    [acceptFile],
  );

  return (
    <div
      className={`app ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <span>Code Graph</span>
        </div>
        <nav className="nav">
          {VIEWS.map((v) => (
            <button key={v.id} className={`nav-item ${state.view === v.id ? 'is-active' : ''}`} onClick={() => update({ view: v.id })}>
              {v.label}
              {v.id === 'issues' && model && model.graph.issues.length > 0 && <span className="count">{model.graph.issues.length}</span>}
            </button>
          ))}
        </nav>
        <div className="search">
          <input ref={searchRef} type="search" placeholder="Search services, endpoints, topics…  ( / )" value={state.q} onChange={(e) => update({ q: e.target.value })} />
        </div>
        <div className="topbar-right">
          {load.status === 'ready' && (
            <span className="source muted" title={`Generated ${load.graph.generatedAt}`}>
              {load.source}
            </span>
          )}
          <button className="btn ghost" onClick={() => fileRef.current?.click()} title="Load a graph.json from disk">
            Load…
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && acceptFile(e.target.files[0])} />
          <button className="btn ghost" onClick={toggleTheme} title="Toggle theme">
            {theme === 'dark' ? '☀︎' : '☾'}
          </button>
        </div>
      </header>

      {load.status === 'loading' && <Centered>Loading graph…</Centered>}
      {load.status === 'empty' && <EmptyState reason={load.reason} />}
      {load.status === 'error' && (
        <Centered>
          <h2>Could not load the graph</h2>
          <p className="muted">{load.message}</p>
          <p className="hint">Drop a graph.json here, or use Load…</p>
        </Centered>
      )}
      {model && state.view === 'map' && <MapScreen model={model} state={state} update={update} />}
      {model && state.view === 'endpoints' && <EndpointsView model={model} state={state} update={update} />}
      {model && state.view === 'flows' && <FlowsView model={model} state={state} update={update} />}
      {model && state.view === 'issues' && <IssuesView model={model} state={state} update={update} />}

      {dragging && <div className="drop-overlay">Drop graph.json to load it</div>}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="centered">{children}</div>;
}

function EmptyState({ reason }: { reason: string }) {
  return (
    <Centered>
      <h2>No graph yet</h2>
      <p className="muted">{reason}</p>
      <p>Generate one from the sample estate:</p>
      <pre className="code">pnpm run build{'\n'}pnpm run extract:samples{'\n'}pnpm run aggregate:samples</pre>
      <p className="hint">
        The aggregator writes <code>packages/ui/public/graph.json</code>. You can also drop a graph.json here, or open <a href="?demo=1">?demo=1</a> for a built-in demo.
      </p>
    </Centered>
  );
}

function MapScreen({ model, state, update }: { model: GraphModel; state: UiState; update: (p: Partial<UiState>) => void }) {
  const stats = useMemo(() => model.stats(), [model]);
  const toggleIn = (key: 'layers' | 'owners' | 'kinds' | 'statuses', value: string) =>
    update({ [key]: state[key].includes(value) ? state[key].filter((v) => v !== value) : [...state[key], value] } as Partial<UiState>);
  const anyFilter = state.layers.length || state.owners.length || state.kinds.length || state.statuses.length || state.hideExt || state.hideTopics || state.focus;
  const presentLayers = LAYER_ORDER.filter((l) => model.services.some((s) => s.layer === l));

  return (
    <div className="map-screen">
      <div className="toolbar">
        <div className="stats">
          <Stat label="services" value={stats.services} />
          <Stat label="endpoints" value={stats.endpoints} />
          <Stat label="topics" value={stats.topics} />
          <Stat label="edges" value={stats.edges} />
          <Stat label="unresolved" value={stats.unresolved} warn={stats.unresolved > 0} />
          <Stat label="flows" value={stats.flows} />
        </div>
        <div className="filters">
          <div className="chips" aria-label="Layers">
            {presentLayers.map((l) => (
              <button key={l} className={`chip layer-${l} ${state.layers.includes(l) ? 'is-on' : ''}`} onClick={() => toggleIn('layers', l)}>
                {LAYER_LABEL[l]}
              </button>
            ))}
          </div>
          {model.owners.length > 0 && (
            <div className="chips" aria-label="Owners">
              {model.owners.map((o) => (
                <button key={o} className={`chip ${state.owners.includes(o) ? 'is-on' : ''}`} onClick={() => toggleIn('owners', o)}>
                  {o}
                </button>
              ))}
            </div>
          )}
          <div className="chips" aria-label="Edge kinds">
            {EDGE_KINDS.map((k) => (
              <button key={k} className={`chip kind-${k} ${state.kinds.includes(k) ? 'is-on' : ''}`} onClick={() => toggleIn('kinds', k)}>
                {k}
              </button>
            ))}
          </div>
          <div className="chips" aria-label="Edge status">
            {STATUSES.map((s) => (
              <button key={s} className={`chip ${state.statuses.includes(s) ? 'is-on' : ''}`} onClick={() => toggleIn('statuses', s)}>
                {s}
              </button>
            ))}
          </div>
          <div className="chips">
            <button className={`chip ${state.hideExt ? 'is-on' : ''}`} onClick={() => update({ hideExt: !state.hideExt })}>
              hide externals
            </button>
            <button className={`chip ${state.hideTopics ? 'is-on' : ''}`} onClick={() => update({ hideTopics: !state.hideTopics })}>
              services only
            </button>
            {anyFilter ? (
              <button className="chip reset" onClick={() => update({ layers: [], owners: [], kinds: [], statuses: [], hideExt: false, hideTopics: false, focus: false })}>
                reset
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="map-body">
        <div className="map-canvas">
          <ServiceMap model={model} state={state} update={update} />
          <Legend />
        </div>
        <aside className="side">
          <DetailPanel model={model} state={state} update={update} />
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`stat ${warn ? 'is-warn' : ''}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      <span>
        <i className="lg lg-http" /> HTTP
      </span>
      <span>
        <i className="lg lg-msg" /> messaging
      </span>
      <span>
        <i className="lg lg-observed" /> trace only
      </span>
      <span>
        <i className="lg lg-low" /> low confidence
      </span>
    </div>
  );
}
