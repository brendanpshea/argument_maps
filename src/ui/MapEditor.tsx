import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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
import type { ArgumentMap, MapRelation, RelationType } from '../model/types';
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
  readOnly: boolean;
};
type JunctionData = { type: RelationType; label: string; premises: number; readOnly: boolean };
type LinkEdgeT = Edge<{ readOnly: boolean; title: string }, 'link'>;
type ClaimNodeT = Node<ClaimData, 'claim'>;
type JunctionNodeT = Node<JunctionData, 'junction'>;

interface Actions {
  setText(id: string, text: string): void;
  toggleConclusion(id: string): void;
  removeNode(id: string): void;
  toggleType(relationId: string): void;
  reverse(relationId: string): void;
  removeRelation(relationId: string): void;
  removeEdge(edgeId: string): void;
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
    <div className={`claim-node${data.isConclusion ? ' is-conclusion' : ''}${selected ? ' is-selected' : ''}`}>
      <SideHandles />
      <div className="claim-head">
        {data.label && <span className="claim-number">{data.label}</span>}
        {data.isConclusion && <span className="conclusion-tag">Main conclusion</span>}
        {data.tag && <span className="claim-tag">{data.tag}</span>}
        {reworded && <span className="reworded-tag" title={`Passage: “${data.originalText}”`}>reworded</span>}
        {!data.readOnly && (
          <span className="node-tools">
            <button
              className="nodrag icon"
              title={data.isConclusion ? 'Unmark main conclusion' : 'Mark as main conclusion'}
              aria-pressed={data.isConclusion}
              onClick={() => actions.toggleConclusion(id)}
            >
              ★
            </button>
            {data.edit.kind !== 'none' && (
              <button
                className="nodrag icon"
                title={data.edit.kind === 'choose' ? 'Choose a wording' : 'Reword this claim'}
                aria-pressed={editing}
                onClick={() => { setDraft(data.text); setEditing(!editing); }}
              >
                ✎
              </button>
            )}
            <button className="nodrag icon" title="Remove from map" onClick={() => actions.removeNode(id)}>
              ×
            </button>
          </span>
        )}
      </div>
      {editing && data.edit.kind === 'choose' ? (
        <div className="nodrag wording-choices" role="radiogroup" aria-label="Choose a wording">
          {[data.originalText, ...data.edit.choices.filter((c) => c !== data.originalText)].map((choice, i) => (
            <button
              key={i}
              role="radio"
              aria-checked={choice === data.text}
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

function JunctionNode({ id, data, selected }: NodeProps<JunctionNodeT>) {
  const actions = useContext(ActionsContext)!;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!selected) setOpen(false);
  }, [selected]);
  const act = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className={`junction junction-${data.type}`}>
      <SideHandles />
      <button
        className="nodrag"
        disabled={data.readOnly}
        aria-haspopup="menu"
        aria-expanded={open}
        title={data.readOnly ? undefined : 'Change or delete this link'}
        onClick={() => setOpen(!open)}
      >
        {data.label}
      </button>
      {open && (
        <div className="link-menu nodrag" role="menu">
          <button role="menuitem" onClick={act(() => actions.toggleType(id))}>
            Change to {data.type === 'support' ? 'objection' : 'support'}
          </button>
          {data.premises === 1 && (
            <button role="menuitem" onClick={act(() => actions.reverse(id))}>
              Reverse direction
            </button>
          )}
          <button role="menuitem" className="danger" onClick={act(() => actions.removeRelation(id))}>
            Delete link
          </button>
        </div>
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
const COLORS = { support: '#2f7d32', objection: '#c62828' };

export interface MapEditorProps {
  map: ArgumentMap;
  onChange?: (map: ArgumentMap) => void;
  readOnly?: boolean;
  /** Claim-number label for a node, if the lesson numbers its claims. */
  labelFor?: (nodeId: string) => string | undefined;
  originalTextFor: (nodeId: string) => string;
  editFor: (nodeId: string) => WordingEdit;
  tagFor?: (nodeId: string) => string | undefined;
  exportName?: string;
}

function buildNodes(map: ArgumentMap, props: MapEditorProps, prev: Node[]): Node[] {
  const old = new Map(prev.map((n) => [n.id, n]));
  const keep = (id: string) => {
    const o = old.get(id);
    return o ? { measured: o.measured, selected: o.selected } : {};
  };
  const readOnly = !!props.readOnly;
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
          readOnly,
        },
      }),
    ),
    ...map.relations.map((r): JunctionNodeT => {
      return {
        id: r.id,
        type: 'junction',
        position: junctionPosition(map, r),
        ...keep(r.id),
        data: { type: r.type, label: ops.relationLabel(map, r.id), premises: r.from.length, readOnly },
      };
    }),
  ];
}

/** Where a link's label sits: its saved position, or midway between its premises and its target. */
function junctionPosition(map: ArgumentMap, r: MapRelation): { x: number; y: number } {
  if (r.position) return r.position;
  const ends = [...r.from, r.to].flatMap((id) => map.nodes.filter((n) => n.id === id));
  if (!ends.length) return { x: 0, y: 0 };
  const cx = ends.reduce((sum, n) => sum + n.position.x, 0) / ends.length + CLAIM_SIZE.width / 2;
  const cy = ends.reduce((sum, n) => sum + n.position.y, 0) / ends.length + CLAIM_SIZE.height / 2;
  return { x: cx - JUNCTION_SIZE.width / 2, y: cy - JUNCTION_SIZE.height / 2 };
}

function buildEdges(map: ArgumentMap, prev: Edge[], readOnly: boolean): LinkEdgeT[] {
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
    if (Math.abs(dx) > Math.abs(dy) * 1.5) {
      return dx > 0 ? { sourceHandle: 'right', targetHandle: 'left' } : { sourceHandle: 'left', targetHandle: 'right' };
    }
    return dy >= 0 ? { sourceHandle: 'bottom', targetHandle: 'top' } : { sourceHandle: 'top', targetHandle: 'bottom' };
  };
  return map.relations.flatMap((r): LinkEdgeT[] => {
    const stroke = COLORS[r.type];
    const linked = r.from.length > 1;
    return [
      ...r.from.map((f): LinkEdgeT => ({
        id: `p|${r.id}|${f}`,
        type: 'link',
        source: f,
        target: r.id,
        ...handles(f, r.id),
        style: { stroke },
        selected: selected.has(`p|${r.id}|${f}`),
        data: { readOnly, title: linked ? 'Remove this premise from the link' : 'Delete this link' },
      })),
      {
        id: `o|${r.id}`,
        type: 'link',
        source: r.id,
        target: r.to,
        ...handles(r.id, r.to),
        style: { stroke },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
        selected: selected.has(`o|${r.id}`),
        data: { readOnly, title: 'Delete this link' },
      },
    ];
  });
}

/** Applies the deletion of one edge: a premise line removes that premise; the arrow removes the whole link. */
function removeEdgeFromMap(map: ArgumentMap, edgeId: string): ArgumentMap {
  const [kind, relId, nodeId] = edgeId.split('|');
  return kind === 'p' ? ops.removePremise(map, relId, nodeId) : ops.removeRelation(map, relId);
}

function Editor(props: MapEditorProps) {
  const { map, readOnly } = props;
  const mapRef = useRef(map);
  mapRef.current = map;
  const commit = useCallback((next: ArgumentMap) => props.onChange?.(next), [props.onChange]);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [linkType, setLinkType] = useState<RelationType>('support');
  const wrapper = useRef<HTMLDivElement>(null);
  const flow = useReactFlow();

  useEffect(() => {
    setNodes((prev) => buildNodes(map, props, prev));
    setEdges((prev) => buildEdges(map, prev, !!readOnly));
  }, [map, readOnly]);

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
    setTimeout(() => flow.fitView({ padding: 0.15, duration: 300 }), 50);
  };

  return (
    <ActionsContext.Provider value={actions}>
      <div className="map-editor" ref={wrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={readOnly ? undefined : onConnect}
          onConnectStart={(_, { nodeId }) => (dragStart.current = nodeId)}
          onConnectEnd={() => setTimeout(() => (dragStart.current = null))}
          connectionMode={ConnectionMode.Loose}
          onDelete={readOnly ? undefined : onDelete}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable={!readOnly}
          deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
          connectionRadius={40}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} />
          <Controls showInteractive={false} />
          <Panel position="top-left" className="map-toolbar">
            {!readOnly && (
              <div className="segmented" role="radiogroup" aria-label="Type of new links">
                <span>New links:</span>
                <button role="radio" aria-checked={linkType === 'support'} className={linkType === 'support' ? 'on support' : ''} onClick={() => setLinkType('support')}>
                  Support
                </button>
                <button role="radio" aria-checked={linkType === 'objection'} className={linkType === 'objection' ? 'on objection' : ''} onClick={() => setLinkType('objection')}>
                  Objection
                </button>
              </div>
            )}
            {!readOnly && <button onClick={arrange}>Auto-arrange</button>}
            <button onClick={exportPng} disabled={!nodes.length}>Download image</button>
          </Panel>
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
