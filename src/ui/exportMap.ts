import type { ArgumentMap } from '../model/types';

export interface MapFile {
  format: 'argument-map';
  version: 1;
  lessonId: string;
  stepIndex: number;
  savedAt: string;
  map: ArgumentMap;
}

export function download(filename: string, href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
}

export function downloadMapJson(lessonId: string, stepIndex: number, map: ArgumentMap) {
  const file: MapFile = { format: 'argument-map', version: 1, lessonId, stepIndex, savedAt: new Date().toISOString(), map };
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
  download(`${lessonId}-step${stepIndex + 1}.argmap.json`, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readMapFile(file: File, lessonId: string): Promise<ArgumentMap> {
  const data = JSON.parse(await file.text()) as Partial<MapFile>;
  if (data.format !== 'argument-map' || !data.map || !Array.isArray(data.map.nodes)) {
    throw new Error('That file is not a saved argument map.');
  }
  if (data.lessonId !== lessonId) {
    throw new Error(`That map belongs to a different lesson ("${data.lessonId}").`);
  }
  return data.map;
}
