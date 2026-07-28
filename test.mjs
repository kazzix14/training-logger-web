// logic.js(表示テキスト・base64url)のテスト。
// 検証はSwiftコア(wasm)一本のため test-parity.mjs 側で担保する(ADR-0074改)
import logic from "./logic.js";

let passed = 0;
let failed = 0;
function assert(name, condition, detail = "") {
  if (condition) { passed += 1; console.log(`✓ ${name}`); }
  else { failed += 1; console.error(`✗ ${name}${detail ? `\n  ${detail}` : ""}`); }
}

assert("repsText fixed", logic.repsText({ fixed: { _0: 5 } }) === "5回");
assert("repsText amrap", logic.repsText({ amrap: { min: 3 } }).includes("3+"));
assert("repsText range", logic.repsText({ range: { lo: 8, hi: 12 } }).includes("8〜12"));
assert("countText byStage",
       logic.countText({ byStage: { stageKey: "t", values: [5, 6, 10] } }).includes("5→6→10"));
assert("loadText percent",
  logic.loadText({ percentOfVar: { varId: "v", percent: 0.75, annotate: true } }, [
         { id: "v", label: "TM" },
       ]).includes("75%"));
assert("loadText 自由重量", logic.loadText(null, []) === "自由重量");
assert("ruleText stageDemotion",
       logic.ruleText({ stageDemotion: { id: "r", stageKey: "t", measureId: "m",
         stageTargets: [15, 12, 10], weightVarId: "v", resetFactor: 0.9,
         resetThreshold: 0 } }, [{ id: "v", label: "TM" }]).includes("ステージ0"));

const roundTrip = logic.b64urlDecode(logic.b64urlEncode("日本語もOK: 100kg×5"));
assert("b64url 往復(日本語)", roundTrip === "日本語もOK: 100kg×5");

console.log(`\n${passed}/${passed + failed} assertions passed`);
if (failed) process.exitCode = 1;
