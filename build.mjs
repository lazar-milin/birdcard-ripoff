import { build } from 'esbuild';
await build({ stdin: { contents: 'export { DiscordSDK } from "@discord/embedded-app-sdk";', resolveDir: process.cwd() }, bundle: true, format: 'esm', outfile: 'public/discord-sdk.js', minify: true });
console.log('Discord SDK bundled.');
