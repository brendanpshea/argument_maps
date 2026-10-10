import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isBank, type Claim, type Lesson, type Span } from '../model/types';

interface Props {
  lesson: Lesson;
  /** Show passage segments 0..stepIndex. */
  stepIndex: number;
  /** Spans already on the student's map (highlighted in the text). */
  usedSpans: Span[];
  readOnly?: boolean;
  /** Label for the highlight-mode button (default "Add claim"). */
  addLabel?: string;
  onAddClaim: (span: Span, text: string) => void;
}

/** Offset of (node, offset) measured in characters from the start of `root`. */
function textOffset(root: HTMLElement, node: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

function MarkedSegment({ lesson, segment, usedSpans, readOnly, onAddClaim }: Omit<Props, 'stepIndex'> & { segment: number }) {
  const text = lesson.steps[segment].passage;
  const claims = Object.values(lesson.claims)
    .flatMap((c) => (isBank(c.source) || c.source.segment !== segment ? [] : [{ ...c, span: c.source }]))
    .sort((a, b) => a.span.start - b.span.start);
  const inMap = (c: Claim & { span: Span }) => usedSpans.some((s) => s.segment === segment && s.start === c.span.start && s.end === c.span.end);
  const parts: ReactNode[] = [];
  let pos = 0;
  for (const c of claims) {
    parts.push(text.slice(pos, c.span.start));
    const used = inMap(c);
    parts.push(
      <span
        key={c.id}
        role="button"
        tabIndex={readOnly || used ? -1 : 0}
        aria-disabled={readOnly || used}
        className={`passage-claim${used ? ' in-map' : ''}`}
        title={used ? 'Already on your map' : 'Add this claim to your map'}
        onClick={() => !readOnly && !used && onAddClaim(c.span, c.passageText)}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !readOnly && !used) {
            e.preventDefault();
            onAddClaim(c.span, c.passageText);
          }
        }}
      >
        <span className="claim-number">({c.number})</span> {c.passageText}
      </span>,
    );
    pos = c.span.end;
  }
  parts.push(text.slice(pos));
  return <div className="passage-text">{parts}</div>;
}

function HighlightSegment({ lesson, segment, usedSpans, readOnly, addLabel, onAddClaim }: Omit<Props, 'stepIndex'> & { segment: number }) {
  const text = lesson.steps[segment].passage;
  const ref = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Span | null>(null);

  const [note, setNote] = useState('');
  // Follow the selection however it's made (mouse, touch, keyboard, or a screen reader).
  // Selecting text in another part of the passage replaces this part's pending selection.
  // (A collapsed selection doesn't count: tapping the Add button can collapse it on touch screens.)
  useEffect(() => {
    const onChange = () => {
      const sel = window.getSelection();
      const root = ref.current;
      if (!sel || sel.isCollapsed || !root) return;
      if (root.contains(sel.anchorNode) && root.contains(sel.focusNode)) capture();
      else if (!root.contains(sel.anchorNode)) setPending(null);
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, []);

  // A keyboard alternative to selecting text: choose the claim's first and last words.
  const words = [...text.matchAll(/\S+/g)].map((m) => ({ start: m.index!, end: m.index! + m[0].length, text: m[0] }));
  const [first, setFirst] = useState(-1);
  const [last, setLast] = useState(-1);
  const choose = (f: number, l: number) => {
    setFirst(f);
    setLast(l);
    setNote('');
    setPending(f >= 0 && l >= f ? { segment, start: words[f].start, end: words[l].end } : null);
  };
  const context = (i: number, dir: 1 | -1) =>
    (dir === 1 ? words.slice(i, i + 5) : words.slice(Math.max(0, i - 4), i + 1)).map((w) => w.text).join(' ');

  const capture = () => {
    const sel = window.getSelection();
    const root = ref.current;
    if (!sel || sel.isCollapsed || !root || !root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) {
      setPending(null);
      return;
    }
    const r = sel.getRangeAt(0);
    const start = textOffset(root, r.startContainer, r.startOffset);
    const end = textOffset(root, r.endContainer, r.endOffset);
    setPending(end - start > 1 ? { segment, start, end } : null);
  };

  // Split the text at every boundary of a used span so covered pieces can be marked.
  const spans = usedSpans.filter((s) => s.segment === segment);
  const cuts = [...new Set([0, text.length, ...spans.flatMap((s) => [s.start, s.end])])].sort((a, b) => a - b);
  const pieces = cuts.slice(0, -1).map((start, i) => {
    const end = cuts[i + 1];
    const covered = spans.some((s) => s.start <= start && s.end >= end);
    const piece = text.slice(start, end);
    return covered ? <mark key={start}>{piece}</mark> : <span key={start}>{piece}</span>;
  });

  return (
    <div>
      <div className="passage-text selectable" ref={ref} onMouseUp={capture} onKeyUp={capture} onTouchEnd={capture}>
        {pieces}
      </div>
      {!readOnly && (
        <div className="highlight-actions">
          <button
            className="primary"
            aria-disabled={!pending}
            onClick={() => {
              if (!pending) {
                setNote('Select the words of a claim in the passage first, or choose them with “Choose the words”.');
                return;
              }
              onAddClaim(pending, text.slice(pending.start, pending.end).trim());
              window.getSelection()?.removeAllRanges();
              setPending(null);
              setFirst(-1);
              setLast(-1);
            }}
          >
            {addLabel ?? 'Add claim'}
          </button>
          <span className="hint" aria-live="polite">
            {note || (pending ? `Selected: “${text.slice(pending.start, pending.end).trim()}”` : 'Select the text of a claim in this passage.')}
          </span>
          <details className="word-picker">
            <summary>Choose the words (keyboard)</summary>
            <label>
              First word{' '}
              <select value={first} onChange={(e) => choose(Number(e.target.value), Math.max(Number(e.target.value), last))}>
                <option value={-1}>Choose…</option>
                {words.map((_, i) => (
                  <option key={i} value={i}>
                    {context(i, 1)}…
                  </option>
                ))}
              </select>
            </label>
            <label>
              Last word{' '}
              <select value={last} disabled={first < 0} onChange={(e) => choose(first, Number(e.target.value))}>
                {words.map((_, i) =>
                  i < Math.max(first, 0) ? null : (
                    <option key={i} value={i}>
                      …{context(i, -1)}
                    </option>
                  ),
                )}
              </select>
            </label>
          </details>
        </div>
      )}
    </div>
  );
}

export function Passage(props: Props) {
  const Segment = props.lesson.claimMode === 'marked' ? MarkedSegment : HighlightSegment;
  return (
    <section className="passage" aria-labelledby="passage-heading">
      <h2 id="passage-heading" className="visually-hidden">
        Passage
      </h2>
      {props.lesson.steps.slice(0, props.stepIndex + 1).map((step, i) => {
        // Steps without new text (e.g. reword steps) add nothing to the passage.
        if (!step.passage) return null;
        const isNew = i === props.stepIndex && props.lesson.steps.slice(0, i).some((s) => s.passage);
        return (
          <div key={i} className={`passage-segment${isNew ? ' is-new' : ''}`}>
            {isNew && <h3 className="new-tag">New in this step</h3>}
            <Segment {...props} segment={i} />
          </div>
        );
      })}
    </section>
  );
}
