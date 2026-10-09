import { useRef, useState, type ReactNode } from 'react';
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
            disabled={!pending}
            onClick={() => {
              if (!pending) return;
              onAddClaim(pending, text.slice(pending.start, pending.end).trim());
              window.getSelection()?.removeAllRanges();
              setPending(null);
            }}
          >
            {addLabel ?? 'Add claim'}
          </button>
          <span className="hint">{pending ? `“${text.slice(pending.start, pending.end).trim()}”` : 'Select the text of a claim in this passage.'}</span>
        </div>
      )}
    </div>
  );
}

export function Passage(props: Props) {
  const Segment = props.lesson.claimMode === 'marked' ? MarkedSegment : HighlightSegment;
  return (
    <section className="passage" aria-label="Passage">
      {props.lesson.steps.slice(0, props.stepIndex + 1).map((step, i) => {
        // Steps without new text (e.g. reword steps) add nothing to the passage.
        if (!step.passage) return null;
        const isNew = i === props.stepIndex && props.lesson.steps.slice(0, i).some((s) => s.passage);
        return (
          <div key={i} className={`passage-segment${isNew ? ' is-new' : ''}`}>
            {isNew && <span className="new-tag">New in this step</span>}
            <Segment {...props} segment={i} />
          </div>
        );
      })}
    </section>
  );
}
