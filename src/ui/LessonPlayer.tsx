import { useEffect, useMemo, useRef, useState } from 'react';
import { stringify as toYaml } from 'yaml';
import { evaluationKeys, gradeStep, hasRewordStep, matchNodes, withKeyEvaluations, type GradeResult } from '../grading/grade';
import { mapFromAnswer } from '../model/layout';
import * as ops from '../model/ops';
import { stableShuffle } from '../model/shuffle';
import { emptyMap, isBank, type ArgumentMap, type ClaimSource, type Lesson, type LessonKind, type Span } from '../model/types';
import { vocab } from '../model/vocab';
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

/** The main area of a conclusion step: the claim the student picked, if any. */
function ConclusionPick({ text, label, kind }: { text?: string; label?: string; kind: LessonKind }) {
  const V = vocab(kind);
  return (
    <div className="conclusion-pick">
      {text ? (
        <div className="conclusion-card">
          <span className="conclusion-tag">Your {V.conclusion}</span>
          <p>
            {label && <span className="claim-number">{label} </span>}
            {text}
          </p>
          <p className="hint">Pick a different claim in the passage to change your answer.</p>
        </div>
      ) : (
        <p className="hint">{V.conclusionQuestion} Pick it in the passage.</p>
      )}
    </div>
  );
}

/** What a map says, ignoring where its claims and labels sit on the canvas. */
const contentKey = (m: ArgumentMap) =>
  JSON.stringify([
    m.conclusion,
    m.nodes.map((n) => [n.id, n.text, n.source]),
    m.relations.map((r) => [r.id, r.type, r.from, r.to, r.evaluation]),
  ]);

const fresh = (): LessonProgress => ({ stepIndex: 0, maps: [emptyMap()], scores: [null], completed: false });
const truncate = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function LessonPlayer({ lesson, store, authorMode, onExit }: Props) {
  const [progress, setProgress] = useState<LessonProgress>(() => {
    const saved = store.load(lesson.id);
    // Saved before the lesson was shortened: start again rather than point past the last step.
    return saved && saved.stepIndex < lesson.steps.length ? saved : fresh();
  });
  const [result, setResult] = useState<GradeResult | null>(null);
  const [showModel, setShowModel] = useState(false);
  const [message, setMessage] = useState('');
  /** Free-rewording steps: the student confirms they compared their wording with the model's. */
  const [compared, setCompared] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const { stepIndex } = progress;
  const step = lesson.steps[stepIndex];
  const map = progress.maps[stepIndex] ?? emptyMap();
  const isLast = stepIndex === lesson.steps.length - 1;
  const task = step.task;

  useEffect(() => store.save(lesson.id, progress), [store, lesson.id, progress]);

  const { mapping } = useMemo(() => matchNodes(lesson, map), [lesson, map]);
  const modelMap = useMemo(() => {
    const model = mapFromAnswer(lesson, step.answers[0]);
    return step.task === 'evaluate' ? withKeyEvaluations(lesson, step, model) : model;
  }, [lesson, step]);
  const evaluated = useMemo(() => (step.task === 'evaluate' ? evaluationKeys(lesson, step, map) : new Map()), [lesson, step, map]);

  /** The claim as written: its passage text, or its claim-bank text. */
  const originalTextOf = (source: ClaimSource) =>
    isBank(source)
      ? lesson.claims[source.bank]?.passageText ?? ''
      : (lesson.steps[source.segment]?.passage ?? '').slice(source.start, source.end).trim();
  const editFor = (m: ArgumentMap, nodeId: string): WordingEdit => {
    const node = nodeById(m, nodeId);
    if (!node || lesson.rewording === 'none' || isBank(node.source)) return { kind: 'none' };
    // With a reword step, wording waits until the structure is done; evaluate steps don't change wording.
    if (m !== modelMap && (task === 'evaluate' || (hasRewordStep(lesson) && task !== 'reword'))) return { kind: 'none' };
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
    // Moving claims around doesn't change the answer, so it doesn't undo a check.
    if (contentKey(next) !== contentKey(map)) {
      setResult(null);
      setCompared(false);
    }
    setProgress((p) => ({ ...p, maps: p.maps.map((m, i) => (i === p.stepIndex ? next : m)) }));
  };

  const freeReword = task === 'reword' && lesson.rewording === 'free';
  const passed = !!result && result.earned === result.possible && (!freeReword || compared);
  /** Steps unlock one at a time: a student moves on only after getting the current step fully right. */
  const unlocked = (index: number) => authorMode || index < progress.maps.length;
  const canAdvance = !isLast && (passed || unlocked(stepIndex + 1));

  const goTo = (index: number) => {
    setResult(null);
    setCompared(false);
    setShowModel(false);
    setProgress((p) => {
      const maps = [...p.maps];
      const scores = [...p.scores];
      // A newly unlocked step starts from the student's own (correct) map. (Authors can jump
      // ahead; fill any steps skipped on the way so saved progress has no gaps.)
      for (let i = 0; i <= index; i++) if (!maps[i]) maps[i] = structuredClone(maps[i - 1] ?? maps[p.stepIndex] ?? emptyMap());
      while (scores.length <= index) scores.push(null);
      return { ...p, stepIndex: index, maps, scores };
    });
  };

  /** Conclusion steps: the student's answer is a map holding just the claim they picked. */
  const pickConclusion = (source: ClaimSource, text: string) => {
    const withNode = ops.addNode(emptyMap(), text, source);
    setMap({ ...withNode, conclusion: withNode.nodes[0].id });
  };

  // After a reload, a step the student already got right stays passed (if the map still is right).
  useEffect(() => {
    if (progress.scores[stepIndex] !== 1 || freeReword) return;
    const r = gradeStep(lesson, stepIndex, map);
    if (r.earned === r.possible) setResult(r);
    // Only on opening the lesson.
  }, []);

  const recordScore = (fraction: number) => {
    setProgress((p) => {
      const scores = [...p.scores];
      scores[p.stepIndex] = Math.max(scores[p.stepIndex] ?? 0, fraction);
      const done = fraction === 1 && p.stepIndex === lesson.steps.length - 1;
      return { ...p, scores, completed: p.completed || done };
    });
  };

  const check = () => {
    const r = gradeStep(lesson, stepIndex, map);
    setResult(r);
    // A free-rewording step counts once the student confirms the comparison.
    if (!(task === 'reword' && lesson.rewording === 'free')) recordScore(r.possible ? r.earned / r.possible : 0);
  };

  const importMap = async (file: File) => {
    if (task !== 'structure') {
      setMessage('Maps can only be loaded on a mapping step: on this step, the structure of your map is fixed.');
      return;
    }
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
            readOnly={showModel || task === 'reword' || task === 'evaluate'}
            addLabel={task === 'conclusion' ? `This is the ${vocab(lesson.kind).conclusion}` : undefined}
            onAddClaim={(span: Span, text: string) => (task === 'conclusion' ? pickConclusion(span, text) : setMap(ops.addNode(map, text, span)))}
          />
          {task === 'structure' && (
            <ClaimBank
              lesson={lesson}
              stepIndex={stepIndex}
              used={map.nodes.flatMap((n) => (isBank(n.source) ? [n.source.bank] : []))}
              readOnly={showModel}
              onAdd={(claim) => setMap(ops.addNode(map, claim.passageText, claim.source))}
            />
          )}

          <div className="actions">
            <button className="primary" onClick={check} disabled={task === 'conclusion' ? !map.conclusion : !map.nodes.length}>
              {task === 'conclusion' ? 'Check' : task === 'reword' ? 'Check wording' : task === 'evaluate' ? 'Check evaluations' : 'Check my map'}
            </button>
            {authorMode && (
              <button onClick={() => setShowModel((v) => !v)} aria-pressed={showModel}>
                {showModel ? 'Back to my map' : 'Show model answer (author)'}
              </button>
            )}
            {!isLast && (
              <button className={passed ? 'primary' : ''} onClick={(e) => e.detail <= 1 && goTo(stepIndex + 1)} disabled={!canAdvance} title={canAdvance ? undefined : 'Get this step fully right to continue'}>
                Next step →
              </button>
            )}
          </div>

          {result && !showModel && (
            <Feedback
              lesson={lesson}
              map={map}
              result={result}
              rewordStep={task === 'reword'}
              conclusionStep={task === 'conclusion'}
              evaluateStep={task === 'evaluate'}
              compared={compared}
              onCompared={() => {
                setCompared(true);
                recordScore(1);
              }}
            />
          )}
          {passed && !isLast && <p className="done">Step complete. Continue to the next step when you're ready.</p>}
          {passed && isLast && <p className="done">Lesson complete. Nice work!</p>}

          {task !== 'conclusion' && (
            <details className="outline-wrap">
              <summary>Outline view (edit with the keyboard)</summary>
              <Outline
                kind={lesson.kind}
                map={map}
                onChange={setMap}
                nameFor={nameFor}
                editFor={(id) => editFor(map, id)}
                locked={task === 'reword' || task === 'evaluate'}
                evaluateFor={(id) => (evaluated.has(id) ? step.ask : null)}
              />
            </details>
          )}

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
          {task === 'conclusion' && !showModel ? (
            <ConclusionPick
              kind={lesson.kind}
              text={map.nodes.find((n) => n.id === map.conclusion)?.text}
              label={map.conclusion ? numberFor(map, map.conclusion) : undefined}
            />
          ) : (
          <MapEditor
            kind={lesson.kind}
            key={showModel ? `model-${stepIndex}` : `mine-${stepIndex}`}
            map={showModel ? modelMap : map}
            onChange={setMap}
            readOnly={showModel}
            locked={task === 'reword' || task === 'evaluate'}
            evaluateFor={(id) => (!showModel && evaluated.has(id) ? step.ask : null)}
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
          )}
        </main>
      </div>
    </div>
  );
}
