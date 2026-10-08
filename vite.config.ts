import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` keeps every asset path relative, so the same build works on
// GitHub Pages (served under /argument_maps/) and inside a SCORM package
// (served from whatever path the LMS chooses).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1000 },
  test: {
    environment: 'node',
  },
});
