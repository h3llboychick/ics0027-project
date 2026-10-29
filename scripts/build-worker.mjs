// Compile the worker's actual local import graph to ESM. No runtime TS hook,
// new bundler dependency, or project aliases remain in the production artifact.
import ts from 'typescript';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd();
const sourceRoot = path.join(root, 'src');
const outputRoot = path.join(root, 'dist/worker');
await fs.rm(outputRoot, { recursive: true, force: true });
const visited = new Set();
async function compile(filename) {
  if (visited.has(filename)) return;
  visited.add(filename);
  const source = await fs.readFile(filename, 'utf8');
  const imports = ts.preProcessFile(source).importedFiles;
  let rewritten = source;
  for (const entry of imports) {
    const specifier = entry.fileName;
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue;
    const target = specifier.startsWith('@/') ? path.join(sourceRoot, specifier.slice(2)) : path.resolve(path.dirname(filename), specifier);
    let resolved = target.replace(/\.js$/, '.ts');
    if (!path.extname(resolved)) resolved += '.ts';
    if (!resolved.startsWith(sourceRoot + path.sep)) throw new Error('Worker import escaped src');
    await compile(resolved);
    let relative = path.relative(path.dirname(filename), resolved).replaceAll(path.sep, '/').replace(/\.ts$/, '.js');
    if (!relative.startsWith('.')) relative = './' + relative;
    rewritten = rewritten.replaceAll(`'${specifier}'`, `'${relative}'`).replaceAll(`"${specifier}"`, `"${relative}"`);
  }
  const result = ts.transpileModule(rewritten, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, esModuleInterop: true },
    reportDiagnostics: true,
  });
  if (result.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) throw new Error('Worker compilation failed');
  const output = path.join(outputRoot, path.relative(sourceRoot, filename)).replace(/\.ts$/, '.js');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, result.outputText);
}
await compile(path.join(sourceRoot, 'worker.ts'));
await fs.writeFile(path.join(outputRoot, 'package.json'), '{"type":"module"}\n');
// Next's trace follows web bundles and can omit packages used by this entry.
// Copy only this worker's installed production package graph, preserving assets
// (including Prisma's query compiler). Do not depend on Next's incidental trace.
const packages = new Map();
async function packageDirectory(name, parent) {
  let cursor = parent;
  while (true) {
    const candidate = path.join(cursor, 'node_modules', name);
    try { return await fs.realpath(candidate); } catch { /* Try ancestor. */ }
    const next = path.dirname(cursor);
    if (next === cursor) throw new Error(`Missing worker dependency: ${name}`);
    cursor = next;
  }
}
async function linkPackage(target, link) {
  await fs.mkdir(path.dirname(link), { recursive: true });
  await fs.symlink(path.relative(path.dirname(link), target), link, 'dir');
}
async function copyPackage(name, parent = root) {
  const directory = await packageDirectory(name, parent);
  if (packages.has(directory)) return packages.get(directory);
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  const hash = createHash('sha256').update(directory).digest('hex').slice(0, 16);
  const modules = path.join(outputRoot, 'node_modules/.packages', hash, 'node_modules');
  const destination = path.join(modules, name);
  packages.set(directory, destination);
  await fs.cp(directory, destination, { recursive: true, dereference: true,
    filter: source => path.basename(source) !== 'node_modules' });
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    await linkPackage(await copyPackage(dependency, directory), path.join(modules, dependency));
  }
  for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
    try { await packageDirectory(dependency, directory); } catch { continue; }
    if (!manifest.dependencies?.[dependency]) {
      await linkPackage(await copyPackage(dependency, directory), path.join(modules, dependency));
    }
  }
  return destination;
}
for (const name of ['@prisma/adapter-pg', '@prisma/client', 'zod']) {
  await linkPackage(await copyPackage(name), path.join(outputRoot, 'node_modules', name));
}
console.info(`Compiled worker (${visited.size} modules)`);
