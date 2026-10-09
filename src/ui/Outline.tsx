import { useState } from 'react';
import type { ArgumentMap, MapNode, RelationType } from '../model/types';
import type { WordingEdit } from './MapEditor';
import * as ops from '../model/ops';

interface Props {
  map: ArgumentMap;
  onChange: (map: ArgumentMap) => void;
  nameFor: (nodeId: string) => string;
  editFor: (nodeId: string) => WordingEdit;
  /** Reword steps: the structure is fixed; only wording can change. */
  locked?: boolean;
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
export function Outline({ map, onChange, nameFor, editFor, locked }: Props) {
  const [premises, setPremises] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  const [type, setType] = useState<RelationType>('support');

  const add = () => {
    if (!premises.length || !target) return;
    onChange(ops.addRelation(map, type, premises.filter((p) => p !== target), target));
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
            {!locked && (
              <>
                <label>
                  <input type="radio" name="conclusion" checked={map.conclusion === n.id} onChange={() => onChange({ ...map, conclusion: n.id })} /> Main conclusion
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
            {!locked && (
              <>
            <button onClick={() => onChange(ops.toggleRelationType(map, r.id))}>Switch type</button>
            {r.from.length === 1 && <button onClick={() => onChange(ops.reverseRelation(map, r.id))}>Reverse</button>}
            {r.from.length > 1 && <button onClick={() => onChange(ops.splitRelation(map, r.id))}>Split</button>}
            <select
              aria-label="Link with another premise"
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
            Premise(s) — choose more than one for a linked argument:
            {map.nodes.map((n) => (
              <label key={n.id} className="check">
                <input
                  type="checkbox"
                  checked={premises.includes(n.id)}
                  onChange={(e) => setPremises(e.target.checked ? [...premises, n.id] : premises.filter((p) => p !== n.id))}
                />{' '}
                {nameFor(n.id)}
              </label>
            ))}
          </div>
          <label>
            Relation{' '}
            <select value={type} onChange={(e) => setType(e.target.value as RelationType)}>
              <option value="support">supports</option>
              <option value="objection">objects to / rebuts</option>
            </select>
          </label>{' '}
          <label>
            Target{' '}
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose a claim…</option>
              {map.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {nameFor(n.id)}
                </option>
              ))}
            </select>
          </label>{' '}
          <button onClick={add} disabled={!premises.length || !target}>
            Add link
          </button>
        </fieldset>
      )}
    </div>
  );
}
