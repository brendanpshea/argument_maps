import { useState } from 'react';
import type { ArgumentMap, LessonKind, MapNode, RelationType } from '../model/types';
import { vocab } from '../model/vocab';
import { EvaluationPicker, type WordingEdit } from './MapEditor';
import * as ops from '../model/ops';
import { claimStatuses, STATUS_LABEL, STATUS_TITLE } from '../model/dialectic';

interface Props {
  /** Argument or explanation lesson: sets link types and wording. */
  kind?: LessonKind;
  map: ArgumentMap;
  onChange: (map: ArgumentMap) => void;
  nameFor: (nodeId: string) => string;
  editFor: (nodeId: string) => WordingEdit;
  /** Reword and evaluate steps: the structure is fixed. */
  locked?: boolean;
  /** Evaluate steps: what to ask about a link, or null if it isn't evaluated. */
  evaluateFor?: (relationId: string) => 'type' | 'full' | null;
}

function ClaimWording({ node, edit, label, onChange }: { node: MapNode; edit: WordingEdit; label: string; onChange: (text: string) => void }) {
  const id = `text-${node.id}`;
  if (edit.kind === 'none') return <p className="outline-text">{node.text}</p>;
  return (
    <>
      <label className="visually-hidden" htmlFor={id}>
        {label}
      </label>
      {edit.kind === 'choose' ? (
        <select id={id} value={node.text} onChange={(e) => onChange(e.target.value)}>
          {[...new Set([node.text, ...edit.choices])].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      ) : (
        <textarea
          id={id}
          rows={2}
          defaultValue={node.text}
          key={node.text}
          onBlur={(e) => e.target.value.trim() && e.target.value !== node.text && onChange(e.target.value.trim())}
        />
      )}
    </>
  );
}

/**
 * A keyboard- and screen-reader-friendly way to build the same map as the
 * drag-and-drop canvas.
 */
export function Outline({ map, onChange, nameFor, editFor, locked, evaluateFor, kind = 'argument' }: Props) {
  const explanation = kind === 'explanation';
  const [premises, setPremises] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  const [type, setType] = useState<RelationType>(explanation ? 'explanation' : 'support');
  const statuses = claimStatuses(map.relations);

  // Choices for claims since removed from the map don't count.
  const onMap = (id: string) => map.nodes.some((n) => n.id === id);
  const sources = premises.filter(onMap);
  const targetId = onMap(target) ? target : '';
  const add = () => {
    if (!sources.length || !targetId) return;
    onChange(ops.addRelation(map, type, sources.filter((p) => p !== targetId), targetId));
    setPremises([]);
  };

  return (
    <div className="outline">
      <h3>Claims</h3>
      {!map.nodes.length && <p className="hint">No claims yet.</p>}
      <ul className="outline-claims">
        {map.nodes.map((n) => (
          <li key={n.id}>
            <ClaimWording node={n} edit={editFor(n.id)} label={`Wording of claim ${nameFor(n.id)}`} onChange={(text) => onChange(ops.setText(map, n.id, text))} />
            {statuses.has(n.id) && (
              <span className={`outline-status ${statuses.get(n.id)}`} title={STATUS_TITLE[statuses.get(n.id)!]}>
                {STATUS_LABEL[statuses.get(n.id)!]}
              </span>
            )}
            {!locked && (
              <>
                <label>
                  <input type="radio" name="conclusion" checked={map.conclusion === n.id} onChange={() => onChange({ ...map, conclusion: n.id })} /> {vocab(kind).Conclusion}
                </label>
                <button onClick={() => onChange(ops.removeNode(map, n.id))}>Remove</button>
              </>
            )}
          </li>
        ))}
      </ul>

      <h3>Links</h3>
      {!map.relations.length && <p className="hint">No links yet.</p>}
      <ul className="outline-links">
        {map.relations.map((r) => (
          <li key={r.id}>
            <span>
              {r.from.map(nameFor).join(' + ')} <strong className={r.type}>{ops.relationLabel(map, r.id)}</strong> {nameFor(r.to)}
            </span>
            {evaluateFor?.(r.id) && (
              <EvaluationPicker
                className="outline-eval"
                ask={evaluateFor(r.id)!}
                value={r.evaluation ?? {}}
                onChange={(next) => onChange(ops.setEvaluation(map, r.id, next))}
              />
            )}
            {!locked && (
              <>
            {r.type !== 'explanation' && <button onClick={() => onChange(ops.toggleRelationType(map, r.id))}>Switch type</button>}
            {r.from.length === 1 && <button onClick={() => onChange(ops.reverseRelation(map, r.id))}>Reverse</button>}
            {r.from.length > 1 && <button onClick={() => onChange(ops.splitRelation(map, r.id))}>Split</button>}
            <select
              aria-label={vocab(kind).linkWith}
              value=""
              onChange={(e) => e.target.value && onChange(ops.linkPremise(map, r.id, e.target.value))}
            >
              <option value="">Link with…</option>
              {map.nodes
                .filter((n) => n.id !== r.to && !r.from.includes(n.id))
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {nameFor(n.id)}
                  </option>
                ))}
            </select>
            <button onClick={() => onChange(ops.removeRelation(map, r.id))}>Remove</button>
              </>
            )}
          </li>
        ))}
      </ul>

      {!locked && map.nodes.length >= 2 && (
        <fieldset className="add-link">
          <legend>Add a link</legend>
          <div>
            {vocab(kind).chooseSources}
            {map.nodes.map((n) => (
              <label key={n.id} className="check">
                <input
                  type="checkbox"
                  checked={sources.includes(n.id)}
                  onChange={(e) => setPremises(e.target.checked ? [...premises, n.id] : premises.filter((p) => p !== n.id))}
                />{' '}
                {nameFor(n.id)}
              </label>
            ))}
          </div>
          <label>
            Relation{' '}
            <select value={type} onChange={(e) => setType(e.target.value as RelationType)}>
              {explanation ? (
                <option value="explanation">explains</option>
              ) : (
                <>
                  <option value="support">supports</option>
                  <option value="objection">objects to / rebuts</option>
                </>
              )}
            </select>
          </label>{' '}
          <label>
            Target{' '}
            <select value={targetId} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose a claim…</option>
              {map.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {nameFor(n.id)}
                </option>
              ))}
            </select>
          </label>{' '}
          <button onClick={add} disabled={!sources.length || !targetId}>
            Add link
          </button>
        </fieldset>
      )}
    </div>
  );
}
