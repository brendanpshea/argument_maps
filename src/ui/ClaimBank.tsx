import { isBank, type Claim, type Lesson } from '../model/types';
import { stableShuffle } from '../model/shuffle';

interface Props {
  lesson: Lesson;
  stepIndex: number;
  /** Bank claim ids already on the student's map. */
  used: string[];
  readOnly?: boolean;
  onAdd: (claim: Claim) => void;
}

/** Claims that are not in the passage: unstated premises the argument needs, plus decoys. */
export function ClaimBank({ lesson, stepIndex, used, readOnly, onAdd }: Props) {
  const available = Object.values(lesson.claims).filter((c) => isBank(c.source) && (c.bankStep ?? 0) <= stepIndex);
  if (!available.length) return null;
  const claims = stableShuffle(available, (c) => c.id, lesson.id);
  return (
    <section className="claim-bank" aria-labelledby="claim-bank-heading">
      <h2 id="claim-bank-heading">Claim bank</h2>
      <p className="hint">
        Arguments often rely on claims the author never states. Add any the argument needs. Not all of these are needed.
      </p>
      <ul>
        {claims.map((c) => {
          const inMap = used.includes(c.id);
          return (
            <li key={c.id}>
              <span>{c.passageText}</span>
              <button
                disabled={readOnly || inMap}
                aria-label={inMap ? `Added: ${c.passageText}` : `Add to map: ${c.passageText}`}
                onClick={(e) => {
                  // The button disables itself; move keyboard focus to the next claim in the bank.
                  const buttons = [...(e.currentTarget.closest('ul')?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
                  const here = buttons.indexOf(e.currentTarget);
                  onAdd(c);
                  requestAnimationFrame(() =>
                    [...buttons.slice(here + 1), ...buttons.slice(0, here)].find((b) => !b.disabled)?.focus(),
                  );
                }}
              >
                {inMap ? 'Added' : 'Add'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
