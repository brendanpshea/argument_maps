import { useEffect, useState } from 'react';
import { findLesson, lessons } from './lesson/registry';
import { localProgressStore } from './storage/progress';
import { LessonList } from './ui/LessonList';
import { LessonPlayer } from './ui/LessonPlayer';

/** Hash routes (`#/lesson/<id>`) work on GitHub Pages and inside SCORM packages alike. */
function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  return { path, params: new URLSearchParams(query) };
}

export function App() {
  const { path, params } = useHashRoute();
  const match = path.match(/^\/lesson\/([\w-]+)$/);
  const lesson = match ? findLesson(match[1]) : undefined;

  if (lesson) {
    return (
      <LessonPlayer
        key={lesson.id}
        lesson={lesson}
        store={localProgressStore}
        authorMode={params.has('author')}
        onExit={() => (window.location.hash = '')}
      />
    );
  }
  return <LessonList lessons={lessons} store={localProgressStore} notFound={!!match} />;
}
