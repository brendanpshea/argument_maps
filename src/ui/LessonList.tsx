import type { Lesson } from '../model/types';
import type { ProgressStore } from '../storage/progress';

interface Props {
  lessons: Lesson[];
  store: ProgressStore;
  notFound?: boolean;
}

export function LessonList({ lessons, store, notFound }: Props) {
  return (
    <div className="lesson-list">
      <h1>Argument Maps</h1>
      <p className="lede">Practice diagramming arguments (premises, conclusions, objections, and rebuttals) and explanations.</p>
      {notFound && <p className="message">That lesson could not be found.</p>}
      <p>
        <a href="slides.html">Slide decks for teaching →</a>
      </p>
      <ul>
        {lessons.map((lesson) => {
          const progress = store.load(lesson.id);
          const done = progress?.scores.filter((s) => s != null).length ?? 0;
          return (
            <li key={lesson.id}>
              <a href={`#/lesson/${lesson.id}`}>
                <h2>{lesson.title}</h2>
                {lesson.description && <p>{lesson.description}</p>}
                <span className="meta">
                  {lesson.steps.length} {lesson.steps.length === 1 ? 'step' : 'steps'}
                  {lesson.kind === 'explanation' && ' · explanation'}
                  {lesson.claimMode === 'highlight' ? ' · find the claims yourself' : ' · numbered claims'}
                  {progress && ` · ${progress.completed ? 'completed' : `${done} of ${lesson.steps.length} checked`}`}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
