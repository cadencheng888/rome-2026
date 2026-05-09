import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Dedupe three so globe.gl, three-globe, react-three-fiber and drei share
  // a single instance — without this you get "THREE.WARNING: Multiple
  // instances" and a black sphere because WebGL state from one three
  // instance is invisible to another.
  resolve: {
    dedupe: ['three'],
  },
});
