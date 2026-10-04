import { useMemo, useState } from 'react';
import { GraphModel } from '../model/GraphModel';
import type { UiState } from '../state/useHashState';
import { Loc, NodeLink } from './DetailPanel';

interface Props {
  model: GraphModel;
  state: UiState;
  update: (patch: Partial<UiState>) => void;
}

const LEVELS = ['error', 'warn', 'info'] as const;

export function IssuesView({ model, state, update }: Props) {
  const [levels, setLevels] = useState<Set<string>>(new Set(LEVELS));
  const [code, setCode] = useState<string>('');
  const q = state.q.trim().toLowerCase();
  const codes = useMemo(() => [...new Set(model.graph.issues.map((i) => i.code))].sort(), [model]);

  const rows = useMemo(
    () =>
      model.graph.issues.filter((i) => {
        if (!levels.has(i.level)) return false;
        if (code && i.code !== code) return false;
        if (q && ![i.code, i.message, i.service, i.location?.file].some((v) => v?.toLowerCase().includes(q))) return false;
        return true;
      }),
    [model, levels, code, q],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { error: 0, warn: 0, info: 0 };
    for (const i of model.graph.issues) c[i.level] = (c[i.level] ?? 0) + 1;
    return c;
  }, [model]);

  return (
    <div className="table-view">
      <div className="table-head">
        <h2>Issues</h2>
        <span className="muted">
          {rows.length} of {model.graph.issues.length}
        </span>
        <div className="chips">
          {LEVELS.map((l) => (
            <button
              key={l}
              className={`chip level-${l} ${levels.has(l) ? 'is-on' : ''}`}
              onClick={() =>
                setLevels((s) => {
                  const n = new Set(s);
                  if (n.has(l)) n.delete(l);
                  else n.add(l);
                  return n;
                })
              }
            >
              {l} <span className="count">{counts[l]}</span>
            </button>
          ))}
          <select className="select" value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="">all codes</option>
            {codes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Level</th>
              <th>Code</th>
              <th>Service</th>
              <th>Message</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i, idx) => (
              <tr key={idx}>
                <td>
                  <span className={`badge badge-level level-${i.level}`}>{i.level}</span>
                </td>
                <td>
                  <code>{i.code}</code>
                </td>
                <td>{i.service ? <NodeLink id={i.service} model={model} update={update} /> : <span className="muted">—</span>}</td>
                <td>{i.message}</td>
                <td>
                  <Loc loc={i.location} repo={i.service ? model.service(i.service)?.repo : undefined} />
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="muted pad">
                  {model.graph.issues.length ? 'No issues match the current filters.' : 'No issues. Nice.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
