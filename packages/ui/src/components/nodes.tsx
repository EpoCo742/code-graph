import { memo } from 'react';
import { Handle, Position, ViewportPortal, type NodeProps, type Node } from '@xyflow/react';
import type { ServiceNode as ServiceData, TopicNode as TopicData } from '@codegraph/schema';
import { LAYER_LABEL } from '../model/GraphModel';
import type { Lane } from '../layout/layout';

export type ServiceFlowNode = Node<{ service: ServiceData; dim: boolean; match: boolean; step?: number }, 'service'>;
export type TopicFlowNode = Node<{ topic: TopicData; dim: boolean; match: boolean; step?: number }, 'topic'>;

export const ServiceNodeView = memo(function ServiceNodeView({ data, selected }: NodeProps<ServiceFlowNode>) {
  const s = data.service;
  const cls = ['node-service', `layer-${s.layer}`, data.dim ? 'is-dim' : '', data.match ? 'is-match' : '', selected ? 'is-selected' : '', s.inferred ? 'is-inferred' : ''].join(' ');
  return (
    <div className={cls} title={s.description ?? s.name}>
      <Handle type="target" position={Position.Left} className="handle" />
      <div className="node-head">
        <span className="node-name">{s.name}</span>
        <span className={`badge badge-layer layer-${s.layer}`}>{LAYER_LABEL[s.layer]}</span>
      </div>
      <div className="node-meta">
        {s.owner && <span className="node-owner">{s.owner}</span>}
        <span className="node-counts">
          {s.stats.endpoints > 0 && <span title="endpoints">{s.stats.endpoints} ep</span>}
          {s.stats.consumers > 0 && <span title="consumers">{s.stats.consumers} sub</span>}
          {s.stats.calls > 0 && <span title="outbound calls">{s.stats.calls} out</span>}
          {s.stats.publishes > 0 && <span title="publishes">{s.stats.publishes} pub</span>}
        </span>
      </div>
      {data.step !== undefined && <span className="step-pill">{data.step}</span>}
      <Handle type="source" position={Position.Right} className="handle" />
    </div>
  );
});

export const TopicNodeView = memo(function TopicNodeView({ data, selected }: NodeProps<TopicFlowNode>) {
  const t = data.topic;
  const cls = ['node-topic', `broker-${t.broker}`, data.dim ? 'is-dim' : '', data.match ? 'is-match' : '', selected ? 'is-selected' : ''].join(' ');
  return (
    <div className={cls} title={`${t.broker} · ${t.name}`}>
      <Handle type="target" position={Position.Left} className="handle" />
      <span className="topic-broker">{t.broker}</span>
      <span className="topic-name">{t.name}</span>
      {data.step !== undefined && <span className="step-pill">{data.step}</span>}
      <Handle type="source" position={Position.Right} className="handle" />
    </div>
  );
});

export const nodeTypes = { service: ServiceNodeView, topic: TopicNodeView };

export function LaneBackdrop({ lanes }: { lanes: Lane[] }) {
  return (
    <ViewportPortal>
      {lanes.map((l) => (
        <div
          key={l.layer}
          className={`lane layer-${l.layer}`}
          style={{ position: 'absolute', transform: `translate(${l.x}px, ${l.y}px)`, width: l.width, height: l.height }}
        >
          <span className="lane-label">{LAYER_LABEL[l.layer]}</span>
        </div>
      ))}
    </ViewportPortal>
  );
}
