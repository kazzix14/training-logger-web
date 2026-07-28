import {
  ConsoleStdout,
  File,
  OpenFile,
  WASI,
} from "./vendor/browser-wasi-shim/index.js";

let corePromise;

async function instantiateCore() {
  const fds = [
    new OpenFile(new File([])),
    ConsoleStdout.lineBuffered(() => {}),
    ConsoleStdout.lineBuffered(() => {}),
  ];
  const wasi = new WASI([], [], fds, { debug: false });
  const response = await fetch(new URL("./core.wasm", import.meta.url));
  if (!response.ok) {
    throw new Error(`core.wasm: HTTP ${response.status}`);
  }

  const imports = { wasi_snapshot_preview1: wasi.wasiImport };
  let result;
  try {
    result = await WebAssembly.instantiateStreaming(response.clone(), imports);
  } catch {
    result = await WebAssembly.instantiate(await response.arrayBuffer(), imports);
  }

  const instance = result.instance;
  wasi.initialize(instance);
  if (
    typeof instance.exports._initialize !== "function" &&
    typeof instance.exports.__wasm_call_ctors === "function"
  ) {
    instance.exports.__wasm_call_ctors();
  }

  const requiredExports = [
    "memory",
    "tl_alloc",
    "tl_free",
    "tl_validate",
    "tl_program_fixture",
    "tl_free_result",
  ];
  for (const name of requiredExports) {
    if (!(name in instance.exports)) {
      throw new Error(`core.wasm に ${name} export がありません`);
    }
  }
  return instance.exports;
}

function loadCore() {
  corePromise ??= instantiateCore().catch(() => null);
  return corePromise;
}

function writeBytes(exports, bytes) {
  const pointer = exports.tl_alloc(bytes.byteLength);
  if (!pointer) throw new Error("core.wasm の入力領域を確保できません");
  new Uint8Array(exports.memory.buffer, pointer, bytes.byteLength).set(bytes);
  return pointer;
}

function readCString(memory, pointer) {
  if (!pointer) throw new Error("core.wasm が空の結果ポインタを返しました");
  const bytes = new Uint8Array(memory.buffer);
  const end = bytes.indexOf(0, pointer);
  if (end < 0) throw new Error("core.wasm の結果が NUL 終端されていません");
  return new TextDecoder().decode(bytes.subarray(pointer, end));
}

/**
 * Swift wasm core で検証する。ロード不可・ABI不整合・実行失敗時は null。
 *
 * @param {unknown} envelopeObj
 * @param {string[]} knownNames
 * @returns {Promise<string[] | null>}
 */
export async function programFixtureWithWasm(key) {
  const exports = await loadCore();
  if (!exports) return null;

  const keyBytes = new TextEncoder().encode(key);
  let keyPointer;
  let resultPointer;
  try {
    keyPointer = writeBytes(exports, keyBytes);
    resultPointer = exports.tl_program_fixture(keyPointer, keyBytes.byteLength);
    if (!resultPointer) return null;
    const envelope = JSON.parse(readCString(exports.memory, resultPointer));
    if (!envelope || typeof envelope !== "object" || !envelope.program) {
      throw new Error("core.wasm のfixture形式が不正です");
    }
    return envelope;
  } catch {
    return null;
  } finally {
    if (resultPointer) exports.tl_free_result(resultPointer);
    if (keyPointer) exports.tl_free(keyPointer);
  }
}

export async function validateWithWasm(envelopeObj, knownNames = []) {
  const exports = await loadCore();
  if (!exports) return null;

  const encoder = new TextEncoder();
  const envelopeBytes = encoder.encode(JSON.stringify(envelopeObj));
  const namesBytes = encoder.encode(JSON.stringify(knownNames));
  let envelopePointer;
  let namesPointer;
  let resultPointer;

  try {
    envelopePointer = writeBytes(exports, envelopeBytes);
    namesPointer = writeBytes(exports, namesBytes);
    resultPointer = exports.tl_validate(
      envelopePointer,
      envelopeBytes.byteLength,
      namesPointer,
      namesBytes.byteLength,
    );
    const payload = JSON.parse(readCString(exports.memory, resultPointer));
    if (
      !payload ||
      !Array.isArray(payload.issues) ||
      !payload.issues.every(issue => typeof issue === "string")
    ) {
      throw new Error("core.wasm の結果形式が不正です");
    }
    return payload.issues;
  } catch {
    return null;
  } finally {
    if (resultPointer) exports.tl_free_result(resultPointer);
    if (namesPointer) exports.tl_free(namesPointer);
    if (envelopePointer) exports.tl_free(envelopePointer);
  }
}
