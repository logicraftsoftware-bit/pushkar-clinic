import {defineConfig} from "vite";

export default defineConfig({
  worker:{format:"es"},
  // All configured ES2020 browser targets support these features. Preserve them
  // when the patched esbuild handles PDF workers instead of requesting ES5 lowering.
  esbuild:{supported:{"const-and-let":true,destructuring:true}},
  build:{emptyOutDir:false,manifest:true},
});
