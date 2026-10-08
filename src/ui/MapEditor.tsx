import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  getNodesBounds,
  getViewportForBounds,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toPng } from 'html-to-image';
import type { ArgumentMap, RelationType } from '../model/types';
import { autoLayout } from '../model/layout';
import * as ops from '../model/ops';
import { download } from './exportMap';

type ClaimData = {
  text: string;
  /** Claim number shown in marked mode. */
  label?: string;
  originalText: string;
  isConclusion: boolean;
  readOnly: boolean;
};
type JunctionData = { type: RelationType; label: string; readOnly: boolean };
type ClaimNodeT = Node<ClaimData, 'claim'>;
type JunctionNodeT = Node<JunctionData, 'junction'>;

interface Actions {
  setText(id: string, text: string): void;
  toggleConclusion(id: string): void;
  removeNode(id: string): void;
  toggleType(relationId: string): void;
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
      <Handle type="source" position={Position.Top} />
      <div className="claim-head">
        {data.label && <span className="claim-number">{data.label}</span>}
        {data.isConclusion && <span className="conclusion-tag">Main conclusion</span>}
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
            <button className="nodrag icon" title="Reword this claim" onClick={() => { setDraft(data.text); setEditing(true); }}>
              ✎
            </button>
            <button className="nodrag icon" title="Remove from map" onClick={() => actions.removeNode(id)}>
              ×
            </button>
          </span>
        )}
      </div>
      {editing ? (
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
        <div className="claim-text" onDoubleClick={() => { if (!data.readOnly) { setDraft(data.text); setEditing(true); } }}>
          {data.text}
        </div>
      )}
      <Handle type="target" position={Position.Bottom} />
    </div>
  );
}

function JunctionNode({ id, data }: NodeProps<JunctionNodeT>) {
  const actions = useContext(ActionsContext)!;
  return (
    <div className={`junction junction-${data.type}`}>
      <Handle type="target" position={Position.Bottom} />
      <button
        className="nodrag"
        disabled={data.readOnly}
        title={data.readOnly ? undefined : 'Click to switch between support and objection'}
        onClick={() => actions.toggleType(id)}
      >
        {data.label}
      </button>
      <Handle type="source" position={Position.Top} />
    </div>
  );
}

const nodeTypes = { claim: ClaimNode, junction: JunctionNode };
const COLORS = { support: '#2f7d32', objection: '#c62828' };

export interface MapEditorProps {
  map: ArgumentMap;
  onChange?: (map: ArgumentMap) => void;
  readOnly?: boolean;
  /** Claim-number label for a node, if the lesson numbers its claims. */
  labelFor?: (nodeId: string) => string | undefined;
  originalTextFor: (nodeId: string) => string;
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
          label: props.labelFor?.(n.id),
          originalText: props.originalTextFor(n.id),
          isConclusion: map.conclusion === n.id,
          readOnly,
        },
      }),
    ),
    ...map.relations.map((r, i): JunctionNodeT => {
      const target = map.nodes.find((n) => n.id === r.to);
      const fallback = target ? { x: target.position.x + 70, y: target.position.y + 130 + i * 4 } : { x: 0, y: 0 };
      return {
        id: r.id,
        type: 'junction',
        position: r.position ?? fallback,
        ...keep(r.id),
        data: { type: r.type, label: ops.relationLabel(map, r.id), readOnly },
      };
    }),
  ];
}

function buildEdges(map: ArgumentMap, prev: Edge[]): Edge[] {
  const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id));
  return map.relations.flatMap((r) => {
    const stroke = COLORS[r.type];
    return [
      ...r.from.map((f) => ({
        id: `p|${r.id}|${f}`,
        source: f,
        target: r.id,
        style: { stroke, strokeWidth: 2 },
        selected: selected.has(`p|${r.id}|${f}`),
      })),
      {
        id: `o|${r.id}`,
        source: r.id,
        target: r.to,
        style: { stroke, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
        selected: selected.has(`o|${r.id}`),
      },
    ];
  });
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
    setEdges((prev) => buildEdges(map, prev));
  }, [map, readOnly]);

  const actions: Actions = {
    setText: (id, text) => commit(ops.setText(mapRef.current, id, text)),
    toggleConclusion: (id) => commit(ops.toggleConclusion(mapRef.current, id)),
    removeNode: (id) => commit(ops.removeNode(mapRef.current, id)),
    toggleType: (id) => commit(ops.toggleRelationType(mapRef.current, id)),
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

  const onConnect = (c: Connection) => {
    const current = mapRef.current;
    if (current.relations.some((r) => r.id === c.target)) {
      commit(ops.addPremise(current, c.target, c.source));
    } else if (current.nodes.some((n) => n.id === c.source)) {
      commit(ops.addRelation(current, linkType, [c.source], c.target));
    }
  };

  const onDelete = ({ nodes: dn, edges: de }: { nodes: Node[]; edges: Edge[] }) => {
    let next = mapRef.current;
    for (const n of dn) next = n.type === 'junction' ? ops.removeRelation(next, n.id) : ops.removeNode(next, n.id);
    for (const e of de) {
      const [kind, relId, nodeId] = e.id.split('|');
      next = kind === 'p' ? ops.removePremise(next, relId, nodeId) : ops.removeRelation(next, relId);
    }
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
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={readOnly ? undefined : onConnect}
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
