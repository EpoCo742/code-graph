import { useMemo, useState } from 'react';
import type { EndpointNode, GraphEdge, ServiceNode, SourceLocation, TopicNode } from '@codegraph/schema';
import { GraphModel, LAYER_LABEL, bareHandler, endpointPath, refLabel, sourceLink } from '../model/GraphModel';
import type { UiState } from '../state/useHashState';

interface Props {
  model: GraphModel;
  state: UiState;
  update: (patch: Partial<UiState>) => void;
}

export function Loc({ loc, repo }: { loc?: SourceLocation; repo?: string }) {
  if (!loc) return null;
  const href = sourceLink(repo, loc.file, loc.line);
  const text = `${loc.file}:${loc.line}`;
  return href ? (
    <a className="loc" href={href} target="_blank" rel="noreferrer" title="Open in repository">
      {text}
    </a>
  ) : (
    <span className="loc">{text}</span>
  );
}

export function MethodBadge({ method }: { method: string }) {
  return <span className={`badge badge-method m-${method.toLowerCase()}`}>{method}</span>;
}

function Confidence({ value }: { value: number }) {
  const cls = value >= 0.8 ? 'hi' : value >= 0.6 ? 'mid' : 'low';
  return (
    <span className={`conf conf-${cls}`} title={`confidence ${value.toFixed(2)}`}>
      {Math.round(value * 100)}%
    </span>
  );
}

export function DetailPanel({ model, state, update }: Props) {
  const sel = state.sel;
  if (!sel) return <EmptyPanel />;
  const svc = model.service(sel);
  if (svc) return <ServiceDetail model={model} svc={svc} state={state} update={update} />;
  const topic = model.topic(sel);
  if (topic) return <TopicDetail model={model} topic={topic} update={update} />;
  const edge = model.edges.get(sel);
  if (edge) return <EdgeDetail model={model} edge={edge} update={update} />;
  return <EmptyPanel />;
}

function EmptyPanel() {
  return (
    <div className="panel-empty">
      <p>Select a service, topic or edge to see its details.</p>
      <p className="hint">Click a node to highlight its neighbours. Double-click to focus on its blast radius.</p>
    </div>
  );
}

type Tab = 'endpoints' | 'consumers' | 'calls' | 'publishes' | 'flows' | 'issues';

function ServiceDetail({ model, svc, state, update }: Props & { svc: ServiceNode }) {
  const endpoints = model.endpointsByService.get(svc.id) ?? [];
  const consumers = model.in(svc.id).filter((e) => e.kind === 'consume');
  const calls = model.out(svc.id).filter((e) => e.kind === 'http' || e.kind === 'declared');
  const publishes = model.out(svc.id).filter((e) => e.kind === 'publish');
  const inbound = model.in(svc.id).filter((e) => e.kind === 'http' || e.kind === 'declared');
  const issues = model.issuesByService.get(svc.id) ?? [];
  const flows = model.flowsForService(svc.id);
  const [tab, setTab] = useState<Tab>(endpoints.length ? 'endpoints' : consumers.length ? 'consumers' : 'calls');
  const selectedEp = state.ep ? model.endpoint(state.ep) : undefined;

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'endpoints', label: 'Endpoints', count: endpoints.length },
    { id: 'consumers', label: 'Consumers', count: consumers.length },
    { id: 'calls', label: 'Calls', count: calls.length },
    { id: 'publishes', label: 'Publishes', count: publishes.length },
    { id: 'flows', label: 'Flows', count: flows.length },
    { id: 'issues', label: 'Issues', count: issues.length },
  ];

  return (
    <div className="panel">
      <header className="panel-head">
        <div className="panel-title-row">
          <h2>{svc.name}</h2>
          <span className={`badge badge-layer layer-${svc.layer}`}>{LAYER_LABEL[svc.layer]}</span>
        </div>
        <div className="panel-sub">
          <code>{svc.id}</code>
          {svc.inferred && <span className="badge badge-muted">inferred</span>}
        </div>
        {svc.description && <p className="panel-desc">{svc.description}</p>}
        <dl className="kv">
          {svc.owner && (
            <>
              <dt>Owner</dt>
              <dd>{svc.owner}</dd>
            </>
          )}
          {svc.repo && (
            <>
              <dt>Repo</dt>
              <dd>
                <a href={svc.repo} target="_blank" rel="noreferrer">
                  {svc.repo.replace(/^https?:\/\//, '')}
                </a>
              </dd>
            </>
          )}
          {svc.language && (
            <>
              <dt>Language</dt>
              <dd>{svc.language}</dd>
            </>
          )}
          {svc.frameworks?.length ? (
            <>
              <dt>Frameworks</dt>
              <dd>{svc.frameworks.join(', ')}</dd>
            </>
          ) : null}
          {svc.tags?.length ? (
            <>
              <dt>Tags</dt>
              <dd className="tags">
                {svc.tags.map((t) => (
                  <span key={t} className="badge badge-muted">
                    {t}
                  </span>
                ))}
              </dd>
            </>
          ) : null}
          <dt>Called by</dt>
          <dd>{inbound.length ? [...new Set(inbound.map((e) => e.source))].map((s) => <NodeLink key={s} id={s} model={model} update={update} />) : <span className="muted">nothing</span>}</dd>
        </dl>
        <div className="radius">
          <label>
            Upstream
            <input type="range" min={0} max={4} value={state.up} onChange={(e) => update({ up: Number(e.target.value) })} />
            <b>{state.up}</b>
          </label>
          <label>
            Downstream
            <input type="range" min={0} max={4} value={state.down} onChange={(e) => update({ down: Number(e.target.value) })} />
            <b>{state.down}</b>
          </label>
          <button className={`btn ${state.focus ? 'is-on' : ''}`} onClick={() => update({ focus: !state.focus, view: 'map' })}>
            {state.focus ? 'Unfocus' : 'Focus'}
          </button>
        </div>
      </header>

      <nav className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'is-active' : ''}`} onClick={() => setTab(t.id)} disabled={!t.count}>
            {t.label} <span className="count">{t.count}</span>
          </button>
        ))}
      </nav>

      <div className="panel-body">
        {tab === 'endpoints' && (
          <ul className="list">
            {endpoints.map((ep) => (
              <li key={ep.id} className={`row clickable ${selectedEp?.id === ep.id ? 'is-active' : ''}`} onClick={() => update({ ep: selectedEp?.id === ep.id ? undefined : ep.id })}>
                <div className="row-main">
                  <MethodBadge method={ep.method} />
                  <code className="path">{ep.path}</code>
                </div>
                {ep.summary && <div className="row-sub">{ep.summary}</div>}
                {selectedEp?.id === ep.id && <EndpointImpact model={model} ep={ep} update={update} />}
              </li>
            ))}
          </ul>
        )}
        {tab === 'consumers' && (
          <ul className="list">
            {consumers.map((e) => {
              const t = model.topic(e.source);
              return (
                <li key={e.id} className="row">
                  <div className="row-main">
                    <span className={`badge badge-broker broker-${t?.broker ?? 'unknown'}`}>{t?.broker}</span>
                    <NodeLink id={e.source} model={model} update={update} />
                    {e.routingKey && <code className="muted">{e.routingKey}</code>}
                  </div>
                  <div className="row-sub">
                    handler <code>{bareHandler(svc.id, e.fromHandler)}</code> <Loc loc={e.location} repo={svc.repo} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {tab === 'calls' && <CallList model={model} edges={calls} repo={svc.repo} service={svc.id} update={update} />}
        {tab === 'publishes' && (
          <ul className="list">
            {publishes.map((e) => {
              const t = model.topic(e.target);
              return (
                <li key={e.id} className="row">
                  <div className="row-main">
                    <span className={`badge badge-broker broker-${t?.broker ?? 'unknown'}`}>{t?.broker}</span>
                    <NodeLink id={e.target} model={model} update={update} />
                    {e.routingKey && <code className="muted">{e.routingKey}</code>}
                  </div>
                  <div className="row-sub">
                    from <code>{bareHandler(svc.id, e.fromHandler)}</code> <Loc loc={e.location} repo={svc.repo} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {tab === 'flows' && (
          <ul className="list">
            {flows.map((f) => (
              <li key={f.id} className="row clickable" onClick={() => update({ view: 'flows', flow: f.id })}>
                <div className="row-main">
                  <b>{f.name}</b>
                </div>
                {f.useCase && <div className="row-sub">{f.useCase}</div>}
              </li>
            ))}
          </ul>
        )}
        {tab === 'issues' && (
          <ul className="list">
            {issues.map((i, idx) => (
              <li key={idx} className="row">
                <div className="row-main">
                  <span className={`badge badge-level level-${i.level}`}>{i.level}</span>
                  <code>{i.code}</code>
                </div>
                <div className="row-sub">
                  {i.message} <Loc loc={i.location} repo={svc.repo} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CallList({ model, edges, repo, service, update }: { model: GraphModel; edges: GraphEdge[]; repo?: string; service: string; update: Props['update'] }) {
  if (!edges.length) return <p className="muted pad">No outbound calls.</p>;
  return (
    <ul className="list">
      {edges.map((e) => {
        const details = model.detailEdges(service, e.target);
        return (
          <li key={e.id} className="row clickable" onClick={() => update({ sel: e.id })}>
            <div className="row-main">
              {e.method && <MethodBadge method={e.method} />}
              <NodeLink id={e.target} model={model} update={update} />
              {e.endpoint && <code className="path">{endpointPath(e.endpoint)}</code>}
              <Confidence value={e.confidence} />
            </div>
            <div className="row-sub">
              {e.url && <code className="muted">{e.url}</code>}
              {e.fromHandler && (
                <>
                  {' '}
                  from <code>{bareHandler(service, e.fromHandler)}</code>
                </>
              )}{' '}
              {e.resolution && <span className="badge badge-muted">{e.resolution}</span>} <span className={`badge badge-status status-${e.status}`}>{e.status}</span> <Loc loc={e.location} repo={repo} />
            </div>
            {details.length > 0 && (
              <ul className="sublist">
                {details.map((d) => (
                  <li
                    key={d.id}
                    className="clickable"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      update({ sel: d.id });
                    }}
                  >
                    {d.method && <MethodBadge method={d.method} />}
                    <code className="path">{d.endpoint ? endpointPath(d.endpoint) : d.url}</code>
                    <span className="muted">from</span> <code>{bareHandler(service, d.fromHandler ?? d.source)}</code>
                    <Loc loc={d.location} repo={repo} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function EndpointImpact({ model, ep, update }: { model: GraphModel; ep: EndpointNode; update: Props['update'] }) {
  const impact = useMemo(() => model.endpointImpact(ep), [model, ep]);
  const svc = model.service(ep.service);
  const flow = model.flowForEndpointNode(ep.id);
  // Prefer handler-level detail edges; keep a service-level http edge only when no detail edge covers that target.
  const detailTargets = new Set(impact.outbound.filter((e) => e.kind === 'http-detail').map((e) => model.targetService(e)));
  const outbound = impact.outbound.filter((e) => e.kind !== 'http' || !detailTargets.has(e.target));
  return (
    <div className="impact">
      <div className="row-sub">
        handler <code>{ep.handler}</code> <Loc loc={ep.location} repo={svc?.repo} />
      </div>
      <div className="row-sub">
        reaches {impact.handlers.size} handler{impact.handlers.size === 1 ? '' : 's'}: <span className="muted">{[...impact.handlers].join(', ')}</span>
      </div>
      {outbound.length ? (
        <ul className="sublist">
          {outbound.map((e) => (
            <li key={e.id} onClick={(ev) => { ev.stopPropagation(); update({ sel: e.id }); }} className="clickable">
              {e.kind === 'publish' ? <span className="badge badge-broker">pub</span> : e.method ? <MethodBadge method={e.method} /> : <span className="badge badge-muted">call</span>}
              <NodeLink id={e.kind === 'http-detail' ? model.targetService(e) : e.target} model={model} update={update} />
              {e.endpoint && <code className="path">{endpointPath(e.endpoint)}</code>}
              {!e.endpoint && e.url && <code className="muted">{e.url}</code>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="row-sub muted">No outbound calls from this endpoint.</div>
      )}
      {flow && (
        <button className="btn small" onClick={(ev) => { ev.stopPropagation(); update({ view: 'flows', flow: flow.id }); }}>
          Open flow “{flow.name}”
        </button>
      )}
    </div>
  );
}

export function NodeLink({ id, model, update }: { id: string; model: GraphModel; update: Props['update'] }) {
  const n = model.nodes.get(id);
  const label = n?.kind === 'service' ? n.name : n?.kind === 'topic' ? n.name : id;
  return (
    <button
      className={`link ${n?.kind === 'topic' ? 'link-topic' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        update({ sel: id, ep: undefined, view: 'map' });
      }}
    >
      {label}
    </button>
  );
}

function TopicDetail({ model, topic, update }: { model: GraphModel; topic: TopicNode; update: Props['update'] }) {
  const pubs = model.in(topic.id).filter((e) => e.kind === 'publish');
  const cons = model.out(topic.id).filter((e) => e.kind === 'consume');
  return (
    <div className="panel">
      <header className="panel-head">
        <div className="panel-title-row">
          <h2>{topic.name}</h2>
          <span className={`badge badge-broker broker-${topic.broker}`}>{topic.broker}</span>
        </div>
        <div className="panel-sub">
          <code>{topic.id}</code>
        </div>
      </header>
      <div className="panel-body">
        <h3 className="section">Publishers ({pubs.length})</h3>
        <ul className="list">
          {pubs.map((e) => (
            <li key={e.id} className="row">
              <div className="row-main">
                <NodeLink id={e.source} model={model} update={update} />
                {e.routingKey && <code className="muted">{e.routingKey}</code>}
              </div>
              <div className="row-sub">
                from <code>{bareHandler(e.source, e.fromHandler)}</code> <Loc loc={e.location} repo={model.service(e.source)?.repo} />
              </div>
            </li>
          ))}
          {!pubs.length && <li className="row muted">No known publishers.</li>}
        </ul>
        <h3 className="section">Consumers ({cons.length})</h3>
        <ul className="list">
          {cons.map((e) => (
            <li key={e.id} className="row">
              <div className="row-main">
                <NodeLink id={e.target} model={model} update={update} />
                {e.routingKey && <code className="muted">{e.routingKey}</code>}
              </div>
              <div className="row-sub">
                handler <code>{bareHandler(e.target, e.fromHandler)}</code> <Loc loc={e.location} repo={model.service(e.target)?.repo} />
              </div>
            </li>
          ))}
          {!cons.length && <li className="row muted">No known consumers.</li>}
        </ul>
      </div>
    </div>
  );
}

function EdgeDetail({ model, edge, update }: { model: GraphModel; edge: GraphEdge; update: Props['update'] }) {
  const src = model.nodes.get(edge.source);
  const srcService = src?.kind === 'service' ? src.id : src?.kind === 'handler' || src?.kind === 'endpoint' ? src.service : edge.source;
  const tgtService = edge.kind === 'http-detail' ? model.targetService(edge) : edge.target;
  const repo = model.service(srcService)?.repo;
  return (
    <div className="panel">
      <header className="panel-head">
        <div className="panel-title-row">
          <h2>
            <NodeLink id={srcService} model={model} update={update} /> <span className="arrow">→</span> <NodeLink id={tgtService} model={model} update={update} />
          </h2>
        </div>
        <div className="panel-sub">
          <span className={`badge badge-kind kind-${edge.kind}`}>{edge.kind}</span> <span className={`badge badge-status status-${edge.status}`}>{edge.status}</span> <Confidence value={edge.confidence} />
        </div>
      </header>
      <div className="panel-body">
        <dl className="kv">
          {edge.method && (
            <>
              <dt>Method</dt>
              <dd>
                <MethodBadge method={edge.method} />
              </dd>
            </>
          )}
          {edge.url && (
            <>
              <dt>URL</dt>
              <dd>
                <code>{edge.url}</code>
              </dd>
            </>
          )}
          {edge.endpoint && (
            <>
              <dt>Endpoint</dt>
              <dd>
                <code>{refLabel(edge.endpoint)}</code>
              </dd>
            </>
          )}
          {edge.routingKey && (
            <>
              <dt>Routing key</dt>
              <dd>
                <code>{edge.routingKey}</code>
              </dd>
            </>
          )}
          {edge.fromHandler && (
            <>
              <dt>From handler</dt>
              <dd>
                <code>{bareHandler(srcService, edge.fromHandler)}</code>
              </dd>
            </>
          )}
          {edge.resolution && (
            <>
              <dt>Resolution</dt>
              <dd>{edge.resolution}</dd>
            </>
          )}
          {edge.location && (
            <>
              <dt>Source</dt>
              <dd>
                <Loc loc={edge.location} repo={repo} />
              </dd>
            </>
          )}
          <dt>Edge id</dt>
          <dd>
            <code className="muted">{edge.id}</code>
          </dd>
        </dl>
      </div>
    </div>
  );
}
