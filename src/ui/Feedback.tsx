import type { GradeResult } from '../grading/grade';
import type { ArgumentMap, Lesson } from '../model/types';

const ICON = { correct: '✓', partial: '½', wrong: '✗', missing: '○', note: 'ℹ' } as const;

interface Props {
  lesson: Lesson;
  map: ArgumentMap;
  result: GradeResult;
}

export function Feedback({ lesson, map, result }: Props) {
  const pct = result.possible ? Math.round((100 * result.earned) / result.possible) : 0;
  const scored = result.items.filter((i) => i.status !== 'note' && i.status !== 'correct');
  const notes = result.items.filter((i) => i.status === 'note');
  const reworded = map.nodes.filter((n) => result.mapping[n.id] && n.text.trim() !== lesson.claims[result.mapping[n.id]].passageText.trim());
  const modelReworded = Object.values(lesson.claims).filter(
    (c) => c.modelText !== c.passageText && map.nodes.some((n) => result.mapping[n.id] === c.id),
  );
  const compare = [...new Set([...reworded.map((n) => result.mapping[n.id]), ...modelReworded.map((c) => c.id)])];

  return (
    <section className="feedback" aria-live="polite">
      <div className="score">
        <span className="score-number">{pct}%</span>
        <span>
          {result.earned} / {result.possible} points
        </span>
      </div>
      {scored.length === 0 ? (
        <p className="all-correct">Everything in the model answer is on your map.</p>
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
      {compare.length > 0 && (
        <details className="wording">
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
        </details>
      )}
    </section>
  );
}
