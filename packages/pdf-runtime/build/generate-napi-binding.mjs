#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const generatedDir = resolve(root, 'build/generated');
const functionsPath = resolve(generatedDir, 'functions.json');
const outPath = resolve(generatedDir, 'binding.generated.cc');
const dtsPath = resolve(generatedDir, 'binding.generated.d.ts');

if (!existsSync(functionsPath)) {
  console.error(`missing ${functionsPath}; run generate-functions.mjs first`);
  process.exit(1);
}

mkdirSync(generatedDir, { recursive: true });

const { functions } = JSON.parse(readFileSync(functionsPath, 'utf8'));

function cppType(meta) {
  if (meta.kind === 'bool') return 'bool';
  if (meta.kind === 'f32') return 'float';
  if (meta.kind === 'f64') return 'double';
  if (meta.kind === 'i64') return 'int64_t';
  if (meta.kind === 'void') return 'void';
  if (meta.kind === 'pointer' || meta.kind === 'cstring' || meta.kind === 'utf16ptr') return 'void*';
  return 'int32_t';
}

function readArg(param, index) {
  const name = `arg${index}`;
  if (param.kind === 'bool') {
    return `  bool ${name};\n  napi_get_value_bool(env, argv[${index}], &${name});`;
  }
  if (param.kind === 'f32' || param.kind === 'f64') {
    return `  double ${name};\n  napi_get_value_double(env, argv[${index}], &${name});`;
  }
  if (param.kind === 'i64') {
    return `  int64_t ${name};\n  napi_get_value_bigint_int64(env, argv[${index}], &${name}, &g_napi_lossless);`;
  }
  if (param.kind === 'cstring' && param.tsType === 'string') {
    return (
      `  size_t ${name}_len = 0;\n` +
      `  napi_get_value_string_utf8(env, argv[${index}], nullptr, 0, &${name}_len);\n` +
      `  std::string ${name}_buf(${name}_len, '\\0');\n` +
      `  napi_get_value_string_utf8(env, argv[${index}], ${name}_buf.data(), ${name}_len + 1, &${name}_len);\n` +
      `  auto ${name} = static_cast<void*>(${name}_buf.data());`
    );
  }
  if (param.kind === 'pointer' || param.kind === 'cstring' || param.kind === 'utf16ptr') {
    return `  int64_t ${name}_raw;\n  napi_get_value_bigint_int64(env, argv[${index}], &${name}_raw, &g_napi_lossless);\n  auto ${name} = reinterpret_cast<${cppType(param)}>(${name}_raw);`;
  }
  return `  int32_t ${name};\n  napi_get_value_int32(env, argv[${index}], &${name});`;
}

function callArg(param, index) {
  const name = `arg${index}`;
  if (param.kind === 'f32') return `static_cast<float>(${name})`;
  if (param.kind === 'i32') return name;
  return name;
}

function returnValue(result) {
  if (result.kind === 'void') return '  return nullptr;';
  if (result.kind === 'bool') {
    return '  napi_value out;\n  napi_get_boolean(env, static_cast<bool>(result), &out);\n  return out;';
  }
  if (result.kind === 'f32' || result.kind === 'f64') {
    return '  napi_value out;\n  napi_create_double(env, static_cast<double>(result), &out);\n  return out;';
  }
  if (result.kind === 'i64') {
    return '  napi_value out;\n  napi_create_bigint_int64(env, static_cast<int64_t>(result), &out);\n  return out;';
  }
  if (result.kind === 'pointer' || result.kind === 'cstring' || result.kind === 'utf16ptr') {
    return '  napi_value out;\n  napi_create_bigint_int64(env, reinterpret_cast<int64_t>(result), &out);\n  return out;';
  }
  return '  napi_value out;\n  napi_create_int32(env, static_cast<int32_t>(result), &out);\n  return out;';
}

const declarations = functions
  .map((fn) => {
    const params = fn.params.map((p, i) => `${cppType(p)} arg${i}`).join(', ');
    return `extern "C" ${cppType(fn.result)} ${fn.name}(${params});`;
  })
  .join('\n');

const wrappers = functions
  .map((fn) => {
    const argc = fn.params.length;
    const reads = fn.params.map(readArg).join('\n');
    const args = fn.params.map(callArg).join(', ');
    const call =
      fn.result.kind === 'void'
        ? `  ${fn.name}(${args});\n${returnValue(fn.result)}`
        : `  auto result = ${fn.name}(${args});\n${returnValue(fn.result)}`;
    return `static napi_value Wrap_${fn.name}(napi_env env, napi_callback_info info) {\n  size_t argc = ${argc};\n  napi_value argv[${Math.max(argc, 1)}];\n  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);\n${reads}\n${call}\n}`;
  })
  .join('\n\n');

const exports = functions
  .map(
    (fn) =>
      `  napi_create_function(env, "${fn.name}", NAPI_AUTO_LENGTH, Wrap_${fn.name}, nullptr, &fn);\n  napi_set_named_property(env, exports, "${fn.name}", fn);`,
  )
  .join('\n');

writeFileSync(
  outPath,
  `/* AUTO-GENERATED - DO NOT EDIT BY HAND. */\n` +
    `#include <node_api.h>\n#include <stdint.h>\n#include <stdlib.h>\n#include <string.h>\n#include <string>\n\n` +
    `static bool g_napi_lossless;\n\n` +
    `${declarations}\n\n` +
    `static napi_value Alloc(napi_env env, napi_callback_info info) {\n  size_t argc = 1;\n  napi_value argv[1];\n  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);\n  int64_t size = 0;\n  napi_get_value_int64(env, argv[0], &size);\n  void* ptr = malloc(static_cast<size_t>(size));\n  napi_value out;\n  napi_create_bigint_int64(env, reinterpret_cast<int64_t>(ptr), &out);\n  return out;\n}\n\n` +
    `static napi_value Free(napi_env env, napi_callback_info info) {\n  size_t argc = 1;\n  napi_value argv[1];\n  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);\n  int64_t raw = 0;\n  napi_get_value_bigint_int64(env, argv[0], &raw, &g_napi_lossless);\n  free(reinterpret_cast<void*>(raw));\n  return nullptr;\n}\n\n` +
    `static napi_value ReadBytes(napi_env env, napi_callback_info info) {\n  size_t argc = 2;\n  napi_value argv[2];\n  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);\n  int64_t raw = 0;\n  int64_t len = 0;\n  napi_get_value_bigint_int64(env, argv[0], &raw, &g_napi_lossless);\n  napi_get_value_int64(env, argv[1], &len);\n  void* copy = malloc(static_cast<size_t>(len));\n  memcpy(copy, reinterpret_cast<void*>(raw), static_cast<size_t>(len));\n  napi_value out;\n  napi_create_external_arraybuffer(env, copy, static_cast<size_t>(len), [](napi_env, void* data, void*) { free(data); }, nullptr, &out);\n  return out;\n}\n\n` +
    `static napi_value WriteBytes(napi_env env, napi_callback_info info) {\n  size_t argc = 2;\n  napi_value argv[2];\n  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);\n  int64_t raw = 0;\n  napi_get_value_bigint_int64(env, argv[0], &raw, &g_napi_lossless);\n  void* data = nullptr;\n  size_t len = 0;\n  napi_get_arraybuffer_info(env, argv[1], &data, &len);\n  memcpy(reinterpret_cast<void*>(raw), data, len);\n  return nullptr;\n}\n\n` +
    `static napi_value ReadU8String(napi_env env, napi_callback_info info) {\n  size_t argc = 1;\n  napi_value argv[1];\n  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);\n  int64_t raw = 0;\n  napi_get_value_bigint_int64(env, argv[0], &raw, &g_napi_lossless);\n  napi_value out;\n  napi_create_string_utf8(env, reinterpret_cast<const char*>(raw), NAPI_AUTO_LENGTH, &out);\n  return out;\n}\n\n` +
    `static napi_value WriteU8String(napi_env env, napi_callback_info info) {\n  size_t argc = 1;\n  napi_value argv[1];\n  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);\n  size_t len = 0;\n  napi_get_value_string_utf8(env, argv[0], nullptr, 0, &len);\n  char* data = static_cast<char*>(malloc(len + 1));\n  napi_get_value_string_utf8(env, argv[0], data, len + 1, &len);\n  napi_value out;\n  napi_create_bigint_int64(env, reinterpret_cast<int64_t>(data), &out);\n  return out;\n}\n\n` +
    `static napi_value ReadU16String(napi_env env, napi_callback_info info) {\n  size_t argc = 1;\n  napi_value argv[1];\n  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);\n  int64_t raw = 0;\n  napi_get_value_bigint_int64(env, argv[0], &raw, &g_napi_lossless);\n  const char16_t* data = reinterpret_cast<const char16_t*>(raw);\n  size_t len = 0;\n  while (data[len] != 0) len++;\n  napi_value out;\n  napi_create_string_utf16(env, data, len, &out);\n  return out;\n}\n\n` +
    `static napi_value WriteU16String(napi_env env, napi_callback_info info) {\n  size_t argc = 1;\n  napi_value argv[1];\n  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);\n  size_t len = 0;\n  napi_get_value_string_utf16(env, argv[0], nullptr, 0, &len);\n  char16_t* data = static_cast<char16_t*>(malloc((len + 1) * sizeof(char16_t)));\n  napi_get_value_string_utf16(env, argv[0], data, len + 1, &len);\n  data[len] = 0;\n  napi_value out;\n  napi_create_bigint_int64(env, reinterpret_cast<int64_t>(data), &out);\n  return out;\n}\n\n` +
    `static napi_value Peek(napi_env env, napi_callback_info info) {\n  size_t argc = 2;\n  napi_value argv[2];\n  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);\n  int64_t raw = 0;\n  napi_get_value_bigint_int64(env, argv[0], &raw, &g_napi_lossless);\n  char kind[8];\n  size_t kind_len = 0;\n  napi_get_value_string_utf8(env, argv[1], kind, sizeof(kind), &kind_len);\n  napi_value out;\n  if (strcmp(kind, \"i8\") == 0) napi_create_int32(env, *reinterpret_cast<int8_t*>(raw), &out);\n  else if (strcmp(kind, \"i16\") == 0) napi_create_int32(env, *reinterpret_cast<int16_t*>(raw), &out);\n  else if (strcmp(kind, \"i64\") == 0 || strcmp(kind, \"ptr\") == 0) napi_create_bigint_int64(env, *reinterpret_cast<int64_t*>(raw), &out);\n  else if (strcmp(kind, \"f32\") == 0) napi_create_double(env, *reinterpret_cast<float*>(raw), &out);\n  else if (strcmp(kind, \"f64\") == 0) napi_create_double(env, *reinterpret_cast<double*>(raw), &out);\n  else napi_create_int32(env, *reinterpret_cast<int32_t*>(raw), &out);\n  return out;\n}\n\n` +
    `static napi_value Poke(napi_env env, napi_callback_info info) {\n  size_t argc = 3;\n  napi_value argv[3];\n  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);\n  int64_t raw = 0;\n  napi_get_value_bigint_int64(env, argv[0], &raw, &g_napi_lossless);\n  char kind[8];\n  size_t kind_len = 0;\n  napi_get_value_string_utf8(env, argv[1], kind, sizeof(kind), &kind_len);\n  if (strcmp(kind, \"i64\") == 0 || strcmp(kind, \"ptr\") == 0) {\n    int64_t value = 0;\n    napi_get_value_bigint_int64(env, argv[2], &value, &g_napi_lossless);\n    *reinterpret_cast<int64_t*>(raw) = value;\n  } else if (strcmp(kind, \"f32\") == 0 || strcmp(kind, \"f64\") == 0) {\n    double value = 0;\n    napi_get_value_double(env, argv[2], &value);\n    if (strcmp(kind, \"f32\") == 0) *reinterpret_cast<float*>(raw) = static_cast<float>(value);\n    else *reinterpret_cast<double*>(raw) = value;\n  } else {\n    int32_t value = 0;\n    napi_get_value_int32(env, argv[2], &value);\n    if (strcmp(kind, \"i8\") == 0) *reinterpret_cast<int8_t*>(raw) = static_cast<int8_t>(value);\n    else if (strcmp(kind, \"i16\") == 0) *reinterpret_cast<int16_t*>(raw) = static_cast<int16_t>(value);\n    else *reinterpret_cast<int32_t*>(raw) = value;\n  }\n  return nullptr;\n}\n\n` +
    wrappers +
    `\n\nstatic napi_value Init(napi_env env, napi_value exports) {\n  napi_value fn;\n  napi_create_function(env, "alloc", NAPI_AUTO_LENGTH, Alloc, nullptr, &fn);\n  napi_set_named_property(env, exports, "alloc", fn);\n  napi_create_function(env, "free", NAPI_AUTO_LENGTH, Free, nullptr, &fn);\n  napi_set_named_property(env, exports, "free", fn);\n  napi_create_function(env, "readBytes", NAPI_AUTO_LENGTH, ReadBytes, nullptr, &fn);\n  napi_set_named_property(env, exports, "readBytes", fn);\n  napi_create_function(env, "writeBytes", NAPI_AUTO_LENGTH, WriteBytes, nullptr, &fn);\n  napi_set_named_property(env, exports, "writeBytes", fn);\n  napi_create_function(env, "readU8String", NAPI_AUTO_LENGTH, ReadU8String, nullptr, &fn);\n  napi_set_named_property(env, exports, "readU8String", fn);\n  napi_create_function(env, "writeU8String", NAPI_AUTO_LENGTH, WriteU8String, nullptr, &fn);\n  napi_set_named_property(env, exports, "writeU8String", fn);\n  napi_create_function(env, "readU16String", NAPI_AUTO_LENGTH, ReadU16String, nullptr, &fn);\n  napi_set_named_property(env, exports, "readU16String", fn);\n  napi_create_function(env, "writeU16String", NAPI_AUTO_LENGTH, WriteU16String, nullptr, &fn);\n  napi_set_named_property(env, exports, "writeU16String", fn);\n  napi_create_function(env, "peek", NAPI_AUTO_LENGTH, Peek, nullptr, &fn);\n  napi_set_named_property(env, exports, "peek", fn);\n  napi_create_function(env, "poke", NAPI_AUTO_LENGTH, Poke, nullptr, &fn);\n  napi_set_named_property(env, exports, "poke", fn);\n${exports}\n  return exports;\n}\n\nNAPI_MODULE(NODE_GYP_MODULE_NAME, Init)\n`,
);

writeFileSync(
  dtsPath,
  `/* AUTO-GENERATED - DO NOT EDIT BY HAND. */\n` +
    `export function alloc(bytes: number): bigint;\nexport function free(ptr: bigint): void;\nexport function readBytes(ptr: bigint, len: number): ArrayBuffer;\nexport function writeBytes(ptr: bigint, data: ArrayBuffer): void;\nexport function readU8String(ptr: bigint): string;\nexport function writeU8String(str: string): bigint;\nexport function readU16String(ptr: bigint): string;\nexport function writeU16String(str: string): bigint;\nexport function peek(ptr: bigint, kind: string): number | bigint;\nexport function poke(ptr: bigint, kind: string, value: number | bigint): void;\n` +
    functions.map((fn) => `export function ${fn.name}(...args: unknown[]): unknown;`).join('\n') +
    '\n',
);

console.log(`generated N-API bindings for ${functions.length} functions`);
