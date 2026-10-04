import { useMemo, useState } from 'react';
import type { Flow } from '@codegraph/schema';
import { GraphModel, LAYER_LABEL, refLabel } from '../model/GraphModel';
import { deriveFlow } from '../model/flowDerive';
import type { UiState } from '../state/useHashState';
import { SequenceDiagram } from './SequenceDiagram';
import { ServiceMap } from './ServiceMap';
import { NodeLink } from './DetailPanel';

interface Props {
  model: GraphModel;
  state: UiState;
  update: (patch: Partial<UiState>) => void;
}

export function FlowsView({ model, state, update }: Props) {
  const q = state.q.trim().toLowerCase();
  const flows = useMemo(() => {
    const list = model.graph.flows;
    if (!q) return list;
    return list.filter((f) => [f.name, f.useCase, f.description, f.entry.service, f.entry.ref, ...f.steps.map((s) => s.service)].some((v) => v?.toLowerCase().includes(q)));
  }, [model, q]);
  const selected = state.flow ? model.graph.flows.find((f) => f.id === state.flow) : undefined;

  return (
    <div className="flows">
      <aside className="flows-list">
        <div className="table-head">
          <h2>Flows</h2>
          <span className="muted">
            {flows.length} of {model.graph.flows.length}
          </span>
        </div>
        <ul className="list">
          {flows.map((f) => {
            const services = new Set(f.steps.map((s) => s.service));
            return (
              <li key={f.id} className={`row clickable ${selected?.id === f.id ? 'is-active' : ''}`} onClick={() => update({ flow: f.id })}>
                <div className="row-main">
                  <b>{f.name}</b>
                </div>
                {f.useCase && <div className="row-sub">{f.useCase}</div>}
                <div className="row-sub muted">
                  {f.entry.kind} · <code>{refLabel(f.entry.ref)}</code> · {f.steps.length} steps · {services.size} services
                </div>
              </li>
            );
          })}
          {!flows.length && <li className="row muted">No flows{q ? ` match “${state.q}”` : ' in this graph'}.</li>}
        </ul>
      </aside>
      <section className="flows-detail">
        {selected ? <FlowDetail key={selected.id} model={model} flow={selected} state={state} update={update} /> : <div className="panel-empty"><p>Select a flow to see its sequence and service path.</p></div>}
      </section>
    </div>
  );
}

function FlowDetail({ model, flow, state, update }: Props & { flow: Flow }) {
  const derived = useMemo(() => deriveFlow(model, flow), [model, flow]);
  const [step, setStep] = useState<number | undefined>(undefined);
  const mapState = useMemo<UiState>(() => ({ ...state, sel: undefined, ep: undefined, focus: false, q: '', layers: [], owners: [], kinds: [], statuses: [], hideExt: false, hideTopics: false }), [state]);
  const highlight = useMemo(() => ({ nodeSteps: derived.nodeSteps, edgeSteps: derived.edgeSteps, edgeLabels: derived.edgeLabels }), [derived]);
  const services = [...new Set(flow.steps.map((s) => s.service))];

  return (
    <div className="flow-detail">
      <header className="flow-head">
        <h2>{flow.name}</h2>
        {flow.useCase && <p className="flow-usecase">{flow.useCase}</p>}
        {flow.description && <p className="panel-desc">{flow.description}</p>}
        <div className="flow-meta">
          <span>
            Entry: <code>{flow.entry.kind}</code> <NodeLink id={flow.entry.service} model={model} update={update} /> <code>{refLabel(flow.entry.ref)}</code>
          </span>
          <span className="muted">
            {flow.steps.length} steps · {services.length} services
          </span>
        </div>
        <div className="chips">
          {services.map((s) => {
            const svc = model.service(s);
            return (
              <button key={s} className={`chip layer-${svc?.layer ?? 'unknown'}`} onClick={() => update({ view: 'map', sel: s })} title={svc ? LAYER_LABEL[svc.layer] : ''}>
                {svc?.name ?? s}
              </button>
            );
          })}
        </div>
      </header>

      <h3 className="section">Sequence</h3>
      <SequenceDiagram derived={derived} selectedStep={step} onSelectStep={(n) => setStep(step === n ? undefined : n)} />

      <h3 className="section">Service path</h3>
      <div className="flow-map">
        <ServiceMap model={model} state={mapState} update={update} subset={derived.subset} highlight={highlight} compact fitKey={flow.id} />
      </div>

      <h3 className="section">Steps</h3>
      <ol className="steps">
        {flow.steps.map((s, i) => {
          const svc = model.service(s.service);
          return (
            <li key={i} className={`step ${step === i + 1 ? 'is-active' : ''}`} onClick={() => setStep(step === i + 1 ? undefined : i + 1)}>
              <span className="step-pill inline">{i + 1}</span>
              <span className={`badge badge-kind kind-${s.kind}`}>{s.kind}</span>
              <span className={`dot layer-${svc?.layer ?? 'unknown'}`} /> <b>{svc?.name ?? s.service}</b>
              <code className="path">{s.kind === 'consumer' && s.from ? refLabel(s.from) : refLabel(s.ref)}</code>
              {s.description && <span className="muted">{s.description}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
