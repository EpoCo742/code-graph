import { useMemo, useState } from 'react';
import type { EndpointNode } from '@codegraph/schema';
import { GraphModel, LAYER_LABEL } from '../model/GraphModel';
import type { UiState } from '../state/useHashState';
import { MethodBadge } from './DetailPanel';

interface Props {
  model: GraphModel;
  state: UiState;
  update: (patch: Partial<UiState>) => void;
}

type SortKey = 'service' | 'method' | 'path' | 'handler' | 'downstream';

interface Row {
  ep: EndpointNode;
  serviceName: string;
  layer: string;
  downstream: number;
  hasFlow: boolean;
}

export function EndpointsView({ model, state, update }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'service', dir: 1 });
  const q = state.q.trim().toLowerCase();

  const rows = useMemo<Row[]>(
    () =>
      model.endpoints.map((ep) => {
        const svc = model.service(ep.service);
        const impact = model.endpointImpact(ep);
        return {
          ep,
          serviceName: svc?.name ?? ep.service,
          layer: svc?.layer ?? 'unknown',
          downstream: new Set(impact.outbound.filter((e) => e.kind !== 'http').map((e) => (e.kind === 'http-detail' ? model.targetService(e) : e.target))).size,
          hasFlow: !!model.flowForEndpointNode(ep.id),
        };
      }),
    [model],
  );

  const filtered = useMemo(() => {
    const list = q
      ? rows.filter((r) => [r.serviceName, r.ep.service, r.ep.method, r.ep.path, r.ep.handler, r.ep.summary].some((v) => v?.toLowerCase().includes(q)))
      : rows.slice();
    const cmp = (a: Row, b: Row) => {
      switch (sort.key) {
        case 'service':
          return a.serviceName.localeCompare(b.serviceName) || a.ep.path.localeCompare(b.ep.path);
        case 'method':
          return a.ep.method.localeCompare(b.ep.method);
        case 'path':
          return a.ep.path.localeCompare(b.ep.path);
        case 'handler':
          return a.ep.handler.localeCompare(b.ep.handler);
        case 'downstream':
          return a.downstream - b.downstream;
      }
    };
    return list.sort((a, b) => cmp(a, b) * sort.dir);
  }, [rows, q, sort]);

  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  const Th = ({ k, children }: { k: SortKey; children: string }) => (
    <th className={sort.key === k ? 'is-sorted' : ''} onClick={() => toggle(k)}>
      {children}
      {sort.key === k && <span className="sort-ind">{sort.dir === 1 ? '▲' : '▼'}</span>}
    </th>
  );

  const open = (r: Row) => {
    const flow = model.flowForEndpointNode(r.ep.id);
    if (flow) update({ view: 'flows', flow: flow.id, sel: undefined });
    else update({ view: 'map', sel: r.ep.service, ep: r.ep.id, focus: true });
  };

  return (
    <div className="table-view">
      <div className="table-head">
        <h2>Endpoints</h2>
        <span className="muted">
          {filtered.length} of {rows.length}
        </span>
      </div>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <Th k="service">Service</Th>
              <Th k="method">Method</Th>
              <Th k="path">Path</Th>
              <Th k="handler">Handler</Th>
              <th>Summary</th>
              <Th k="downstream">Downstream</Th>
              <th>Flow</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.ep.id} className="clickable" onClick={() => open(r)}>
                <td>
                  <span className={`dot layer-${r.layer}`} title={LAYER_LABEL[r.layer as never]} /> {r.serviceName}
                </td>
                <td>
                  <MethodBadge method={r.ep.method} />
                </td>
                <td>
                  <code className="path">{r.ep.path}</code>
                </td>
                <td>
                  <code className="muted">{r.ep.handler}</code>
                </td>
                <td className="muted">{r.ep.summary ?? ''}</td>
                <td className="num">{r.downstream}</td>
                <td>{r.hasFlow ? <span className="badge badge-muted">flow</span> : ''}</td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={7} className="muted pad">
                  No endpoints match “{state.q}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
