import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';

const watch = process.argv.includes('--watch');
const outDir = fileURLToPath(new URL('../out', import.meta.url));
const srcDir = fileURLToPath(new URL('../src', import.meta.url));

/** @type {import('esbuild').BuildOptions} */
const mainOptions = {
  entryPoints: [`${srcDir}/main/index.ts`],
  outfile: `${outDir}/main.cjs`,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: true,
  external: ['electron'],
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const preloadOptions = {
  entryPoints: [`${srcDir}/preload/index.ts`],
  outfile: `${outDir}/preload.cjs`,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: true,
  external: ['electron'],
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const cliOptions = {
  entryPoints: [`${srcDir}/cli/index.ts`],
  outfile: `${outDir}/cli.cjs`,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
};

if (watch) {
  const ctxMain = await context(mainOptions);
  const ctxPreload = await context(preloadOptions);
  const ctxCli = await context(cliOptions);
  await Promise.all([ctxMain.watch(), ctxPreload.watch(), ctxCli.watch()]);
  console.log('[build-main] watching main/preload/cli…');
} else {
  await Promise.all([build(mainOptions), build(preloadOptions), build(cliOptions)]);
  console.log('[build-main] done');
}
