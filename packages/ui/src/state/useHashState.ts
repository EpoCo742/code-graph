import { useCallback, useEffect, useMemo, useState } from 'react';

export type View = 'map' | 'endpoints' | 'flows' | 'issues';

export interface UiState {
  view: View;
  /** Selected node or edge id. */
  sel?: string;
  /** Selected endpoint id (within the detail panel). */
  ep?: string;
  /** Selected flow id. */
  flow?: string;
  q: string;
  layers: string[];
  owners: string[];
  kinds: string[];
  statuses: string[];
  hideExt: boolean;
  hideTopics: boolean;
  up: number;
  down: number;
  focus: boolean;
  theme?: 'light' | 'dark';
}

const DEFAULT: UiState = {
  view: 'map',
  q: '',
  layers: [],
  owners: [],
  kinds: [],
  statuses: [],
  hideExt: false,
  hideTopics: false,
  up: 1,
  down: 1,
  focus: false,
};

function parse(hash: string): UiState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const list = (k: string) => (p.get(k) ? p.get(k)!.split(',').filter(Boolean) : []);
  const num = (k: string, d: number) => {
    const v = Number(p.get(k));
    return Number.isFinite(v) && p.has(k) ? v : d;
  };
  const view = p.get('view') as View | null;
  return {
    view: view && ['map', 'endpoints', 'flows', 'issues'].includes(view) ? view : 'map',
    sel: p.get('sel') ?? undefined,
    ep: p.get('ep') ?? undefined,
    flow: p.get('flow') ?? undefined,
    q: p.get('q') ?? '',
    layers: list('layers'),
    owners: list('owners'),
    kinds: list('kinds'),
    statuses: list('statuses'),
    hideExt: p.get('hideExt') === '1',
    hideTopics: p.get('hideTopics') === '1',
    up: num('up', 1),
    down: num('down', 1),
    focus: p.get('focus') === '1',
    theme: (p.get('theme') as 'light' | 'dark' | null) ?? undefined,
  };
}

function serialize(s: UiState): string {
  const p = new URLSearchParams();
  if (s.view !== 'map') p.set('view', s.view);
  if (s.sel) p.set('sel', s.sel);
  if (s.ep) p.set('ep', s.ep);
  if (s.flow) p.set('flow', s.flow);
  if (s.q) p.set('q', s.q);
  if (s.layers.length) p.set('layers', s.layers.join(','));
  if (s.owners.length) p.set('owners', s.owners.join(','));
  if (s.kinds.length) p.set('kinds', s.kinds.join(','));
  if (s.statuses.length) p.set('statuses', s.statuses.join(','));
  if (s.hideExt) p.set('hideExt', '1');
  if (s.hideTopics) p.set('hideTopics', '1');
  if (s.up !== 1) p.set('up', String(s.up));
  if (s.down !== 1) p.set('down', String(s.down));
  if (s.focus) p.set('focus', '1');
  if (s.theme) p.set('theme', s.theme);
  const str = p.toString();
  return str ? '#' + str : '';
}

export function useHashState(): [UiState, (patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)) => void] {
  const [state, setState] = useState<UiState>(() => ({ ...DEFAULT, ...parse(window.location.hash) }));

  useEffect(() => {
    const onHash = () => setState((prev) => {
      const next = { ...DEFAULT, ...parse(window.location.hash) };
      return serialize(next) === serialize(prev) ? prev : next;
    });
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const next = serialize(state);
    if (next !== window.location.hash) history.replaceState(null, '', next || window.location.pathname + window.location.search);
  }, [state]);

  const update = useCallback((patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)) => {
    setState((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }));
  }, []);

  return [useMemo(() => state, [state]), update];
}
