#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const target = process.argv[2] ?? process.env.PDF_RUNTIME_TARGET ?? 'wasm32';
const libDir = resolve(root, 'build/libpdfium', target);
const includeDir = resolve(libDir, 'include');
const outDir = resolve(root, 'build/generated');
const tsOut = resolve(root, 'src/core/pdf-functions.generated.ts');

const prefixes = /^(?:FPDF|EPDF|FORM|PDFiumExt_)/;

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile() && entry.name.endsWith('.h')) files.push(full);
  }
  return files;
}

function isCppHelperHeader(file) {
  return relative(includeDir, file).split(/[\\/]/).includes('cpp');
}

function classifyType(ctype, isReturn = false) {
  const clean = ctype.replace(/\bconst\b/g, '').replace(/\s+/g, ' ').trim();
  if (clean === 'void') return { tsType: isReturn ? 'void' : 'number', kind: 'void' };
  if (/\b(bool|FPDF_BOOL)\b/.test(clean)) return { tsType: 'boolean', kind: 'bool' };
  if (/\b(double|float)\b/.test(clean)) return { tsType: 'number', kind: clean.includes('float') ? 'f32' : 'f64' };
  if (/\b(int64_t|uint64_t|size_t|long long)\b/.test(clean)) return { tsType: 'bigint', kind: 'i64' };
  if (/\b(FPDF_WIDESTRING|FPDF_WCHAR)\b/.test(clean)) return { tsType: 'Ptr', kind: 'utf16ptr' };
  if (/\bFPDF_BYTESTRING\b/.test(clean)) return { tsType: 'string', kind: 'cstring' };
  if (/\bchar\s*\*/.test(clean)) return { tsType: 'Ptr', kind: 'cstring' };
  if (/\*/.test(clean) || /\b(FPDF_|FS_|FORM_|IFSDK_|IPDF_)/.test(clean)) return { tsType: 'Ptr', kind: 'pointer' };
  return { tsType: 'number', kind: 'i32' };
}

function collectFunctions(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.kind === 'FunctionDecl' && node.name && prefixes.test(node.name)) {
    const qual = node.type?.qualType || '';
    const match = qual.match(/^(.*?)\s*\((.*?)\)$/);
    if (match) {
      const [, retRaw, paramsRaw] = match;
      const params =
        paramsRaw === 'void' || paramsRaw.trim() === ''
          ? []
          : paramsRaw.split(',').map((raw) => {
              const meta = classifyType(raw, false);
              return { cType: raw.trim(), ...meta };
            });
      out.push({
        name: node.name,
        result: { cType: retRaw.trim(), ...classifyType(retRaw, true) },
        params,
      });
    }
  }
  if (Array.isArray(node.inner)) node.inner.forEach((child) => collectFunctions(child, out));
  return out;
}

if (!existsSync(includeDir)) {
  console.error(`missing include directory: ${includeDir}`);
  console.error(`run scripts/fetch-libpdfium.sh ${target} first`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const headers = walk(includeDir).filter((file) => !isCppHelperHeader(file)).sort();
const allHeader = resolve(outDir, 'all.h');
writeFileSync(
  allHeader,
  headers.map((file) => `#include "${relative(outDir, file)}"`).join('\n') + '\n',
);

const astPath = resolve(outDir, 'ast.json');
const astJson = execFileSync('clang', [
  '-std=c11',
  `-I${includeDir}`,
  '-fsyntax-only',
  '-Xclang',
  '-ast-dump=json',
  allHeader,
], { maxBuffer: 128 * 1024 * 1024 }).toString();
writeFileSync(astPath, astJson);

const ast = JSON.parse(readFileSync(astPath, 'utf8'));
const functions = collectFunctions(ast).sort((a, b) => a.name.localeCompare(b.name));

writeFileSync(resolve(outDir, 'functions.json'), JSON.stringify({ target, functions }, null, 2) + '\n');
writeFileSync(
  resolve(outDir, 'exported-functions.txt'),
  functions.map((fn) => `_${fn.name}`).concat(['_malloc', '_free']).join(','),
);

const tsParams = (fn) =>
  fn.params
    .map((param, index) => `arg${index}: ${param.tsType === 'Ptr' ? 'Ptr' : param.tsType}`)
    .join(', ');
const tsReturn = (fn) => (fn.result.tsType === 'Ptr' ? 'Ptr' : fn.result.tsType);

/** Emscripten `Module.cwrap` type strings (single vocabulary end-to-end). */
function cwrapFor(meta) {
  switch (meta.kind) {
    case 'bool':
      return 'boolean';
    case 'i64':
      return 'bigint';
    case 'cstring':
      return meta.tsType === 'string' ? 'string' : 'number';
    case 'pointer':
    case 'utf16ptr':
    case 'i32':
    case 'f32':
    case 'f64':
      return 'number';
    case 'void':
      return null;
    default:
      return 'number';
  }
}

const abiValue = (meta) =>
  meta.tsType === 'void'
    ? null
    : { ts: meta.tsType, kind: meta.kind, cwrap: cwrapFor(meta) };

writeFileSync(
  tsOut,
  `/* AUTO-GENERATED - DO NOT EDIT BY HAND. */\n` +
    `import type { Ptr } from './pdf-runtime-module';\n\n` +
    `export interface PdfFunctions {\n${functions
      .map((fn) => `  ${fn.name}: (${tsParams(fn)}) => ${tsReturn(fn)};`)
      .join('\n')}\n}\n\n` +
    `export type PdfFunctionTsKind = 'Ptr' | 'number' | 'string' | 'boolean' | 'bigint';\n` +
    `export type PdfFunctionAbiKind = 'void' | 'bool' | 'i32' | 'i64' | 'f32' | 'f64' | 'pointer' | 'cstring' | 'utf16ptr';\n` +
    `export type PdfFunctionCwrapKind = 'number' | 'string' | 'boolean' | 'bigint';\n` +
    `export interface PdfFunctionAbiValue {\n` +
    `  readonly ts: PdfFunctionTsKind;\n` +
    `  readonly kind: PdfFunctionAbiKind;\n` +
    `  readonly cwrap: PdfFunctionCwrapKind;\n` +
    `}\n` +
    `export interface PdfFunctionSignature {\n` +
    `  readonly params: readonly PdfFunctionAbiValue[];\n` +
    `  readonly result: PdfFunctionAbiValue | null;\n` +
    `}\n\n` +
    `export const pdfFunctionSignatures = {\n${functions
      .map(
        (fn) =>
          `  ${fn.name}: { params: ${JSON.stringify(fn.params.map(abiValue))}, result: ${JSON.stringify(
            abiValue(fn.result),
          )} },`,
      )
      .join('\n')}\n} as const;\n`,
);

console.log(`generated ${functions.length} PDF runtime functions for ${target}`);
