import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',  // Relaxes export checks; 'es2022' as fallback if needed for older browsers
    },
  },
});