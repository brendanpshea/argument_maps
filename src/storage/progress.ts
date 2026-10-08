import type { ArgumentMap } from '../model/types';

/** Everything we remember about one student's work on one lesson. */
export interface LessonProgress {
  stepIndex: number;
  /** The student's map for each step they have reached. */
  maps: ArgumentMap[];
  /** Best score fraction (0–1) per step, once checked. */
  scores: (number | null)[];
  completed: boolean;
}

/**
 * Where progress and scores go. The web build uses localStorage; a SCORM
 * build will provide an implementation backed by the LMS (cmi.suspend_data,
 * cmi.core.score.raw, cmi.core.lesson_status).
 */
export interface ProgressStore {
  load(lessonId: string): LessonProgress | null;
  save(lessonId: string, progress: LessonProgress): void;
  clear(lessonId: string): void;
}

const key = (lessonId: string) => `argument-maps:lesson:${lessonId}`;

export const localProgressStore: ProgressStore = {
  load(lessonId) {
    try {
      const raw = localStorage.getItem(key(lessonId));
      return raw ? (JSON.parse(raw) as LessonProgress) : null;
    } catch {
      return null;
    }
  },
  save(lessonId, progress) {
    try {
      localStorage.setItem(key(lessonId), JSON.stringify(progress));
    } catch {
      // Storage full or blocked (e.g. private browsing): work continues unsaved.
    }
  },
  clear(lessonId) {
    try {
      localStorage.removeItem(key(lessonId));
    } catch {
      // ignore
    }
  },
};
