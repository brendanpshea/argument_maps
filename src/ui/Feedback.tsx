import { vocab } from '../model/vocab';
import type { GradeResult } from '../grading/grade';
import type { ArgumentMap, Lesson } from '../model/types';

const ICON = { correct: '✓', partial: '½', wrong: '✗', missing: '○', note: 'ℹ' } as const;

interface Props {
  lesson: Lesson;
  map: ArgumentMap;
  result: GradeResult;
  /** A reword step: compare every claim, and (free rewording) ask the student to confirm. */
  rewordStep?: boolean;
  conclusionStep?: boolean;
  evaluateStep?: boolean;
  compared?: boolean;
  onCompared?: () => void;
}

export function Feedback({ lesson, map, result, rewordStep, conclusionStep, evaluateStep, compared, onCompared }: Props) {
  const pct = result.possible ? Math.round((100 * result.earned) / result.possible) : 0;
  const scored = result.items.filter((i) => i.status !== 'note' && i.status !== 'correct');
  const notes = result.items.filter((i) => i.status === 'note');
  const reworded = map.nodes.filter((n) => result.mapping[n.id] && n.text.trim() !== lesson.claims[result.mapping[n.id]].passageText.trim());
  const modelReworded = Object.values(lesson.claims).filter(
    (c) => c.modelText !== c.passageText && map.nodes.some((n) => result.mapping[n.id] === c.id),
  );
  const compare = rewordStep
    ? map.nodes.flatMap((n) => (result.mapping[n.id] ? [result.mapping[n.id]] : []))
    : [...new Set([...reworded.map((n) => result.mapping[n.id]), ...modelReworded.map((c) => c.id)])];
  const freeReword = rewordStep && lesson.rewording === 'free';

  return (
    <section className="feedback" aria-live="polite">
      <div className="score">
        {!freeReword && (
          <>
            <span className="score-number">{pct}%</span>
            <span>
              {result.earned} / {result.possible} points
            </span>
          </>
        )}
      </div>
      {freeReword ? null : scored.length === 0 ? (
        <p className="all-correct">
          {conclusionStep
            ? `Yes, that's the ${vocab(lesson.kind).conclusion}.`
            : rewordStep
              ? 'All claims are clearly worded.'
              : evaluateStep
                ? 'All your evaluations are right.'
                : 'Your map is correct.'}
        </p>
      ) : (
        <ul className="grade-items">
          {scored.map((item, i) => (
            <li key={i} className={`grade-${item.status}`}>
              <span className="grade-icon" aria-hidden>{ICON[item.status]}</span>
              {item.message}
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <>
          <h4>Also worth a look (no points)</h4>
          <ul className="grade-items">
            {notes.map((item, i) => (
              <li key={i} className="grade-note">
                <span className="grade-icon" aria-hidden>{ICON.note}</span>
                {item.message}
              </li>
            ))}
          </ul>
        </>
      )}
      {scored.length > 0 && (
        <p className="hint">
          {conclusionStep
            ? 'Pick another claim and check again.'
            : rewordStep
              ? 'Choose a better wording and check again.'
              : evaluateStep
                ? 'Click a link’s label to change your evaluation, then check again.'
                : 'Revise your map and check again.'}
        </p>
      )}
      {/* Model wording could give away claims or structure, so it appears only once the map is right. */}
      {lesson.rewording === 'free' && scored.length === 0 && compare.length > 0 && (
        <details className="wording" open={freeReword}>
          <summary>Compare your wording with the model wording</summary>
          <p className="hint">Wording isn't scored. A good restatement is clear on its own, keeps the author's meaning, and drops pronouns and filler.</p>
          <table>
            <thead>
              <tr>
                <th>Yours</th>
                <th>Model</th>
              </tr>
            </thead>
            <tbody>
              {compare.map((claimId) => (
                <tr key={claimId}>
                  <td>{map.nodes.find((n) => result.mapping[n.id] === claimId)?.text}</td>
                  <td>{lesson.claims[claimId].modelText}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {freeReword && (
            <label className="compared">
              <input type="checkbox" checked={!!compared} disabled={compared} onChange={() => onCompared?.()} /> I've compared each of my
              restatements with the model wording.
            </label>
          )}
        </details>
      )}
    </section>
  );
}
