import { build } from "esbuild";

// Third-party browser code is bundled into public/ so the game runs without an install.
const targets = {
  discord: {
    contents: 'export { DiscordSDK } from "@discord/embedded-app-sdk";',
    outfile: "public/discord-sdk.js",
  },
  preact: {
    contents: `
      import { h } from "preact";
      import htm from "htm";
      export { h, render, Fragment, createRef } from "preact";
      export { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "preact/hooks";
      export const html = htm.bind(h);
    `,
    outfile: "public/vendor/preact.js",
  },
};
// `node build.mjs` builds everything; `node build.mjs preact` builds one target.
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(targets);
for (const name of names) {
  const { contents, outfile } = targets[name];
  await build({
    stdin: { contents, resolveDir: process.cwd() },
    bundle: true,
    format: "esm",
    outfile,
    minify: true,
  });
  console.log(`Bundled ${outfile}`);
}
