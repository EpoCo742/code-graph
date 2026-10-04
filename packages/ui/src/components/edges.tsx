import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps, type Edge } from '@xyflow/react';
import type { GraphEdge } from '@codegraph/schema';

export type MapFlowEdge = Edge<{ edge: GraphEdge; dim: boolean; emphasis: boolean; step?: number; label?: string }, 'map'>;

export const MapEdgeView = memo(function MapEdgeView(props: EdgeProps<MapFlowEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd } = props;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const e = data!.edge;
  const cls = [
    'edge',
    `edge-${e.kind}`,
    e.status === 'observed' ? 'edge-observed' : '',
    e.confidence < 0.6 ? 'edge-low' : '',
    data!.dim ? 'is-dim' : '',
    data!.emphasis ? 'is-emphasis' : '',
    selected ? 'is-selected' : '',
  ].join(' ');
  return (
    <>
      <BaseEdge id={id} path={path} className={cls} markerEnd={markerEnd} interactionWidth={14} />
      {(data!.step !== undefined || data!.label) && (
        <EdgeLabelRenderer>
          <div className={`edge-label ${data!.dim ? 'is-dim' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {data!.step !== undefined && <span className="step-pill inline">{data!.step}</span>}
            {data!.label && <span>{data!.label}</span>}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

export const edgeTypes = { map: MapEdgeView };
