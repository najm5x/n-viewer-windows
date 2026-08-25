import { defineConfig } from 'vite';

export default defineConfig({
  root: 'renderer',
  base: './',

  build: {
    outDir: '../renderer-dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1000,

    rollupOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'pdfjs',
              test: /node_modules[\\/]+pdfjs-dist/
            },
            {
              name: 'markdown',
              test: /node_modules[\\/]+(?:marked|dompurify)/
            }
          ]
        }
      }
    }
  }
});