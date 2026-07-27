import { defineConfig } from "vite";

// SharedArrayBuffer requires a cross-origin isolated context (self.crossOriginIsolated === true),
// which in turn requires these two headers on the document response.
const crossOriginIsolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  server: {
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  worker: {
    format: "es",
  },
});
