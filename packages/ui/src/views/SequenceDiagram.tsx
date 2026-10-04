import { useMemo } from 'react';
import type { DerivedFlow } from '../model/flowDerive';

const COL_W = 180;
const HEAD_H = 56;
const ROW_H = 44;
const PAD_X = 24;
const PAD_TOP = 16;
const PAD_BOTTOM = 24;
const BOX_W = 150;
const BOX_H = 36;

interface Props {
  derived: DerivedFlow;
  selectedStep?: number;
  onSelectStep?: (step: number) => void;
}

export function SequenceDiagram({ derived, selectedStep, onSelectStep }: Props) {
  const { participants, arrows } = derived;
  const xOf = useMemo(() => new Map(participants.map((p, i) => [p.id, PAD_X + i * COL_W + COL_W / 2])), [participants]);
  const width = PAD_X * 2 + participants.length * COL_W;
  const height = PAD_TOP + HEAD_H + arrows.length * ROW_H + PAD_BOTTOM;
  const lifelineTop = PAD_TOP + BOX_H;
  const lifelineBottom = height - PAD_BOTTOM;

  return (
    <div className="seq-scroll">
      <svg className="seq" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Sequence diagram">
        <defs>
          <marker id="seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
          </marker>
        </defs>
        {participants.map((p) => {
          const x = xOf.get(p.id)!;
          return (
            <g key={p.id} className={`seq-participant ${p.kind} layer-${p.layer}`}>
              <line x1={x} y1={lifelineTop} x2={x} y2={lifelineBottom} className="seq-lifeline" />
              <rect x={x - BOX_W / 2} y={PAD_TOP} width={BOX_W} height={BOX_H} rx={p.kind === 'topic' ? 18 : 8} className="seq-box" />
              <text x={x} y={PAD_TOP + BOX_H / 2 + 4} textAnchor="middle" className="seq-box-label">
                {truncate(p.label, 22)}
              </text>
            </g>
          );
        })}
        {arrows.map((a, i) => {
          const y = PAD_TOP + HEAD_H + i * ROW_H + ROW_H / 2;
          const x1 = xOf.get(a.from) ?? PAD_X;
          const x2 = xOf.get(a.to) ?? PAD_X;
          const active = selectedStep === a.step;
          const cls = `seq-arrow kind-${a.kind} ${active ? 'is-active' : ''}`;
          if (a.kind === 'self' || x1 === x2) {
            return (
              <g key={i} className={cls} onClick={() => onSelectStep?.(a.step)}>
                <rect x={PAD_X - 16} y={y - ROW_H / 2 + 2} width={width - PAD_X * 2 + 32} height={ROW_H - 4} className="seq-row-bg" />
                <path d={`M ${x1} ${y - 10} H ${x1 + 28} V ${y + 10} H ${x1 + 4}`} className="seq-line" markerEnd="url(#seq-arrow)" fill="none" />
                <text x={x1 + 34} y={y + 4} className="seq-label" textAnchor="start">
                  {truncate(a.label, 48)}
                </text>
                <StepNum x={PAD_X - 8} y={y} n={a.step} />
              </g>
            );
          }
          const dir = x2 > x1 ? 1 : -1;
          const mid = (x1 + x2) / 2;
          return (
            <g key={i} className={cls} onClick={() => onSelectStep?.(a.step)}>
              <rect x={PAD_X - 16} y={y - ROW_H / 2 + 2} width={width - PAD_X * 2 + 32} height={ROW_H - 4} className="seq-row-bg" />
              <line x1={x1} y1={y} x2={x2 - dir * 6} y2={y} className="seq-line" markerEnd="url(#seq-arrow)" />
              <text x={mid} y={y - 7} textAnchor="middle" className="seq-label">
                {truncate(a.label, Math.max(16, Math.floor(Math.abs(x2 - x1) / 7)))}
              </text>
              <StepNum x={PAD_X - 8} y={y} n={a.step} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function StepNum({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <g className="seq-step">
      <circle cx={x} cy={y} r={9} />
      <text x={x} y={y + 3.5} textAnchor="middle">
        {n}
      </text>
    </g>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
