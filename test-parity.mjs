import { existsSync, readFileSync } from "node:fs";
import { WASI } from "node:wasi";

import logic from "./logic.js";
import model from "./ui-model.js";

const wasmPath = new URL("./core.wasm", import.meta.url);

if (!existsSync(wasmPath)) {
  console.log("SKIP test-parity.mjs: core.wasm がありません（wasm は CI でビルド）");
} else {
  const wasi = new WASI({
    version: "preview1",
    args: [],
    env: {},
    preopens: {},
    returnOnExit: true,
  });
  const module = await WebAssembly.compile(readFileSync(wasmPath));
  const instance = await WebAssembly.instantiate(module, {
    wasi_snapshot_preview1: wasi.wasiImport,
  });

  if (typeof instance.exports._start === "function") {
    throw new Error("core.wasm が WASI reactor ではなく command として生成されています");
  }
  wasi.initialize(instance);
  if (
    typeof instance.exports._initialize !== "function" &&
    typeof instance.exports.__wasm_call_ctors === "function"
  ) {
    instance.exports.__wasm_call_ctors();
  }

  for (const name of [
    "memory",
    "tl_alloc",
    "tl_free",
    "tl_validate",
    "tl_free_result",
  ]) {
    if (!(name in instance.exports)) {
      throw new Error(`core.wasm に ${name} export がありません`);
    }
  }

  const cases = [
    fixture("妥当な最小プログラム"),
    { name: "5/3/1風テンプレートは妥当", envelope: model.template("531") },
    fixture("percent 7500", envelope => {
      firstTarget(envelope).load.percentOfVar.percent = 7500;
    }, "percent"),
    fixture("固定重量 6000kg", envelope => {
      firstTarget(envelope).load = { fixed: { _0: 6000 } };
    }, "kg"),
    fixture("fallbackValue 600kg", envelope => {
      envelope.program.variables[0].fallbackValue = 600;
    }, "fallbackValue"),
    fixture("targets と entries の1:1不一致", envelope => {
      firstTarget(envelope).entryId = "unknown-entry";
    }, "組"),
    fixture("存在しない slotId", envelope => {
      firstGroup(envelope).entries[0].slotIds = ["unknown-slot"];
    }, "枠"),
    fixture("同じ stageKey の長さ不一致", envelope => {
      // ルール不要の形で再現: 同キーの count と reps で長さを変える
      firstSetGroup(envelope).count = {
        byStage: { stageKey: "stage", values: [5, 6, 10] },
      };
      firstTarget(envelope).reps = {
        byStage: { stageKey: "stage", values: [5, 3] },
      };
    }, "ステージ"),
    fixture("measureId の同日重複", envelope => {
      const group = firstGroup(envelope);
      const duplicate = structuredClone(group.setGroups[0]);
      duplicate.id = "sg-duplicate";
      group.setGroups.push(duplicate);
    }, "重複"),
    fixture("未定義 measureId の参照", envelope => {
      // minimal テンプレートは endRules が空なので自前でルールを追加する
      envelope.program.phases[0].endRules.push({
        progressIfReached: {
          id: "r-parity",
          varId: envelope.program.variables[0].id,
          measureId: "missing-measure",
          target: { fixed: { _0: 5 } },
          increment: 2.5,
        },
      });
    }, "実測"),
    fixture("必須キー day.pill の欠落", envelope => {
      delete envelope.program.phases[0].days[0].pill;
    }, "キーがありません"),
    fixture("measureId のフェーズ跨ぎ再利用", envelope => {
      const phase = structuredClone(envelope.program.phases[0]);
      phase.id = "phase-2";
      phase.label = "Week 2";
      phase.endRules = [];
      phase.days[0].id = "day-2";
      envelope.program.phases.push(phase);
    }),
  ];

  // JS 検証は廃止したため、wasm(Swiftコア)の結果を期待値と直接照合する。
  // expect: null = 指摘0件 / 文字列 = その語を含む指摘が1件以上
  let failureCount = 0;
  for (const testCase of cases) {
    const knownNames = knownExerciseNames(testCase.envelope);
    const wasmIssues = validateWithWasm(testCase.envelope, knownNames);
    const expect = testCase.expect ?? null;
    const ok = expect === null
      ? wasmIssues.length === 0
      : wasmIssues.some(issue => issue.includes(expect));

    if (ok) {
      console.log(`✓ ${testCase.name}: ${wasmIssues.length}件`);
      continue;
    }

    failureCount += 1;
    console.error(
      [
        `✗ ${testCase.name}`,
        `  期待: ${expect === null ? "指摘なし" : `「${expect}」を含む指摘`}`,
        `  wasm (${wasmIssues.length}): ${wasmIssues.join(" / ") || "指摘なし"}`,
      ].join("\n"),
    );
  }

  if (failureCount) {
    throw new Error(`${failureCount}件の wasm 検証期待値との差異があります`);
  }
  console.log(`\n${cases.length}/${cases.length} wasm expectation cases passed`);

  function validateWithWasm(envelope, knownNames) {
    const exports = instance.exports;
    const encoder = new TextEncoder();
    const envelopeBytes = encoder.encode(JSON.stringify(envelope));
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
      if (!Array.isArray(payload.issues)) {
        throw new Error("core.wasm の結果に issues 配列がありません");
      }
      return payload.issues;
    } finally {
      if (resultPointer) exports.tl_free_result(resultPointer);
      if (namesPointer) exports.tl_free(namesPointer);
      if (envelopePointer) exports.tl_free(envelopePointer);
    }
  }
}

function fixture(name, change = () => {}, expect = null) {
  const envelope = model.template("minimal");
  change(envelope);
  return { name, envelope, expect };
}

function firstGroup(envelope) {
  return envelope.program.phases[0].days[0].groups[0];
}

function firstSetGroup(envelope) {
  return firstGroup(envelope).setGroups[0];
}

function firstTarget(envelope) {
  return firstSetGroup(envelope).targets[0];
}

function knownExerciseNames(envelope) {
  return envelope.program.slots
    .map(slot => slot.exerciseName)
    .filter(name => typeof name === "string" && name.length > 0);
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

function summarize(issue) {
  if (/percent/.test(issue)) return "percent";
  if (/固定重量/.test(issue)) return "fixed-load";
  if (/fallbackValue/.test(issue)) return "fallback-value";
  if (/1:1|セット群と種目の対応/.test(issue)) return "entry-target-pairing";
  if (/種目枠/.test(issue)) return "unknown-slot";
  if (/ステージ表.*長さ|ステージ表の長さ/.test(issue)) return "stage-length";
  if (/同じ日に複数|実測マークが重複/.test(issue)) return "duplicate-measure";
  if (/どの target|参照する実測がありません/.test(issue)) {
    return "unknown-measure";
  }
  if (/pill.*キーがありません|キーがありません.*pill/.test(issue)) {
    return "missing-day-pill";
  }
  return `unclassified:${issue}`;
}
