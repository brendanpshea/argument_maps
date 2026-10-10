import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import {
  Background,
  BaseEdge,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  getBezierPath,
  getNodesBounds,
  getViewportForBounds,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toPng } from 'html-to-image';
import { FAILED_COLOR, INDUCTIVE_DASH, isFailed, optionLabel, typeBadge, verdictLabel } from '../model/evaluationStyle';
import { vocab } from '../model/vocab';
import { claimStatuses, STATUS_LABEL, STATUS_TITLE, type ClaimStatus } from '../model/dialectic';
import { linkSentence } from '../model/describe';
import { QUALITIES, type LessonKind, type ArgumentMap, type Evaluation, type InferenceQuality, type InferenceType, type MapNode, type MapRelation, type RelationType } from '../model/types';
import { autoLayout, CLAIM_SIZE, JUNCTION_SIZE } from '../model/layout';
import * as ops from '../model/ops';
import { download } from './exportMap';

/** How a claim's wording can be changed. */
export type WordingEdit = { kind: 'none' } | { kind: 'free' } | { kind: 'choose'; choices: string[] };

type ClaimData = {
  text: string;
  edit: WordingEdit;
  /** Small tag shown on the claim, e.g. "unstated" for claim-bank claims. */
  tag?: string;
  /** Claim number shown in marked mode. */
  label?: string;
  originalText: string;
  isConclusion: boolean;
  /** "Main conclusion" or "Explanandum". */
  conclusionLabel: string;
  readOnly: boolean;
  /** Structure is fixed (reword steps): only the wording can change. */
  locked: boolean;
  /** Where the claim stands in the debate on this map: challenged or answered. */
  status?: ClaimStatus;
  /** How screen readers name the claim, e.g. "(3) “Large animals suffer…”". */
  name: string;
};
type JunctionData = {
  type: RelationType;
  label: string;
  /** The link as a sentence, e.g. "(3) supports (2)", for screen readers. */
  description: string;
  premises: number;
  /** Claims that could be added to this link as linked premises. */
  candidates: { id: string; name: string }[];
  readOnly: boolean;
  /** The student's judgement of this link, shown as a badge. */
  evaluation?: Evaluation;
  /** Set in evaluate steps when this link is to be evaluated: what to ask. */
  evaluate?: 'type' | 'full';
  kind: LessonKind;
};
type LinkEdgeT = Edge<{ readOnly: boolean; title: string; failed?: boolean }, 'link'>;
type ClaimNodeT = Node<ClaimData, 'claim'>;
type JunctionNodeT = Node<JunctionData, 'junction'>;

interface Actions {
  setText(id: string, text: string): void;
  toggleConclusion(id: string): void;
  removeNode(id: string): void;
  toggleType(relationId: string): void;
  reverse(relationId: string): void;
  removeRelation(relationId: string): void;
  linkPremise(relationId: string, nodeId: string): void;
  split(relationId: string): void;
  removeEdge(edgeId: string): void;
  setEvaluation(relationId: string, evaluation: Evaluation): void;
}
const ActionsContext = createContext<Actions | null>(null);

function ClaimNode({ id, data, selected }: NodeProps<ClaimNodeT>) {
  const actions = useContext(ActionsContext)!;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.text);
  const reworded = data.text.trim() !== data.originalText.trim();

  const save = () => {
    setEditing(false);
    if (draft.trim()) actions.setText(id, draft.trim());
    else setDraft(data.text);
  };

  return (
    <div
      className={`claim-node${data.isConclusion ? ' is-conclusion' : ''}${data.tag === 'unstated' ? ' is-unstated' : ''}${data.status ? ` is-${data.status}` : ''}${selected ? ' is-selected' : ''}`}
    >
      <SideHandles />
      {data.status && (
        <span className={`status-pill ${data.status}`} title={STATUS_TITLE[data.status]} aria-hidden="true">
          {STATUS_LABEL[data.status]}
        </span>
      )}
      <div className="claim-head">
        {data.label && <span className="claim-number">{data.label}</span>}
        {data.isConclusion && <span className="conclusion-tag">{data.conclusionLabel}</span>}
        {data.tag && <span className="claim-tag">{data.tag}</span>}
        {reworded && <span className="reworded-tag" title={`Passage: “${data.originalText}”`}>reworded</span>}
        {!data.readOnly && (
          <span className="node-tools">
            {!data.locked && (
              <button
                className="nodrag icon"
                title={`${data.isConclusion ? 'Unmark' : 'Mark as'} ${data.conclusionLabel.toLowerCase()}`}
                aria-label={`${data.conclusionLabel}: ${data.name}`}
                aria-pressed={data.isConclusion}
                onClick={() => actions.toggleConclusion(id)}
              >
                <span aria-hidden="true">★</span>
              </button>
            )}
            {data.edit.kind !== 'none' && (
              <button
                className="nodrag icon"
                title={data.edit.kind === 'choose' ? 'Choose a wording' : 'Reword this claim'}
                aria-label={`Reword ${data.name}`}
                aria-expanded={editing}
                onClick={() => { setDraft(data.text); setEditing(!editing); }}
              >
                <span aria-hidden="true">✎</span>
              </button>
            )}
            {!data.locked && (
              <button
                className="nodrag icon"
                title="Remove from map"
                aria-label={`Remove ${data.name} from the map`}
                onClick={() => {
                  actions.removeNode(id);
                  refocus(null);
                }}
              >
                <span aria-hidden="true">×</span>
              </button>
            )}
          </span>
        )}
      </div>
      {editing && data.edit.kind === 'choose' ? (
        <div className="nodrag wording-choices" role="group" aria-label={`Choose a wording for ${data.name}`}>
          {[data.originalText, ...data.edit.choices.filter((c) => c !== data.originalText)].map((choice, i) => (
            <button
              key={i}
              aria-pressed={choice === data.text}
              className={`nodrag${choice === data.text ? ' on' : ''}`}
              onClick={() => { actions.setText(id, choice); setEditing(false); }}
            >
              {i === 0 && <span className="choice-label">As written: </span>}
              {choice}
            </button>
          ))}
        </div>
      ) : editing ? (
        <div className="nodrag">
          <textarea
            autoFocus
            className="nodrag nowheel"
            value={draft}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
              if (e.key === 'Escape') { setDraft(data.text); setEditing(false); }
            }}
          />
          <button className="nodrag link-button" onMouseDown={(e) => e.preventDefault()} onClick={() => setDraft(data.originalText)}>
            Restore passage wording
          </button>
        </div>
      ) : (
        <div className="claim-text" onDoubleClick={() => { if (!data.readOnly && data.edit.kind !== 'none') { setDraft(data.text); setEditing(true); } }}>
          {data.text}
        </div>
      )}
    </div>
  );
}

/** Connection dots on all four sides. Any dot can start or end a link (ConnectionMode.Loose). */
function SideHandles() {
  return (
    <>
      <Handle type="source" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Right} id="right" />
    </>
  );
}

/** Puts keyboard focus back on `el` after a change, or on the map if `el` has gone. */
const refocus = (el: HTMLElement | null) =>
  requestAnimationFrame(() => (el?.isConnected ? el : document.querySelector<HTMLElement>('.map-editor'))?.focus());

function JunctionNode({ id, data, selected }: NodeProps<JunctionNodeT>) {
  const actions = useContext(ActionsContext)!;
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) setOpen(false);
  }, [selected]);
  useEffect(() => {
    if (!open) setPicking(false);
  }, [open]);
  // Opening a menu (or its "link with" list) moves focus into it.
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('button, input')?.focus();
  }, [open, picking]);
  const close = () => {
    setOpen(false);
    refocus(trigger.current);
  };
  const act = (fn: () => void) => () => {
    close();
    fn();
  };
  const ev = data.evaluation;
  // Menus open inside the zoomed canvas; scale them back up so they stay readable and
  // tappable when the map is zoomed out to fit a small screen.
  const zoom = useStore((s) => s.transform[2]);
  const menuScale = Math.min(2.5, Math.max(1, 1 / zoom));
  const judged = ev?.type ? `, judged ${[ev.type, ev.quality].filter(Boolean).join(', ')}` : '';
  return (
    <div
      className={`junction junction-${isFailed(data.evaluation) ? 'failed' : data.type}`}
      style={{ '--menu-scale': menuScale } as React.CSSProperties}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <SideHandles />
      <button
        ref={trigger}
        className="nodrag"
        disabled={data.readOnly && !data.evaluate}
        aria-haspopup={data.evaluate ? 'dialog' : 'true'}
        aria-expanded={open}
        aria-label={`${data.description}${judged}. ${data.evaluate ? 'Evaluate this reasoning' : data.readOnly ? '' : 'Change or delete this link'}`}
        title={data.evaluate ? 'Evaluate this reasoning' : data.readOnly ? undefined : 'Change or delete this link'}
        onClick={() => setOpen(!open)}
      >
        {/* Once the student judges the quality, the label is their verdict ("✓ valid", "✗ weak"). */}
        {verdictLabel(data.evaluation) ?? data.label}
      </button>
      {ev?.type ? (
        <span className={`eval-badge ${ev.type}`} aria-hidden="true">
          {typeBadge(ev)}
        </span>
      ) : (
        data.evaluate && (
          <span className="eval-badge todo" aria-hidden="true">
            evaluate?
          </span>
        )
      )}
      {open && data.evaluate && (
        <div ref={menu}>
          <EvaluationPicker
            className="link-menu nodrag"
            dialog
            label={data.description}
            ask={data.evaluate}
            value={ev ?? {}}
            onChange={(next) => {
              actions.setEvaluation(id, next);
              if (next.type && (data.evaluate === 'type' || next.quality)) close();
            }}
          />
        </div>
      )}
      {open && !data.evaluate && picking && (
        <div ref={menu} className="link-menu nodrag" role="group" aria-label={vocab(data.kind).linkWith}>
          <p className="link-menu-title">{vocab(data.kind).linkWithQuestion(data.premises > 1)}</p>
          {data.candidates.map((c) => (
            <button key={c.id} onClick={act(() => actions.linkPremise(id, c.id))}>
              {c.name}
            </button>
          ))}
          <button className="muted" onClick={() => setPicking(false)}>
            ← Back
          </button>
        </div>
      )}
      {open && !data.evaluate && !picking && (
        <div ref={menu} className="link-menu nodrag" role="group" aria-label={`Options for: ${data.description}`}>
          {data.candidates.length > 0 && <button onClick={() => setPicking(true)}>{vocab(data.kind).linkWith}</button>}
          {data.premises > 1 && <button onClick={act(() => actions.split(id))}>{vocab(data.kind).split}</button>}
          {data.type !== 'explanation' && (
            <button onClick={act(() => actions.toggleType(id))}>Change to {data.type === 'support' ? 'objection' : 'support'}</button>
          )}
          {data.premises === 1 && <button onClick={act(() => actions.reverse(id))}>Reverse direction</button>}
          <button className="danger" onClick={act(() => actions.removeRelation(id))}>
            Delete link
          </button>
        </div>
      )}
    </div>
  );
}

/** Two questions about one inference: deductive or inductive, then valid/invalid or strong/weak. */
export function EvaluationPicker({
  ask,
  value,
  onChange,
  className,
  label,
  dialog,
}: {
  ask: 'type' | 'full';
  value: Evaluation;
  onChange: (next: Evaluation) => void;
  className?: string;
  /** Says which link this is, e.g. "(3) supports (2)". */
  label: string;
  /** Shown as a pop-up on the map (otherwise inline, in the outline). */
  dialog?: boolean;
}) {
  const name = useId();
  const group = (key: string, legend: string, options: string[], current: string | undefined, pick: (o: string) => void) => (
    <fieldset className="eval-group">
      <legend>{legend}</legend>
      {options.map((o) => (
        <label key={o} className={current === o ? 'on' : ''}>
          <input type="radio" name={`${name}-${key}`} checked={current === o} onChange={() => pick(o)} />
          <span aria-hidden="true">{optionLabel(o as InferenceType | InferenceQuality).split(' ')[0]} </span>
          {o}
        </label>
      ))}
    </fieldset>
  );
  return (
    <div className={className} role={dialog ? 'dialog' : 'group'} aria-label={`Evaluate: ${label}`}>
      {group('type', 'Do the premises claim to guarantee the conclusion, or make it likely?', ['deductive', 'inductive'], value.type, (t) =>
        // Changing the type resets the quality, whose options depend on it.
        onChange({ type: t as InferenceType, quality: t === value.type ? value.quality : undefined }),
      )}
      {ask === 'full' &&
        value.type &&
        group(
          'quality',
          value.type === 'deductive'
            ? 'If the premises were true, would the conclusion have to be true?'
            : 'Given everything on the map, how likely is the conclusion?',
          QUALITIES[value.type],
          value.quality,
          (q) => onChange({ ...value, quality: q as InferenceQuality }),
        )}
    </div>
  );
}

/** A link line. When selected, shows a button to remove it. */
function LinkEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, selected, data }: EdgeProps<LinkEdgeT>) {
  const actions = useContext(ActionsContext)!;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} style={{ ...style, strokeWidth: selected ? 4 : 2 }} markerEnd={markerEnd} interactionWidth={24} />
      {data?.failed && (
        // A failed inference "doesn't get through": a circled ✗ breaks the line into the conclusion.
        <g className="failed-mark" aria-hidden="true">
          <circle cx={labelX} cy={labelY} r={9} fill="#fff" stroke={FAILED_COLOR} strokeWidth={2} />
          <text x={labelX} y={labelY + 4.5} textAnchor="middle" fontSize={12} fontWeight={700} fill={FAILED_COLOR}>
            ✗
          </text>
        </g>
      )}
      {selected && !data?.readOnly && (
        <EdgeLabelRenderer>
          <button
            className="edge-delete nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            title={data?.title}
            aria-label={data?.title}
            onClick={() => actions.removeEdge(id)}
          >
            ×
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}


const nodeTypes = { claim: ClaimNode, junction: JunctionNode };
const edgeTypes = { link: LinkEdge };
const COLORS = { support: '#2f7d32', objection: '#c62828', explanation: '#5b3fa8' };

export interface MapEditorProps {
  map: ArgumentMap;
  /** Argument or explanation lesson: sets link types and wording. */
  kind?: LessonKind;
  onChange?: (map: ArgumentMap) => void;
  readOnly?: boolean;
  /** Reword steps: claims can be reworded and moved, but not added, removed, or relinked. */
  locked?: boolean;
  /** Claim-number label for a node, if the lesson numbers its claims. */
  labelFor?: (nodeId: string) => string | undefined;
  originalTextFor: (nodeId: string) => string;
  editFor: (nodeId: string) => WordingEdit;
  tagFor?: (nodeId: string) => string | undefined;
  /** Evaluate steps: what to ask about this link, or null if it isn't evaluated. */
  evaluateFor?: (relationId: string) => 'type' | 'full' | null;
  exportName?: string;
}

function buildNodes(map: ArgumentMap, props: MapEditorProps, prev: Node[]): Node[] {
  const old = new Map(prev.map((n) => [n.id, n]));
  const keep = (id: string) => {
    const o = old.get(id);
    return o ? { measured: o.measured, selected: o.selected } : {};
  };
  const readOnly = !!props.readOnly;
  const locked = !!props.locked;
  const statuses = claimStatuses(map.relations);
  const nameOf = (id: string) => {
    const n = map.nodes.find((x) => x.id === id);
    return [props.labelFor?.(id), `“${n?.text ?? ''}”`].filter(Boolean).join(' ');
  };
  const shortName = (id: string) => props.labelFor?.(id) ?? nameOf(id);
  return [
    ...map.nodes.map(
      (n): ClaimNodeT => ({
        id: n.id,
        type: 'claim',
        position: n.position,
        ...keep(n.id),
        data: {
          text: n.text,
          edit: props.editFor(n.id),
          tag: props.tagFor?.(n.id),
          label: props.labelFor?.(n.id),
          originalText: props.originalTextFor(n.id),
          isConclusion: map.conclusion === n.id,
          conclusionLabel: vocab(props.kind ?? 'argument').Conclusion,
          readOnly,
          locked,
          status: statuses.get(n.id),
          name: nameOf(n.id),
        },
        ariaLabel: [
          map.conclusion === n.id ? vocab(props.kind ?? 'argument').Conclusion : props.tagFor?.(n.id) && `${props.tagFor(n.id)} claim`,
          nameOf(n.id),
          statuses.get(n.id) && `(${statuses.get(n.id)})`,
        ]
          .filter(Boolean)
          .join(' '),
      }),
    ),
    ...map.relations.map((r): JunctionNodeT => {
      return {
        id: r.id,
        type: 'junction',
        position: junctionPosition(map, r),
        ...keep(r.id),
        data: {
          type: r.type,
          label: ops.relationLabel(map, r.id),
          description: linkSentence(map, r, shortName),
          premises: r.from.length,
          evaluation: r.evaluation,
          evaluate: props.evaluateFor?.(r.id) ?? undefined,
          kind: props.kind ?? 'argument',
          candidates: map.nodes
            .filter((n) => n.id !== r.to && !r.from.includes(n.id))
            .map((n) => ({ id: n.id, name: nameOf(n.id) })),
          readOnly: readOnly || locked,
        },
      };
    }),
  ];
}

type Box = { x: number; y: number; w: number; h: number };
const overlaps = (a: Box, b: Box, margin: number) =>
  !(a.x + a.w + margin <= b.x || b.x + b.w + margin <= a.x || a.y + a.h + margin <= b.y || b.y + b.h + margin <= a.y);

/** A claim box's height, estimated from its text (it grows as the text wraps). */
const claimHeight = (text: string) => Math.max(CLAIM_SIZE.height, 52 + Math.ceil(text.length / 30) * 19);
const claimBox = (n: { position: { x: number; y: number }; text: string }): Box => ({ ...n.position, w: CLAIM_SIZE.width, h: claimHeight(n.text) });
/** A link label's box (its evaluation badge, if any, sits underneath). */
const labelBox = (p: { x: number; y: number }, r: MapRelation): Box => ({ ...p, w: 112, h: r.evaluation?.type ? 54 : 30 });

/** The nearest spot to `start` where a box of the given size overlaps none of `boxes`. */
function nearestFree(start: { x: number; y: number }, size: { w: number; h: number }, boxes: Box[], margin = 8) {
  const fits = (p: { x: number; y: number }) => boxes.every((b) => !overlaps({ ...p, ...size }, b, margin));
  for (let ring = 0; ring <= 40; ring++) {
    const radius = ring * 12;
    const steps = Math.max(1, ring * 6);
    for (let k = 0; k < steps; k++) {
      const a = (2 * Math.PI * k) / steps;
      const p = { x: start.x + radius * Math.cos(a), y: start.y + radius * Math.sin(a) };
      if (fits(p)) return p;
    }
  }
  return start;
}

/**
 * Where each link label without a saved position sits: midway between its premises and its
 * target, moved to the nearest spot clear of claims and other labels.
 */
const labelCache = new WeakMap<ArgumentMap, Record<string, { x: number; y: number }>>();
function labelLayout(map: ArgumentMap): Record<string, { x: number; y: number }> {
  const cached = labelCache.get(map);
  if (cached) return cached;
  const boxes: Box[] = [...map.nodes.map(claimBox), ...map.relations.filter((r) => r.position).map((r) => labelBox(r.position!, r))];
  const out: Record<string, { x: number; y: number }> = {};
  for (const r of map.relations) {
    if (r.position) continue;
    const premises = map.nodes.filter((n) => r.from.includes(n.id));
    const target = map.nodes.find((n) => n.id === r.to);
    if (!premises.length || !target) {
      out[r.id] = { x: 0, y: 0 };
      continue;
    }
    // Halfway between the premises' average centre and the target's centre.
    const centre = (n: MapNode) => {
      const b = claimBox(n);
      return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    };
    const avg = (key: 'x' | 'y') => premises.reduce((sum, n) => sum + centre(n)[key], 0) / premises.length;
    const { w, h } = labelBox({ x: 0, y: 0 }, r);
    const size = { w, h };
    const mid = { x: (avg('x') + centre(target).x) / 2 - size.w / 2, y: (avg('y') + centre(target).y) / 2 - size.h / 2 };
    out[r.id] = nearestFree(mid, size, boxes);
    boxes.push(labelBox(out[r.id], r));
  }
  labelCache.set(map, out);
  return out;
}

/** Where a link's label sits: its saved position, or a clear spot between its premises and its target. */
function junctionPosition(map: ArgumentMap, r: MapRelation): { x: number; y: number } {
  return r.position ?? labelLayout(map)[r.id] ?? { x: 0, y: 0 };
}

function buildEdges(map: ArgumentMap, prev: Edge[], readOnly: boolean, kind: LessonKind): LinkEdgeT[] {
  const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id));
  // Attach each line to the sides of the two boxes that face each other.
  const center = (id: string) => {
    const n = map.nodes.find((x) => x.id === id);
    if (n) return { x: n.position.x + CLAIM_SIZE.width / 2, y: n.position.y + CLAIM_SIZE.height / 2 };
    const r = map.relations.find((x) => x.id === id);
    const p = r ? junctionPosition(map, r) : { x: 0, y: 0 };
    return { x: p.x + JUNCTION_SIZE.width / 2, y: p.y + JUNCTION_SIZE.height / 2 };
  };
  const handles = (source: string, target: string) => {
    const a = center(source);
    const b = center(target);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    // Prefer vertical lines; use the sides only when the boxes are clearly side by side.
    if (Math.abs(dx) > Math.abs(dy) * 2.5) {
      return dx > 0 ? { sourceHandle: 'right', targetHandle: 'left' } : { sourceHandle: 'left', targetHandle: 'right' };
    }
    return dy >= 0 ? { sourceHandle: 'bottom', targetHandle: 'top' } : { sourceHandle: 'top', targetHandle: 'bottom' };
  };
  return map.relations.flatMap((r): LinkEdgeT[] => {
    // Failed inferences (judged invalid or weak) are grey, whatever the link type.
    const failed = isFailed(r.evaluation);
    const stroke = failed ? FAILED_COLOR : COLORS[r.type];
    const linked = r.from.length > 1;
    // Once a link has been evaluated as inductive, it's drawn dashed with an open arrowhead.
    const inductive = r.evaluation?.type === 'inductive';
    const style = inductive ? { stroke, strokeDasharray: INDUCTIVE_DASH } : { stroke };
    return [
      ...r.from.map((f): LinkEdgeT => ({
        id: `p|${r.id}|${f}`,
        type: 'link',
        source: f,
        target: r.id,
        ...handles(f, r.id),
        style,
        selected: selected.has(`p|${r.id}|${f}`),
        data: { readOnly, title: linked ? vocab(kind).removeFromLink : 'Delete this link' },
      })),
      {
        id: `o|${r.id}`,
        type: 'link',
        source: r.id,
        target: r.to,
        ...handles(r.id, r.to),
        style,
        markerEnd: inductive
          ? { type: MarkerType.Arrow, color: stroke, width: 22, height: 22, strokeWidth: 1.6 }
          : { type: MarkerType.ArrowClosed, color: stroke },
        selected: selected.has(`o|${r.id}`),
        data: { readOnly, title: 'Delete this link', failed },
      },
    ];
  });
}

/**
 * A position for a newly added claim inside the visible area that doesn't overlap other
 * claims or link labels. Returns null if the claim is already fully in view.
 */
function freeSpotInView(
  map: ArgumentMap,
  nodeId: string,
  view: { x: number; y: number; end: { x: number; y: number } },
  avoid: Box[] = [],
): { x: number; y: number } | null {
  const node = map.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const margin = 16;
  const w = CLAIM_SIZE.width;
  const h = claimHeight(node.text);
  const inView = (p: { x: number; y: number }) =>
    p.x >= view.x && p.y >= view.y && p.x + w <= view.end.x && p.y + h <= view.end.y;
  const boxes = [
    ...map.nodes.filter((n) => n.id !== nodeId).map(claimBox),
    ...map.relations.map((r) => labelBox(junctionPosition(map, r), r)),
    ...avoid,
  ];
  const free = (p: { x: number; y: number }) => boxes.every((b) => !overlaps({ ...p, w, h }, b, margin));
  if (inView(node.position) && free(node.position)) return null;
  // Scan the visible area row by row for the first free spot.
  for (let y = view.y; y + h <= view.end.y; y += h / 2) {
    for (let x = view.x + margin; x + w <= view.end.x; x += w / 4) {
      if (free({ x, y })) return { x, y };
    }
  }
  // Crowded: put it in the middle of the view so at least it can be seen and dragged.
  return { x: (view.x + view.end.x - w) / 2, y: (view.y + view.end.y - h) / 2 };
}

/** Applies the deletion of one edge: a premise line removes that premise; the arrow removes the whole link. */
function removeEdgeFromMap(map: ArgumentMap, edgeId: string): ArgumentMap {
  const [kind, relId, nodeId] = edgeId.split('|');
  return kind === 'p' ? ops.removePremise(map, relId, nodeId) : ops.removeRelation(map, relId);
}

function Editor(props: MapEditorProps) {
  const { map, readOnly, locked } = props;
  /** No structural edits: read-only (model answer) or locked (reword step). */
  const fixed = readOnly || locked;
  const mapRef = useRef(map);
  mapRef.current = map;
  const commit = useCallback((next: ArgumentMap) => props.onChange?.(next), [props.onChange]);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const explanation = props.kind === 'explanation';
  // Explanation lessons have only one kind of link.
  const [linkType, setLinkType] = useState<RelationType>(explanation ? 'explanation' : 'support');
  const wrapper = useRef<HTMLDivElement>(null);
  const flow = useReactFlow();

  useEffect(() => {
    setNodes((prev) => buildNodes(map, props, prev));
    setEdges((prev) => buildEdges(map, prev, !!fixed, props.kind ?? 'argument'));
  }, [map, readOnly, locked]);

  // A claim just added from the passage or the claim bank gets a default spot that may be
  // off screen (after panning or zooming, or on a small screen). Move it to a free spot in view.
  const knownIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    const known = knownIds.current;
    knownIds.current = new Set(map.nodes.map((n) => n.id));
    if (!known || readOnly) return;
    const added = map.nodes.filter((n) => !known.has(n.id));
    const rect = wrapper.current?.getBoundingClientRect();
    if (added.length !== 1 || !rect) return;
    // The visible area in map coordinates, below the toolbar (which wraps on narrow screens).
    const toolbarBottom = wrapper.current?.querySelector('.map-toolbar')?.getBoundingClientRect().bottom ?? rect.top + 60;
    const view = {
      ...flow.screenToFlowPosition({ x: rect.left, y: toolbarBottom + 8 }),
      end: flow.screenToFlowPosition({ x: rect.right, y: rect.bottom }),
    };
    // Keep clear of the zoom controls in the corner.
    const controls = wrapper.current?.querySelector('.react-flow__controls')?.getBoundingClientRect();
    const avoid: Box[] = [];
    if (controls) {
      const a = flow.screenToFlowPosition({ x: controls.left, y: controls.top });
      const b = flow.screenToFlowPosition({ x: controls.right, y: controls.bottom });
      avoid.push({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y });
    }
    const spot = freeSpotInView(map, added[0].id, view, avoid);
    if (spot) commit(ops.setPositions(map, { [added[0].id]: spot }));
  }, [map]);

  const actions: Actions = {
    setText: (id, text) => commit(ops.setText(mapRef.current, id, text)),
    toggleConclusion: (id) => commit(ops.toggleConclusion(mapRef.current, id)),
    removeNode: (id) => commit(ops.removeNode(mapRef.current, id)),
    toggleType: (id) => commit(ops.toggleRelationType(mapRef.current, id)),
    reverse: (id) => {
      // Swap the two claims' positions too, so the arrow still points the way the layout flows.
      const current = mapRef.current;
      const r = current.relations.find((x) => x.id === id);
      const a = current.nodes.find((n) => n.id === r?.from[0]);
      const b = current.nodes.find((n) => n.id === r?.to);
      const swapped = a && b ? ops.setPositions(current, { [a.id]: b.position, [b.id]: a.position }) : current;
      commit(ops.reverseRelation(swapped, id));
    },
    removeRelation: (id) => commit(ops.removeRelation(mapRef.current, id)),
    linkPremise: (id, nodeId) => commit(ops.linkPremise(mapRef.current, id, nodeId)),
    split: (id) => commit(ops.splitRelation(mapRef.current, id)),
    setEvaluation: (id, evaluation) => commit(ops.setEvaluation(mapRef.current, id, evaluation)),
    removeEdge: (id) => commit(removeEdgeFromMap(mapRef.current, id)),
  };

  const onNodesChange = (changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
    const done: Record<string, { x: number; y: number }> = {};
    for (const c of changes) if (c.type === 'position' && c.position && c.dragging === false) done[c.id] = c.position;
    // Drag end reports dragging=false without a position; read the final position from our state.
    for (const c of changes) {
      if (c.type === 'position' && c.dragging === false && !c.position) {
        const n = nodes.find((x) => x.id === c.id);
        if (n) done[c.id] = n.position;
      }
    }
    if (Object.keys(done).length) commit(ops.setPositions(mapRef.current, done));
  };

  const onEdgesChange = (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds));

  // The claim a student starts dragging from is the premise and the one they drop on is
  // its target, whichever dot they use. (React Flow orders a connection by handle type,
  // which would reverse links dragged from a bottom dot.)
  const dragStart = useRef<string | null>(null);
  const onConnect = (c: Connection) => {
    const current = mapRef.current;
    const premise = dragStart.current ?? c.source;
    const other = c.source === premise ? c.target : c.source;
    if (!current.nodes.some((n) => n.id === premise)) return;
    if (current.relations.some((r) => r.id === other)) {
      commit(ops.addPremise(current, other, premise));
    } else {
      commit(ops.addRelation(current, linkType, [premise], other));
    }
  };

  const onDelete = ({ nodes: dn, edges: de }: { nodes: Node[]; edges: Edge[] }) => {
    let next = mapRef.current;
    for (const n of dn) next = n.type === 'junction' ? ops.removeRelation(next, n.id) : ops.removeNode(next, n.id);
    for (const e of de) next = removeEdgeFromMap(next, e.id);
    commit(next);
  };

  const exportPng = async () => {
    const viewport = wrapper.current?.querySelector<HTMLElement>('.react-flow__viewport');
    if (!viewport || !nodes.length) return;
    const bounds = getNodesBounds(nodes);
    const width = Math.round(bounds.width + 80);
    const height = Math.round(bounds.height + 80);
    const vp = getViewportForBounds(bounds, width, height, 1, 1, 40);
    const dataUrl = await toPng(viewport, {
      backgroundColor: '#ffffff',
      width,
      height,
      pixelRatio: 2,
      style: { width: `${width}px`, height: `${height}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
      filter: (el) => !(el instanceof HTMLElement && (el.classList.contains('node-tools') || el.classList.contains('react-flow__handle'))),
    });
    download(`${props.exportName ?? 'argument-map'}.png`, dataUrl);
  };

  const arrange = () => {
    commit(autoLayout(mapRef.current));
    setTimeout(() => flow.fitView({ padding: 0.15, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300 }), 50);
  };

  return (
    <ActionsContext.Provider value={actions}>
      <div className="map-editor" ref={wrapper} tabIndex={-1}>
        {/* Before the canvas, so keyboard users reach the tools first. */}
        <div className="map-toolbar" role="toolbar" aria-label="Map tools">
          {!fixed && !explanation && (
            <div className="segmented" role="group" aria-label="Type of new links">
              <span>New links:</span>
              <button aria-pressed={linkType === 'support'} className={linkType === 'support' ? 'on support' : ''} onClick={() => setLinkType('support')}>
                Support
              </button>
              <button aria-pressed={linkType === 'objection'} className={linkType === 'objection' ? 'on objection' : ''} onClick={() => setLinkType('objection')}>
                Objection
              </button>
            </div>
          )}
          {!readOnly && <button onClick={arrange}>Auto-arrange</button>}
          <button onClick={exportPng} disabled={!nodes.length}>Download image</button>
        </div>
        <ReactFlow
          aria-label="Map canvas (drag and drop). The outline view does the same with a keyboard."
          edgesFocusable={false}
          ariaLabelConfig={{
            'node.a11yDescription.default': 'Press Enter to select, then use the arrow keys to move it.',
            'node.a11yDescription.keyboardDisabled': 'Press Enter to select, then use the arrow keys to move it.',
            'node.a11yDescription.ariaLiveMessage': () => '',
          }}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={fixed ? undefined : onConnect}
          onConnectStart={(_, { nodeId }) => (dragStart.current = nodeId)}
          onConnectEnd={() => setTimeout(() => (dragStart.current = null))}
          connectionMode={ConnectionMode.Loose}
          onDelete={fixed ? undefined : onDelete}
          nodesDraggable={!readOnly}
          nodesConnectable={!fixed}
          elementsSelectable={!readOnly}
          deleteKeyCode={fixed ? null : ['Backspace', 'Delete']}
          connectionRadius={40}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} />
          <Controls showInteractive={false} />
          {!map.nodes.length && (
            <Panel position="top-center" className="empty-hint">
              Add claims from the passage to start your map.
            </Panel>
          )}
        </ReactFlow>
      </div>
    </ActionsContext.Provider>
  );
}

export function MapEditor(props: MapEditorProps) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}
