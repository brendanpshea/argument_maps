import { compileLesson } from './compile';
import type { Lesson } from '../model/types';

// Lessons are bundled at build time, so the app (and any SCORM package built
// from it) never fetches anything at runtime.
const sources = import.meta.glob('../../lessons/*.{yaml,yml}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const lessons: Lesson[] = Object.entries(sources)
  .map(([path, src]) => compileLesson(src, path.split('/').pop()))
  .sort((a, b) => a.title.localeCompare(b.title));

export const findLesson = (id: string) => lessons.find((l) => l.id === id);
