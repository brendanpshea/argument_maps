import { useRef, useState } from 'react';
import type { ArgumentMap, LessonKind, MapNode, RelationType } from '../model/types';
import { vocab } from '../model/vocab';
import { EvaluationPicker, type WordingEdit } from './MapEditor';
import * as ops from '../model/ops';
import { claimStatuses, STATUS_LABEL, STATUS_TITLE } from '../model/dialectic';
import { evaluationWords, linkSentence } from '../model/describe';

interface Props {
  /** Argument or explanation lesson: sets link types and wording. */
  kind?: LessonKind;
  map: ArgumentMap;
  onChange: (map: ArgumentMap) => void;
  /** A claim's full name, e.g. "(3) “Large animals suffer in captivity”". */
  nameFor: (nodeId: string) => string;
  /** A claim's number, e.g. "(3)", if the lesson numbers its claims. */
  labelFor?: (nodeId: string) => string | undefined;
  /** E.g. "unstated" for claim-bank claims. */
  tagFor?: (nodeId: string) => string | undefined;
  editFor: (nodeId: string) => WordingEdit;
  /** Reword and evaluate steps: the structure is fixed. */
  locked?: boolean;
  /** Evaluate steps: what to ask about a link, or null if it isn't evaluated. */
  evaluateFor?: (relationId: string) => 'type' | 'full' | null;
}

function ClaimWording({ node, edit, label, onChange }: { node: MapNode; edit: WordingEdit; label: string; onChange: (text: string) => void }) {
  const id = `text-${node.id}`;
  // Fixed wording is already shown in the claim's line.
  if (edit.kind === 'none') return null;
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
 * drag-and-drop canvas. Every action is a labelled control, and focus stays
 * somewhere sensible after each change.
 */
export function Outline({ map, onChange, nameFor, labelFor, tagFor, editFor, locked, evaluateFor, kind = 'argument' }: Props) {
  const V = vocab(kind);
  const explanation = kind === 'explanation';
  const [premises, setPremises] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  const [type, setType] = useState<RelationType>(explanation ? 'explanation' : 'support');
  const [error, setError] = useState('');
  const [linkWith, setLinkWith] = useState<Record<string, string>>({});
  const claimsHeading = useRef<HTMLHeadingElement>(null);
  const linksHeading = useRef<HTMLHeadingElement>(null);
  const firstSource = useRef<HTMLInputElement>(null);
  const statuses = claimStatuses(map.relations);
  const focusLater = (el: { current: HTMLElement | null }) => requestAnimationFrame(() => el.current?.focus());

  // Choices for claims since removed from the map don't count.
  const onMap = (id: string) => map.nodes.some((n) => n.id === id);
  const sources = premises.filter(onMap);
  const targetId = onMap(target) ? target : '';
  const add = () => {
    if (!sources.length || !targetId) {
      setError(`Tick at least one claim above and choose a target first.`);
      return;
    }
    if (sources.includes(targetId)) {
      setError(`A claim can't ${explanation ? 'explain' : 'bear on'} itself: untick ${nameFor(targetId)} or choose another target.`);
      return;
    }
    setError('');
    onChange(ops.addRelation(map, type, sources, targetId));
    setPremises([]);
    focusLater(firstSource);
  };
  const sentence = (r: ArgumentMap['relations'][number]) => {
    const judged = evaluationWords(r);
    return `${linkSentence(map, r, nameFor)}${judged ? ` (judged ${judged})` : ''}`;
  };

  return (
    <div className="outline">
      <h3 ref={claimsHeading} tabIndex={-1}>
        Claims
      </h3>
      {!map.nodes.length && <p className="hint">No claims yet.</p>}
      <ul className="outline-claims">
        {map.nodes.map((n) => {
          const status = statuses.get(n.id);
          const isConclusion = map.conclusion === n.id;
          const tag = tagFor?.(n.id);
          return (
            <li key={n.id}>
              <p className="outline-claim">
                {labelFor?.(n.id) && <strong>{labelFor(n.id)} </strong>}
                {isConclusion && <span className="conclusion-tag">{V.Conclusion}: </span>}
                {tag && <span className="claim-tag">{tag}: </span>}
                {editFor(n.id).kind === 'none' && n.text}
                {status && (
                  <span className={`outline-status ${status}`} title={STATUS_TITLE[status]}>
                    {' '}
                    <span aria-hidden="true">{STATUS_LABEL[status].split(' ')[0]} </span>
                    {status}
                  </span>
                )}
              </p>
              <ClaimWording node={n} edit={editFor(n.id)} label={`Wording of ${nameFor(n.id)}`} onChange={(text) => onChange(ops.setText(map, n.id, text))} />
              {!locked && (
                <div className="outline-claim-actions">
                  <label>
                    <input
                      type="radio"
                      name="conclusion"
                      checked={isConclusion}
                      aria-label={`${V.Conclusion}: ${nameFor(n.id)}`}
                      onChange={() => onChange({ ...map, conclusion: n.id })}
                    />{' '}
                    {V.Conclusion}
                  </label>
                  {isConclusion && (
                    <button onClick={() => onChange({ ...map, conclusion: undefined })} aria-label={`Unmark ${nameFor(n.id)} as the ${V.conclusion}`}>
                      Unmark
                    </button>
                  )}
                  <button
                    aria-label={`Remove ${nameFor(n.id)} from the map`}
                    onClick={() => {
                      onChange(ops.removeNode(map, n.id));
                      focusLater(claimsHeading);
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <h3 ref={linksHeading} tabIndex={-1}>
        Links
      </h3>
      {!map.relations.length && <p className="hint">No links yet.</p>}
      <ul className="outline-links">
        {map.relations.map((r) => {
          const descId = `link-${r.id}`;
          const candidates = map.nodes.filter((n) => n.id !== r.to && !r.from.includes(n.id));
          const chosen = candidates.some((n) => n.id === linkWith[r.id]) ? linkWith[r.id] : '';
          return (
            <li key={r.id}>
              <span id={descId}>
                <span className={`outline-link-type ${r.type}`}>{sentence(r)}</span>
              </span>
              {evaluateFor?.(r.id) && (
                <EvaluationPicker
                  className="outline-eval"
                  label={linkSentence(map, r, nameFor)}
                  ask={evaluateFor(r.id)!}
                  value={r.evaluation ?? {}}
                  onChange={(next) => onChange(ops.setEvaluation(map, r.id, next))}
                />
              )}
              {!locked && (
                <div className="outline-link-actions">
                  {r.type !== 'explanation' && (
                    <button aria-describedby={descId} onClick={() => onChange(ops.toggleRelationType(map, r.id))}>
                      Switch to {r.type === 'support' ? 'objection' : 'support'}
                    </button>
                  )}
                  {r.from.length === 1 && (
                    <button aria-describedby={descId} onClick={() => onChange(ops.reverseRelation(map, r.id))}>
                      Reverse
                    </button>
                  )}
                  {r.from.length > 1 && (
                    <button aria-describedby={descId} onClick={() => onChange(ops.splitRelation(map, r.id))}>
                      Split
                    </button>
                  )}
                  {candidates.length > 0 && (
                    <span className="link-with">
                      <select
                        aria-label={`${V.linkWith} (${linkSentence(map, r, nameFor)})`}
                        value={chosen}
                        onChange={(e) => setLinkWith({ ...linkWith, [r.id]: e.target.value })}
                      >
                        <option value="">{V.linkWith}</option>
                        {candidates.map((n) => (
                          <option key={n.id} value={n.id}>
                            {nameFor(n.id)}
                          </option>
                        ))}
                      </select>
                      <button aria-describedby={descId} disabled={!chosen} onClick={() => onChange(ops.linkPremise(map, r.id, chosen))}>
                        Link
                      </button>
                    </span>
                  )}
                  <button
                    aria-describedby={descId}
                    onClick={() => {
                      onChange(ops.removeRelation(map, r.id));
                      focusLater(linksHeading);
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!locked && map.nodes.length >= 2 && (
        <fieldset className="add-link">
          <legend>Add a link</legend>
          <fieldset className="add-link-sources">
            <legend>{V.chooseSources}</legend>
            {map.nodes.map((n, i) => (
              <label key={n.id} className="check">
                <input
                  ref={i === 0 ? firstSource : undefined}
                  type="checkbox"
                  checked={sources.includes(n.id)}
                  onChange={(e) => setPremises(e.target.checked ? [...sources, n.id] : sources.filter((p) => p !== n.id))}
                />{' '}
                {nameFor(n.id)}
              </label>
            ))}
          </fieldset>
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
          <button onClick={add} aria-disabled={!sources.length || !targetId} className={!sources.length || !targetId ? 'is-disabled' : ''}>
            Add link
          </button>
          <p className="hint" aria-live="polite">
            {error}
          </p>
        </fieldset>
      )}
    </div>
  );
}
