// TrainingLogger プログラム形式の共通ロジック
// ブラウザでは app.js より先に読み込み、Node では module.exports から利用する。

"use strict";

// ---------- base64url ----------

function b64urlDecode(str) {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------- enum ヘルパ ----------

function enumCase(value) {
  if (value == null || typeof value !== "object") return null;
  const keys = Object.keys(value);
  return keys.length === 1 ? keys[0] : null;
}

function enumPayload(value) {
  const c = enumCase(value);
  return c ? value[c] : null;
}

// ---------- 検証(アプリと同じ10項目 + enum形状) ----------

// ---------- 表示テキスト ----------

function repsText(reps) {
  const c = enumCase(reps);
  const p = enumPayload(reps);
  switch (c) {
    case "fixed": return `${p._0}回`;
    case "amrap": return `${p.min}+回(限界まで)`;
    case "range": return `${p.lo}〜${p.hi}回`;
    case "byStage": return `ステージ表 ${p.values.join("→")}回`;
    case "amrapByStage": return `ステージ表 ${p.values.map(v => v + "+").join("→")}回`;
    default: return "?回";
  }
}

function loadText(load, variables) {
  if (load == null) return "自由重量";
  const c = enumCase(load);
  const p = enumPayload(load);
  const varLabel = id => (variables.find(v => v.id === id) || { label: id }).label;
  switch (c) {
    case "fixed": return `${p._0}kg`;
    case "percentOfVar": return `${varLabel(p.varId)}の<span class="pct">${p.percent}%</span>`;
    case "variable": return `${varLabel(p.varId)}そのまま`;
    default: return "?";
  }
}

function countText(count) {
  const c = enumCase(count);
  const p = enumPayload(count);
  if (c === "fixed") return `${p._0}セット`;
  if (c === "byStage") return `ステージ表 ${p.values.join("→")}セット`;
  return "?セット";
}

function ruleText(rule, variables) {
  const c = enumCase(rule);
  const p = enumPayload(rule);
  const varLabel = id => (variables.find(v => v.id === id) || { label: id }).label;
  switch (c) {
    case "progressIfReached": {
      const t = enumCase(p.target) === "fixed"
        ? `${p.target.fixed._0}`
        : `ステージ表 ${p.target.stageReps.values.join("→")}`;
      return `<span class="kind">達成で加重</span> — 実測 ${p.measureId} が ${t} 以上なら ${varLabel(p.varId)} +${p.increment}kg`;
    }
    case "always":
      return `<span class="kind">毎回加重</span> — ${varLabel(p.varId)} +${p.increment}kg(無条件)`;
    case "progressByTable": {
      const steps = p.steps.map(s => `${s.atLeast}回以上→+${s.increment}kg`).join(" / ");
      return `<span class="kind">実測テーブル加重</span> — 実測 ${p.measureId}: ${steps}(対象 ${varLabel(p.varId)})`;
    }
    case "adjustByBand":
      return `<span class="kind">帯で自動調整</span> — 実測 ${p.measureId} が ${p.upper} 超で +${p.delta}kg、${p.lower} 未満で −${p.delta}kg(対象 ${varLabel(p.varId)})`;
    case "stageDemotion":
      return `<span class="kind">ステージ降格(GZCLP)</span> — 実測 ${p.measureId} が目標 ${p.stageTargets.join("→")} 未達で次ステージへ。最終段でも失敗したら ${varLabel(p.weightVarId)} を ×${p.resetFactor} してステージ0へ`;
    default:
      return "?";
  }
}

if (typeof module !== "undefined") {
  module.exports = {
    b64urlDecode,
    b64urlEncode,
    countText,
    enumCase,
    enumPayload,
    loadText,
    repsText,
    ruleText,
  };
}
