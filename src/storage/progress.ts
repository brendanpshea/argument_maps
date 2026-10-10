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

const isMap = (m: unknown): m is ArgumentMap =>
  !!m && typeof m === 'object' && Array.isArray((m as ArgumentMap).nodes) && Array.isArray((m as ArgumentMap).relations);

/** Saved progress in the shape we expect, or null (e.g. corrupt, or saved by an older version). */
export function validProgress(data: unknown): LessonProgress | null {
  if (!data || typeof data !== 'object') return null;
  const p = data as LessonProgress;
  if (!Number.isInteger(p.stepIndex) || p.stepIndex < 0) return null;
  if (!Array.isArray(p.maps) || !p.maps.every(isMap)) return null;
  if (!Array.isArray(p.scores)) return null;
  return { ...p, completed: !!p.completed };
}

export const localProgressStore: ProgressStore = {
  load(lessonId) {
    try {
      const raw = localStorage.getItem(key(lessonId));
      return raw ? validProgress(JSON.parse(raw)) : null;
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
