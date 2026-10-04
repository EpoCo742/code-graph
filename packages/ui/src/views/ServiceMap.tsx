import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Background, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, MarkerType, type Node, type Edge, type NodeMouseHandler, type EdgeMouseHandler, useStore, getViewportForBounds } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { GraphEdge, GraphNode } from '@codegraph/schema';
import { GraphModel, MAP_EDGE_KINDS } from '../model/GraphModel';
import type { UiState } from '../state/useHashState';
import { layoutServiceMap, type Lane } from '../layout/layout';
import { LaneBackdrop, nodeTypes, type ServiceFlowNode, type TopicFlowNode } from '../components/nodes';
import { edgeTypes, type MapFlowEdge } from '../components/edges';

export interface MapHighlight {
  nodeSteps?: Map<string, number>;
  edgeSteps?: Map<string, number>;
  edgeLabels?: Map<string, string>;
}

interface Props {
  model: GraphModel;
  state: UiState;
  update: (patch: Partial<UiState>) => void;
  /** Restrict to these node ids (flow view). */
  subset?: { nodes: Set<string>; edges: Set<string> };
  highlight?: MapHighlight;
  /** Compact mode hides minimap and lane labels (used inside the flow view). */
  compact?: boolean;
  fitKey?: string;
}

function matches(q: string, model: GraphModel, n: GraphNode): boolean {
  if (!q) return false;
  const needle = q.toLowerCase();
  if (n.kind === 'service') {
    if ([n.id, n.name, n.owner, n.description, ...(n.tags ?? []), ...(n.frameworks ?? [])].some((v) => v?.toLowerCase().includes(needle))) return true;
    return (model.endpointsByService.get(n.id) ?? []).some((e) => e.path.toLowerCase().includes(needle));
  }
  if (n.kind === 'topic') return n.name.toLowerCase().includes(needle) || n.broker.includes(needle);
  return false;
}

/** Compute the visible node/edge set after filters. Exported for the flow view. */
export function visibleGraph(model: GraphModel, state: UiState, subset?: Props['subset']): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const layers = new Set(state.layers);
  const owners = new Set(state.owners);
  const kinds = new Set(state.kinds);
  const statuses = new Set(state.statuses);

  let services = model.services.filter((s) => {
    if (subset && !subset.nodes.has(s.id)) return false;
    if (layers.size && !layers.has(s.layer)) return false;
    if (owners.size && !(s.owner && owners.has(s.owner))) return false;
    if (state.hideExt && s.layer === 'external') return false;
    return true;
  });
  const serviceIds = new Set(services.map((s) => s.id));

  let edges = model.mapEdges().filter((e) => {
    if (subset && !subset.edges.has(e.id)) return false;
    if (kinds.size && !kinds.has(e.kind)) return false;
    if (statuses.size && !statuses.has(e.status)) return false;
    return true;
  });

  let topics = state.hideTopics ? [] : model.topics.filter((t) => !subset || subset.nodes.has(t.id));
  if (state.hideTopics) {
    // Collapse publish → topic → consume into direct dashed service edges.
    const pubs = edges.filter((e) => e.kind === 'publish');
    const cons = edges.filter((e) => e.kind === 'consume');
    const synth: GraphEdge[] = [];
    for (const p of pubs) {
      for (const c of cons) {
        if (c.source !== p.target) continue;
        synth.push({ ...p, id: `via:${p.id}>${c.id}`, kind: 'publish', target: c.target, url: model.topic(p.target)?.name });
      }
    }
    edges = [...edges.filter((e) => e.kind !== 'publish' && e.kind !== 'consume'), ...synth];
  }
  const topicIds = new Set(topics.map((t) => t.id));
  edges = edges.filter((e) => (serviceIds.has(e.source) || topicIds.has(e.source)) && (serviceIds.has(e.target) || topicIds.has(e.target)));
  // Drop topics with no remaining edges unless explicitly in subset.
  if (!subset) {
    const used = new Set<string>();
    for (const e of edges) {
      used.add(e.source);
      used.add(e.target);
    }
    topics = topics.filter((t) => used.has(t.id));
  }

  // Focus mode: keep only the blast radius of the selection.
  if (state.focus && state.sel && (model.service(state.sel) || model.topic(state.sel))) {
    const hood = model.neighbourhood(state.sel, state.up, state.down, (e) => edges.some((x) => x.id === e.id));
    services = services.filter((s) => hood.nodes.has(s.id));
    topics = topics.filter((t) => hood.nodes.has(t.id));
    edges = edges.filter((e) => hood.nodes.has(e.source) && hood.nodes.has(e.target));
  }
  return { nodes: [...services, ...topics], edges };
}

function MapInner({ model, state, update, subset, highlight, compact, fitKey }: Props) {
  const rf = useReactFlow();
  const { nodes: gNodes, edges: gEdges } = useMemo(() => visibleGraph(model, state, subset), [model, state, subset]);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number; width?: number; height?: number }>>(new Map());
  const [lanes, setLanes] = useState<Lane[]>([]);
  const layoutKey = useMemo(() => gNodes.map((n) => n.id).join('|') + '#' + gEdges.map((e) => e.id).join('|'), [gNodes, gEdges]);
  const lastFit = useRef<string>('');

  useEffect(() => {
    let cancelled = false;
    layoutServiceMap(gNodes, gEdges).then((res) => {
      if (cancelled) return;
      setPositions(new Map([...res.positions].map(([id, p]) => [id, { x: p.x, y: p.y, width: p.width, height: p.height }])));
      setLanes(res.lanes);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  const canvas = useStore((st) => ({ width: st.width, height: st.height }), (a, b) => a.width === b.width && a.height === b.height);
  useEffect(() => {
    const key = layoutKey + (fitKey ?? '');
    if (positions.size && canvas.width > 0 && lastFit.current !== key) {
      lastFit.current = key;
      // Compute the viewport from the layout itself so it does not depend on when React Flow measures nodes.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of positions.values()) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + (p.width ?? 220)); maxY = Math.max(maxY, p.y + (p.height ?? 76));
      }
      for (const l of lanes) { minX = Math.min(minX, l.x); maxX = Math.max(maxX, l.x + l.width); minY = Math.min(minY, l.y); maxY = Math.max(maxY, l.y + l.height); }
      const vp = getViewportForBounds({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, canvas.width, canvas.height, 0.1, 1.1, 0.1);
      const t = setTimeout(() => rf.setViewport(vp, { duration: 300 }), 0);
      return () => clearTimeout(t);
    }
  }, [positions, lanes, layoutKey, fitKey, rf, canvas]);

  const sel = state.sel;
  const hood = useMemo(() => {
    if (!sel || !(model.service(sel) || model.topic(sel))) return undefined;
    const allowed = new Set(gEdges.map((e) => e.id));
    return model.neighbourhood(sel, state.up, state.down, (e) => allowed.has(e.id));
  }, [model, sel, state.up, state.down, gEdges]);
  const selectedEdge = sel ? model.edges.get(sel) : undefined;
  const q = state.q.trim();

  const nodes: Node[] = useMemo(
    () =>
      gNodes.map((n) => {
        const raw = positions.get(n.id) as { x: number; y: number; width?: number; height?: number } | undefined;
        const p = { x: raw?.x ?? 0, y: raw?.y ?? 0, width: raw?.width ?? (n.kind === 'topic' ? 150 : 220), height: raw?.height ?? (n.kind === 'topic' ? 38 : 76) };
        const pos = { x: p.x, y: p.y };
        const match = matches(q, model, n);
        let dim = false;
        if (q) dim = !match;
        if (hood) dim = dim || !hood.nodes.has(n.id);
        if (selectedEdge) dim = dim || (n.id !== selectedEdge.source && n.id !== selectedEdge.target);
        const step = highlight?.nodeSteps?.get(n.id);
        if (n.kind === 'service') {
          const node: ServiceFlowNode = { id: n.id, type: 'service', position: pos, width: p.width, height: p.height, data: { service: n, dim, match: !!q && match, step }, selected: sel === n.id, draggable: true };
          return node;
        }
        const node: TopicFlowNode = { id: n.id, type: 'topic', position: pos, width: p.width, height: p.height, data: { topic: n as never, dim, match: !!q && match, step }, selected: sel === n.id, draggable: true };
        return node;
      }),
    [gNodes, positions, q, model, hood, selectedEdge, sel, highlight],
  );

  const edges: Edge[] = useMemo(
    () =>
      gEdges.map((e) => {
        let dim = false;
        if (hood) dim = !hood.edges.has(e.id);
        if (q) dim = dim || !(matches(q, model, model.nodes.get(e.source)!) || matches(q, model, model.nodes.get(e.target)!));
        if (selectedEdge) dim = dim || selectedEdge.id !== e.id;
        const step = highlight?.edgeSteps?.get(e.id);
        const edge: MapFlowEdge = {
          id: e.id,
          type: 'map',
          source: e.source,
          target: e.target,
          selected: sel === e.id,
          data: { edge: e, dim, emphasis: !!hood && hood.edges.has(e.id), step, label: highlight?.edgeLabels?.get(e.id) },
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
          zIndex: dim ? 0 : 1,
        };
        return edge;
      }),
    [gEdges, hood, q, model, selectedEdge, sel, highlight],
  );

  const onNodeClick: NodeMouseHandler = useCallback((_, n) => update({ sel: n.id, ep: undefined }), [update]);
  const onNodeDoubleClick: NodeMouseHandler = useCallback((_, n) => update({ sel: n.id, focus: !state.focus }), [update, state.focus]);
  const onEdgeClick: EdgeMouseHandler = useCallback((_, e) => update({ sel: e.id, ep: undefined }), [update]);
  const onPaneClick = useCallback(() => update({ sel: undefined, ep: undefined, focus: false }), [update]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={onNodeClick}
      onNodeDoubleClick={onNodeDoubleClick}
      onEdgeClick={onEdgeClick}
      onPaneClick={onPaneClick}
      nodesConnectable={false}
      elementsSelectable
      minZoom={0.1}
      maxZoom={2.5}
      className={compact ? 'rf compact' : 'rf'}
    >
      <LaneBackdrop lanes={lanes} />
      <Background gap={24} size={1} />
      {!compact && <MiniMap pannable zoomable nodeColor={(n) => cssColor(n.type === 'topic' ? '--c-topic' : `--c-${(n.data as { service?: { layer: string } }).service?.layer ?? 'unknown'}`)} />}
    </ReactFlow>
  );
}

function MapControls() {
  const rf = useReactFlow();
  return (
    <div className="map-controls">
      <button title="Zoom in" onClick={() => rf.zoomIn({ duration: 150 })}>
        +
      </button>
      <button title="Zoom out" onClick={() => rf.zoomOut({ duration: 150 })}>
        −
      </button>
      <button title="Fit view" onClick={() => rf.fitView({ padding: 0.15, duration: 300, maxZoom: 1.1 })}>
        ⤢
      </button>
    </div>
  );
}

export function ServiceMap(props: Props) {
  return (
    <ReactFlowProvider>
      <div className="map-wrap">
        <MapInner {...props} />
        <MapControls />
      </div>
    </ReactFlowProvider>
  );
}

export { MAP_EDGE_KINDS };

/** Resolve a CSS custom property to a concrete colour (SVG `fill` attributes do not accept var()). */
function cssColor(name: string): string {
  if (typeof window === 'undefined') return '#888';
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || '#888';
}
