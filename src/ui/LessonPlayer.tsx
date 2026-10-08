import { useEffect, useMemo, useRef, useState } from 'react';
import { stringify as toYaml } from 'yaml';
import { gradeStep, matchNodes, type GradeResult } from '../grading/grade';
import { mapFromAnswer } from '../model/layout';
import * as ops from '../model/ops';
import { stableShuffle } from '../model/shuffle';
import { emptyMap, isBank, type ArgumentMap, type ClaimSource, type Lesson } from '../model/types';
import type { LessonProgress, ProgressStore } from '../storage/progress';
import { downloadMapJson, readMapFile } from './exportMap';
import { Feedback } from './Feedback';
import { ClaimBank } from './ClaimBank';
import { MapEditor, type WordingEdit } from './MapEditor';
import { Outline } from './Outline';
import { Passage } from './Passage';

interface Props {
  lesson: Lesson;
  store: ProgressStore;
  authorMode?: boolean;
  /** Hidden in single-lesson (SCORM) builds. */
  onExit?: () => void;
}

const fresh = (): LessonProgress => ({ stepIndex: 0, maps: [emptyMap()], scores: [null], completed: false });
const truncate = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function LessonPlayer({ lesson, store, authorMode, onExit }: Props) {
  const [progress, setProgress] = useState<LessonProgress>(() => store.load(lesson.id) ?? fresh());
  const [result, setResult] = useState<GradeResult | null>(null);
  const [showModel, setShowModel] = useState(false);
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const { stepIndex } = progress;
  const step = lesson.steps[stepIndex];
  const map = progress.maps[stepIndex] ?? emptyMap();
  const isLast = stepIndex === lesson.steps.length - 1;

  useEffect(() => store.save(lesson.id, progress), [store, lesson.id, progress]);

  const { mapping } = useMemo(() => matchNodes(lesson, map), [lesson, map]);
  const modelMap = useMemo(() => mapFromAnswer(lesson, step.answers[0]), [lesson, step]);

  /** The claim as written: its passage text, or its claim-bank text. */
  const originalTextOf = (source: ClaimSource) =>
    isBank(source)
      ? lesson.claims[source.bank]?.passageText ?? ''
      : lesson.steps[source.segment].passage.slice(source.start, source.end).trim();
  const editFor = (m: ArgumentMap, nodeId: string): WordingEdit => {
    const node = nodeById(m, nodeId);
    if (!node || lesson.rewording === 'none' || isBank(node.source)) return { kind: 'none' };
    if (lesson.rewording === 'free') return { kind: 'free' };
    const claimId = m === modelMap ? nodeId.slice(2) : mapping[nodeId];
    const choices = claimId ? lesson.claims[claimId]?.wordingChoices : undefined;
    if (!choices) return { kind: 'none' };
    return { kind: 'choose', choices: stableShuffle(choices.map((c) => c.text), (t) => t, claimId) };
  };
  const nodeById = (m: ArgumentMap, id: string) => m.nodes.find((n) => n.id === id);
  const numberFor = (m: ArgumentMap, id: string) => {
    const claimId = m === modelMap ? id.slice(2) : mapping[id];
    const claim = claimId ? lesson.claims[claimId] : undefined;
    return lesson.claimMode === 'marked' && claim && !isBank(claim.source) ? `(${claim.number})` : undefined;
  };
  const nameFor = (id: string) => {
    const n = nodeById(map, id);
    return [numberFor(map, id), `“${truncate(n?.text ?? '')}”`].filter(Boolean).join(' ');
  };

  const setMap = (next: ArgumentMap) => {
    setResult(null);
    setProgress((p) => ({ ...p, maps: p.maps.map((m, i) => (i === p.stepIndex ? next : m)) }));
  };

  const passed = !!result && result.earned === result.possible;
  /** Steps unlock one at a time: a student moves on only after getting the current step fully right. */
  const unlocked = (index: number) => authorMode || index < progress.maps.length;
  const canAdvance = !isLast && (passed || unlocked(stepIndex + 1));

  const goTo = (index: number) => {
    setResult(null);
    setShowModel(false);
    setProgress((p) => {
      const maps = [...p.maps];
      const scores = [...p.scores];
      // A newly unlocked step starts from the student's own (correct) map.
      if (!maps[index]) maps[index] = structuredClone(maps[p.stepIndex]);
      while (scores.length <= index) scores.push(null);
      return { ...p, stepIndex: index, maps, scores };
    });
  };

  const check = () => {
    const r = gradeStep(lesson, stepIndex, map);
    setResult(r);
    const fraction = r.possible ? r.earned / r.possible : 0;
    setProgress((p) => {
      const scores = [...p.scores];
      scores[p.stepIndex] = Math.max(scores[p.stepIndex] ?? 0, fraction);
      const done = fraction === 1 && p.stepIndex === lesson.steps.length - 1;
      return { ...p, scores, completed: p.completed || done };
    });
  };

  const importMap = async (file: File) => {
    try {
      setMap(await readMapFile(file, lesson.id));
      setMessage('Map loaded.');
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const copyAnswerYaml = async () => {
    const claim = (id: string) => mapping[id] ?? `?${id}`;
    const answer = {
      conclusion: map.conclusion ? claim(map.conclusion) : '?',
      relations: map.relations.map((r) => ({ type: r.type, from: r.from.map(claim), to: claim(r.to) })),
    };
    const yaml = toYaml({ answer }, { flowCollectionPadding: true });
    await navigator.clipboard.writeText(yaml);
    setMessage('Answer YAML copied to the clipboard.');
  };

  const reset = () => {
    if (!confirm('Erase all your work on this lesson?')) return;
    store.clear(lesson.id);
    setResult(null);
    setShowModel(false);
    setProgress(fresh());
  };

  return (
    <div className="player">
      <header className="player-header">
        {onExit && (
          <button className="link-button" onClick={onExit}>
            ← All lessons
          </button>
        )}
        <h1>{lesson.title}</h1>
        {lesson.steps.length > 1 && (
          <nav className="steps" aria-label="Steps">
            {lesson.steps.map((s, i) => (
              <button
                key={i}
                aria-current={i === stepIndex ? 'step' : undefined}
                disabled={!unlocked(i) && !(i === stepIndex + 1 && canAdvance)}
                title={unlocked(i) || (i === stepIndex + 1 && canAdvance) ? undefined : 'Get the previous step right to unlock this one'}
                onClick={() => goTo(i)}
              >
                {i + 1}. {s.title ?? `Step ${i + 1}`}
                {progress.scores[i] === 1 ? (
                  <span className="step-score" aria-label="correct">✓</span>
                ) : (
                  progress.scores[i] != null && <span className="step-score partial">{Math.round(progress.scores[i]! * 100)}%</span>
                )}
              </button>
            ))}
          </nav>
        )}
      </header>

      <div className="player-body">
        <aside className="side">
          <p className="instructions">{step.instructions}</p>
          <Passage
            lesson={lesson}
            stepIndex={stepIndex}
            usedSpans={map.nodes.flatMap((n) => (isBank(n.source) ? [] : [n.source]))}
            readOnly={showModel}
            onAddClaim={(span, text) => setMap(ops.addNode(map, text, span))}
          />
          <ClaimBank
            lesson={lesson}
            stepIndex={stepIndex}
            used={map.nodes.flatMap((n) => (isBank(n.source) ? [n.source.bank] : []))}
            readOnly={showModel}
            onAdd={(claim) => setMap(ops.addNode(map, claim.passageText, claim.source))}
          />

          <div className="actions">
            <button className="primary" onClick={check} disabled={!map.nodes.length}>
              Check my map
            </button>
            {authorMode && (
              <button onClick={() => setShowModel((v) => !v)} aria-pressed={showModel}>
                {showModel ? 'Back to my map' : 'Show model answer (author)'}
              </button>
            )}
            {!isLast && (
              <button className={passed ? 'primary' : ''} onClick={() => goTo(stepIndex + 1)} disabled={!canAdvance} title={canAdvance ? undefined : 'Get this step fully right to continue'}>
                Next step →
              </button>
            )}
          </div>

          {result && !showModel && <Feedback lesson={lesson} map={map} result={result} />}
          {passed && !isLast && <p className="done">Step complete. Continue to the next step when you're ready.</p>}
          {passed && isLast && <p className="done">Lesson complete. Nice work!</p>}

          <details className="outline-wrap">
            <summary>Outline view (edit with the keyboard)</summary>
            <Outline map={map} onChange={setMap} nameFor={nameFor} editFor={(id) => editFor(map, id)} />
          </details>

          <details className="more">
            <summary>Save, load, and reset</summary>
            <div className="actions">
              <button onClick={() => downloadMapJson(lesson.id, stepIndex, map)}>Download map file</button>
              <button onClick={() => fileInput.current?.click()}>Load map file…</button>
              <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importMap(f);
                  e.target.value = '';
                }}
              />
              {authorMode && <button onClick={copyAnswerYaml}>Copy answer YAML</button>}
              <button className="danger" onClick={reset}>
                Reset lesson
              </button>
            </div>
            <p className="hint">Your work is saved automatically in this browser.</p>
          </details>
          {message && (
            <p className="message" role="status">
              {message}
            </p>
          )}
        </aside>

        <main className="canvas">
          {showModel && <div className="model-banner">Model answer (read-only)</div>}
          <MapEditor
            key={showModel ? `model-${stepIndex}` : `mine-${stepIndex}`}
            map={showModel ? modelMap : map}
            onChange={setMap}
            readOnly={showModel}
            labelFor={(id) => numberFor(showModel ? modelMap : map, id)}
            originalTextFor={(id) => {
              const n = nodeById(showModel ? modelMap : map, id);
              return n ? originalTextOf(n.source) : '';
            }}
            editFor={(id) => editFor(showModel ? modelMap : map, id)}
            tagFor={(id) => {
              const n = nodeById(showModel ? modelMap : map, id);
              return n && isBank(n.source) ? 'unstated' : undefined;
            }}
            exportName={`${lesson.id}-step${stepIndex + 1}${showModel ? '-model' : ''}`}
          />
        </main>
      </div>
    </div>
  );
}
