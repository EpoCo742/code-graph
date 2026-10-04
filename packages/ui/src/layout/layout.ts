import type { ElkNode, ELK as ElkType } from 'elkjs/lib/elk-api.js';
import type { GraphEdge, GraphNode, Layer } from '@codegraph/schema';
import { LAYER_ORDER, layerIndex } from '../model/GraphModel';

export const SERVICE_W = 220;
export const SERVICE_H = 76;
export const TOPIC_W = 150;
export const TOPIC_H = 38;
export const LANE_PAD = 36;

export interface Positioned {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Lane {
  layer: Layer;
  x: number;
  width: number;
  y: number;
  height: number;
}

export interface LayoutResult {
  positions: Map<string, Positioned>;
  lanes: Lane[];
  bounds: { width: number; height: number };
}

let elkPromise: Promise<ElkType> | undefined;
function getElk(): Promise<ElkType> {
  if (!elkPromise) elkPromise = import('elkjs/lib/elk.bundled.js').then((m) => new m.default());
  return elkPromise;
}

/** Partition number for a layer: even numbers, leaving odd slots for topics. */
function layerPartition(layer: Layer): number {
  return layerIndex(layer) * 2;
}

/**
 * Lay out services in swimlanes by layer (ELK layered with partitions) and put
 * topics in the slot between their publishers and consumers.
 */
export async function layoutServiceMap(nodes: GraphNode[], edges: GraphEdge[]): Promise<LayoutResult> {
  const services = nodes.filter((n) => n.kind === 'service');
  const topics = nodes.filter((n) => n.kind === 'topic');
  const layerOf = new Map(services.map((s) => [s.id, s.kind === 'service' ? s.layer : 'unknown'] as const));

  const partition = new Map<string, number>();
  for (const s of services) partition.set(s.id, layerPartition(layerOf.get(s.id)!));
  for (const t of topics) {
    const pubs = edges.filter((e) => e.kind === 'publish' && e.target === t.id).map((e) => partition.get(e.source));
    const cons = edges.filter((e) => e.kind === 'consume' && e.source === t.id).map((e) => partition.get(e.target));
    const pub = pubs.filter((p): p is number => p !== undefined);
    const con = cons.filter((p): p is number => p !== undefined);
    let p: number;
    if (pub.length && con.length) {
      const maxPub = Math.max(...pub);
      const minCon = Math.min(...con);
      p = minCon > maxPub ? maxPub + 1 : maxPub + 1;
    } else if (pub.length) p = Math.max(...pub) + 1;
    else if (con.length) p = Math.max(0, Math.min(...con) - 1);
    else p = layerPartition('processor') - 1;
    partition.set(t.id, p);
  }

  const idSet = new Set(nodes.map((n) => n.id));
  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.partitioning.activate': 'true',
      'elk.separateConnectedComponents': 'false',
      'elk.layered.spacing.nodeNodeBetweenLayers': '110',
      'elk.spacing.nodeNode': '28',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.semiInteractive': 'true',
      'elk.edgeRouting': 'SPLINES',
      'elk.padding': `[top=${LANE_PAD},left=${LANE_PAD},bottom=${LANE_PAD},right=${LANE_PAD}]`,
    },
    children: [...services, ...topics].map((n) => ({
      id: n.id,
      width: n.kind === 'topic' ? TOPIC_W : SERVICE_W,
      height: n.kind === 'topic' ? TOPIC_H : SERVICE_H,
      layoutOptions: { 'elk.partitioning.partition': String(partition.get(n.id) ?? 0) },
    })),
    edges: edges
      .filter((e) => idSet.has(e.source) && idSet.has(e.target) && e.source !== e.target)
      .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  const elk = await getElk();
  const out = await elk.layout(elkGraph);
  const positions = new Map<string, Positioned>();
  for (const c of out.children ?? []) {
    positions.set(c.id, { id: c.id, x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? SERVICE_W, height: c.height ?? SERVICE_H });
  }

  // Lanes: one per layer that has at least one service, spanning its x-range.
  const totalH = Math.max(out.height ?? 0, 200);
  const lanes: Lane[] = [];
  for (const layer of LAYER_ORDER) {
    const members = services.filter((s) => layerOf.get(s.id) === layer).map((s) => positions.get(s.id)!).filter(Boolean);
    if (!members.length) continue;
    const minX = Math.min(...members.map((m) => m.x));
    const maxX = Math.max(...members.map((m) => m.x + m.width));
    lanes.push({ layer, x: minX - LANE_PAD / 2, width: maxX - minX + LANE_PAD, y: 0, height: totalH });
  }
  // Resolve lane overlaps by splitting the gap between neighbours.
  lanes.sort((a, b) => a.x - b.x);
  for (let i = 1; i < lanes.length; i++) {
    const prev = lanes[i - 1];
    const cur = lanes[i];
    const prevEnd = prev.x + prev.width;
    if (cur.x < prevEnd) {
      const mid = (prevEnd + cur.x) / 2;
      prev.width = mid - prev.x - 4;
      cur.width = cur.x + cur.width - mid - 4;
      cur.x = mid + 4;
    }
  }

  return { positions, lanes, bounds: { width: out.width ?? 0, height: totalH } };
}
