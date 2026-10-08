import { useEffect, useMemo, useRef, useState } from 'react';
import { stringify as toYaml } from 'yaml';
import { gradeStep, matchNodes, type GradeResult } from '../grading/grade';
import { mapFromAnswer } from '../model/layout';
import * as ops from '../model/ops';
import { emptyMap, type ArgumentMap, type Lesson, type Span } from '../model/types';
import type { LessonProgress, ProgressStore } from '../storage/progress';
import { downloadMapJson, readMapFile } from './exportMap';
import { Feedback } from './Feedback';
import { MapEditor } from './MapEditor';
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
  const [choosingNext, setChoosingNext] = useState(false);
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const { stepIndex } = progress;
  const step = lesson.steps[stepIndex];
  const map = progress.maps[stepIndex] ?? emptyMap();
  const isLast = stepIndex === lesson.steps.length - 1;

  useEffect(() => store.save(lesson.id, progress), [store, lesson.id, progress]);

  const { mapping } = useMemo(() => matchNodes(lesson, map), [lesson, map]);
  const modelMap = useMemo(() => mapFromAnswer(lesson, step.answers[0]), [lesson, step]);

  const passageTextOf = (span: Span) => lesson.steps[span.segment].passage.slice(span.start, span.end).trim();
  const nodeById = (m: ArgumentMap, id: string) => m.nodes.find((n) => n.id === id);
  const numberFor = (m: ArgumentMap, id: string) => {
    const claimId = m === modelMap ? id.slice(2) : mapping[id];
    return lesson.claimMode === 'marked' && claimId && lesson.claims[claimId] ? `(${lesson.claims[claimId].number})` : undefined;
  };
  const nameFor = (id: string) => {
    const n = nodeById(map, id);
    return [numberFor(map, id), `“${truncate(n?.text ?? '')}”`].filter(Boolean).join(' ');
  };

  const setMap = (next: ArgumentMap) => {
    setResult(null);
    setProgress((p) => ({ ...p, maps: p.maps.map((m, i) => (i === p.stepIndex ? next : m)) }));
  };

  const goTo = (index: number, startFrom?: ArgumentMap) => {
    setResult(null);
    setShowModel(false);
    setChoosingNext(false);
    setProgress((p) => {
      const maps = [...p.maps];
      const scores = [...p.scores];
      if (startFrom) maps[index] = structuredClone(startFrom);
      while (scores.length <= index) scores.push(null);
      return { ...p, stepIndex: index, maps, scores };
    });
  };

  const next = () => {
    if (progress.maps[stepIndex + 1]) goTo(stepIndex + 1);
    else setChoosingNext(true);
  };

  const check = () => {
    const r = gradeStep(lesson, stepIndex, map);
    setResult(r);
    const fraction = r.possible ? r.earned / r.possible : 0;
    setProgress((p) => {
      const scores = [...p.scores];
      scores[p.stepIndex] = Math.max(scores[p.stepIndex] ?? 0, fraction);
      return { ...p, scores, completed: p.completed || p.stepIndex === lesson.steps.length - 1 };
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
                disabled={i > progress.maps.length - 1 && i !== stepIndex + 1}
                onClick={() => (i === stepIndex + 1 ? next() : goTo(i))}
              >
                {i + 1}. {s.title ?? `Step ${i + 1}`}
                {progress.scores[i] != null && <span className="step-score">{Math.round(progress.scores[i]! * 100)}%</span>}
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
            usedSpans={map.nodes.map((n) => n.source)}
            readOnly={showModel}
            onAddClaim={(span, text) => setMap(ops.addNode(map, text, span))}
          />

          <div className="actions">
            <button className="primary" onClick={check} disabled={!map.nodes.length}>
              Check my map
            </button>
            <button onClick={() => setShowModel((v) => !v)} aria-pressed={showModel}>
              {showModel ? 'Back to my map' : 'Show model answer'}
            </button>
            {!isLast && <button onClick={next}>Next step →</button>}
          </div>

          {choosingNext && (
            <div className="choice" role="dialog" aria-label="Start the next step">
              <p>How do you want to start the next step?</p>
              <button className="primary" onClick={() => goTo(stepIndex + 1, map)}>
                Continue with my map
              </button>
              <button onClick={() => goTo(stepIndex + 1, modelMap)}>Start from the model answer</button>
              <button className="link-button" onClick={() => setChoosingNext(false)}>
                Cancel
              </button>
            </div>
          )}

          {result && !showModel && <Feedback lesson={lesson} map={map} result={result} />}
          {result && isLast && result.earned === result.possible && <p className="done">Lesson complete. Nice work!</p>}

          <details className="outline-wrap">
            <summary>Outline view (edit with the keyboard)</summary>
            <Outline map={map} onChange={setMap} nameFor={nameFor} />
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
              return n ? passageTextOf(n.source) : '';
            }}
            exportName={`${lesson.id}-step${stepIndex + 1}${showModel ? '-model' : ''}`}
          />
        </main>
      </div>
    </div>
  );
}
