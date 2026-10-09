/**
 * Build the headless side.
 *
 * The studio is a browser app; the server is Node. They share the model, the
 * layout engine and the renderer, which import each other without file
 * extensions the way a bundler expects. Rather than reshape those imports for
 * Node's resolver, the server is bundled the same way the app is — one Vite
 * build, two entry points, everything shared pulled in.
 *
 * The three runtime dependencies stay external: resvg is a native binary that
 * cannot be bundled, and there is nothing to gain from inlining the other two.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist-server',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        'gibsen-mcp': 'server/index.ts',
        'gibsen-render': 'server/cli.ts',
      },
      external: [/^node:/, '@resvg/resvg-js', 'pdf-lib', /^@modelcontextprotocol\//],
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'shared/[name].js',
      },
    },
  },
});
