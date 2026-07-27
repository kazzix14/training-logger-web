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

const ENUM_SHAPES = {
  reps: {
    fixed: ["_0"], amrap: ["min"], range: ["lo", "hi"],
    byStage: ["stageKey", "values"], amrapByStage: ["stageKey", "values"],
  },
  load: {
    fixed: ["_0"], percentOfVar: ["varId", "percent", "annotate"], variable: ["varId"],
  },
  count: { fixed: ["_0"], byStage: ["stageKey", "values"] },
  extraKind: { exact: ["_0"], range: ["lo", "hi"] },
  rule: {
    progressIfReached: ["id", "varId", "measureId", "target", "increment"],
    always: ["id", "varId", "increment"],
    progressByTable: ["id", "varId", "measureId", "steps"],
    adjustByBand: ["id", "varId", "measureId", "lower", "upper", "delta"],
    stageDemotion: ["id", "stageKey", "measureId", "stageTargets",
                    "weightVarId", "resetFactor", "resetThreshold"],
  },
  target: { fixed: ["_0"], stageReps: ["stageKey", "values"] },
};

function checkEnum(value, kind, path, errors, optional) {
  if (value == null) {
    if (!optional) errors.push(`${path}: 必須です`);
    return null;
  }
  const c = enumCase(value);
  const shapes = ENUM_SHAPES[kind];
  if (!c || !shapes[c]) {
    errors.push(`${path}: 未知の形です(${JSON.stringify(value).slice(0, 60)}) — 使える形: ${Object.keys(shapes).join(" / ")}`);
    return null;
  }
  const payload = value[c];
  for (const key of shapes[c]) {
    if (payload == null || payload[key] === undefined) {
      errors.push(`${path}.${c}: キー ${key} がありません`);
    }
  }
  return c;
}

function req(obj, key, type, path, errors) {
  const v = obj ? obj[key] : undefined;
  if (v === undefined) {
    errors.push(`${path}.${key}: キーがありません(既定値があるキーも省略できません)`);
    return undefined;
  }
  if (v === null || (type === "array" ? !Array.isArray(v) : typeof v !== type)) {
    errors.push(`${path}.${key}: 型が違います(${type} を期待)`);
    return undefined;
  }
  return v;
}

function sameMembers(left, right) {
  if (left.length !== right.length) return false;
  const counts = new Map();
  left.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
  right.forEach(value => counts.set(value, (counts.get(value) || 0) - 1));
  return [...counts.values()].every(count => count === 0);
}

function validate(env) {
  const errors = [];
  if (!env || typeof env !== "object") return ["JSONオブジェクトではありません"];
  if (env.format !== "traininglogger.program") errors.push(`format が "${env.format}"(traininglogger.program を期待)`);
  if (env.version !== 1) errors.push(`version ${env.version} は未対応(1 を期待)`);
  const p = env.program;
  if (!p) { errors.push("program がありません"); return errors; }

  req(p, "name", "string", "program", errors);
  req(p, "note", "string", "program", errors);
  const variables = req(p, "variables", "array", "program", errors) || [];
  const slots = req(p, "slots", "array", "program", errors) || [];
  const phases = req(p, "phases", "array", "program", errors) || [];

  const slotIds = new Set();
  slots.forEach((s, i) => {
    const path = `slots[${i}]`;
    req(s, "id", "string", path, errors);
    req(s, "label", "string", path, errors);
    req(s, "muscleKeys", "array", path, errors);
    req(s, "conditionText", "string", path, errors);
    if (s.id) slotIds.add(s.id);
  });
  const varIds = new Set();
  variables.forEach((v, i) => {
    const path = `variables[${i}]`;
    req(v, "id", "string", path, errors);
    req(v, "label", "string", path, errors);
    req(v, "unit", "string", path, errors);
    req(v, "fallbackValue", "number", path, errors);
    if (v.id) varIds.add(v.id);
    if (typeof v.fallbackValue === "number" && !(v.fallbackValue > 0 && v.fallbackValue <= 500)) {
      errors.push(`${path}: fallbackValue ${v.fallbackValue}kg(0超〜500kgの範囲外)`);
    }
  });

  if (phases.length === 0) errors.push("フェーズ(週)がありません");
  const measureIds = new Set(); // 参照存在チェック用(プログラム全体)
  const stageLengths = new Map(); // stageKey -> Set(lengths)

  const noteStage = (key, len) => {
    if (!stageLengths.has(key)) stageLengths.set(key, new Set());
    stageLengths.get(key).add(len);
  };

  phases.forEach((phase, pi) => {
    const ppath = `phases[${pi}]`;
    req(phase, "id", "string", ppath, errors);
    req(phase, "label", "string", ppath, errors);
    const days = req(phase, "days", "array", ppath, errors) || [];
    const endRules = req(phase, "endRules", "array", ppath, errors) || [];

    days.forEach((day, di) => {
      const dpath = `${ppath}.days[${di}]`;
      // 実測マークの重複は「同じ日の中」だけが違反(アプリの dayMeasureIds と同じ)。
      // 5/3/1 のように複数フェーズ・日が同じ measureId を持つのは正当
      const dayMeasureIds = new Set();
      req(day, "id", "string", dpath, errors);
      req(day, "label", "string", dpath, errors);
      req(day, "pill", "string", dpath, errors);
      const groups = req(day, "groups", "array", dpath, errors) || [];
      if (groups.length === 0) errors.push(`${dpath}: 種目がありません(groups が空)`);
      groups.forEach((group, gi) => {
        const gpath = `${dpath}.groups[${gi}]`;
        req(group, "id", "string", gpath, errors);
        const entries = req(group, "entries", "array", gpath, errors) || [];
        const setGroups = req(group, "setGroups", "array", gpath, errors) || [];
        if (entries.length === 0) errors.push(`${gpath}: entries が空です`);
        if (setGroups.length === 0) errors.push(`${gpath}: setGroups が空です`);
        const entryIds = entries.map(e => e.id);
        entries.forEach((entry, ei) => {
          const epath = `${gpath}.entries[${ei}]`;
          req(entry, "id", "string", epath, errors);
          let ids;
          if (entry.slotIds !== undefined) {
            ids = req(entry, "slotIds", "array", epath, errors) || [];
          } else if (entry.slotId !== undefined) {
            const slotId = req(entry, "slotId", "string", epath, errors);
            ids = slotId ? [slotId] : [];
          } else {
            errors.push(`${epath}.slotIds: キーがありません(既定値があるキーも省略できません)`);
            ids = [];
          }
          if (ids.length === 0) errors.push(`${epath}: slotIds が空です`);
          if (ids.length > 12) errors.push(`${epath}: ローテーション周期が12を超えています`);
          ids.forEach(id => { if (!slotIds.has(id)) errors.push(`${epath}: 種目枠 ${id} が slots にありません`); });
        });
        setGroups.forEach((sg, si) => {
          const spath = `${gpath}.setGroups[${si}]`;
          req(sg, "id", "string", spath, errors);
          const countCase = checkEnum(sg.count, "count", `${spath}.count`, errors, false);
          if (countCase === "byStage") noteStage(sg.count.byStage.stageKey, (sg.count.byStage.values || []).length);
          const targets = req(sg, "targets", "array", spath, errors) || [];
          const targetIds = targets.map(t => t.entryId);
          if (!sameMembers(entryIds, targetIds)) {
            errors.push(`${spath}: targets が entries と1:1対応していません(entries: ${entryIds.join(",")} / targets: ${targetIds.join(",")})`);
          }
          targets.forEach((target, ti) => {
            const tpath = `${spath}.targets[${ti}]`;
            req(target, "entryId", "string", tpath, errors);
            const repsCase = checkEnum(target.reps, "reps", `${tpath}.reps`, errors, false);
            if (repsCase === "byStage" || repsCase === "amrapByStage") {
              const payload = enumPayload(target.reps);
              noteStage(payload.stageKey, (payload.values || []).length);
            }
            const loadCase = checkEnum(target.load, "load", `${tpath}.load`, errors, true);
            if (loadCase === "fixed") {
              const kg = target.load.fixed._0;
              if (typeof kg !== "number" || !(kg > 0 && kg <= 500)) {
                errors.push(`${tpath}: 固定重量 ${kg}kg(0超〜500kgの範囲外)`);
              }
            }
            if (loadCase === "percentOfVar") {
              const { varId, percent } = target.load.percentOfVar;
              if (!varIds.has(varId)) errors.push(`${tpath}: 基準重量 ${varId} が variables にありません`);
              if (typeof percent !== "number" || !(percent > 0 && percent <= 200)) {
                errors.push(`${tpath}: percent ${percent}(0超〜200の範囲外。75% は 75 と書く)`);
              }
            }
            if (loadCase === "variable" && !varIds.has(target.load.variable.varId)) {
              errors.push(`${tpath}: 基準重量 ${target.load.variable.varId} が variables にありません`);
            }
            const extras = req(target, "extras", "array", tpath, errors) || [];
            extras.forEach((extra, xi) => {
              const xpath = `${tpath}.extras[${xi}]`;
              req(extra, "fieldKey", "string", xpath, errors);
              checkEnum(extra.kind, "extraKind", `${xpath}.kind`, errors, false);
            });
            if (target.measureId) {
              measureIds.add(target.measureId);
              if (dayMeasureIds.has(target.measureId)) {
                errors.push(`${dpath}: 実測マーク ${target.measureId} が同じ日に複数あります(1日1箇所のみ)`);
              }
              dayMeasureIds.add(target.measureId);
            }
          });
        });
      });
    });

    endRules.forEach((rule, ri) => {
      const rpath = `${ppath}.endRules[${ri}]`;
      const c = checkEnum(rule, "rule", rpath, errors, false);
      if (!c) return;
      const payload = rule[c];
      if (payload.varId !== undefined && !varIds.has(payload.varId)) {
        errors.push(`${rpath}: 基準重量 ${payload.varId} が variables にありません`);
      }
      if (payload.weightVarId !== undefined && !varIds.has(payload.weightVarId)) {
        errors.push(`${rpath}: 基準重量 ${payload.weightVarId} が variables にありません`);
      }
      const checkInc = (v, label) => {
        if (typeof v !== "number" || !(v > 0 && v <= 50)) {
          errors.push(`${rpath}: ${label} ${v}kg(0超〜50kgの範囲外)`);
        }
      };
      if (c === "progressIfReached" || c === "always") checkInc(payload.increment, "increment");
      if (c === "adjustByBand") checkInc(payload.delta, "delta");
      if (c === "progressByTable") {
        const steps = Array.isArray(payload.steps) ? payload.steps : [];
        if (!Array.isArray(payload.steps)) errors.push(`${rpath}.progressByTable.steps: 型が違います(array を期待)`);
        steps.forEach((step, si) => {
          req(step, "atLeast", "number", `${rpath}.progressByTable.steps[${si}]`, errors);
          req(step, "increment", "number", `${rpath}.progressByTable.steps[${si}]`, errors);
          checkInc(step.increment, "increment");
        });
      }
      if (c === "stageDemotion") {
        if (typeof payload.resetFactor !== "number" ||
            !(payload.resetFactor > 0 && payload.resetFactor <= 1)) {
          errors.push(`${rpath}: resetFactor ${payload.resetFactor}(0超〜1の範囲外)`);
        }
        noteStage(payload.stageKey, (payload.stageTargets || []).length);
      }
      if (c === "progressIfReached") {
        const targetCase = checkEnum(payload.target, "target", `${rpath}.target`, errors, false);
        if (targetCase === "stageReps") {
          const target = payload.target.stageReps;
          noteStage(target.stageKey, (target.values || []).length);
        }
      }
    });
  });

  // 実測参照の整合(フェーズ横断で収集後に検証)
  const referencedMeasures = [];
  phases.forEach(phase => (phase.endRules || []).forEach(rule => {
    const payload = enumPayload(rule);
    if (payload && payload.measureId) referencedMeasures.push(payload.measureId);
  }));
  referencedMeasures.forEach(id => {
    if (!measureIds.has(id)) errors.push(`実測 ${id} を参照するルールがありますが、どの target にも measureId がありません`);
  });
  stageLengths.forEach((lengths, key) => {
    if (lengths.size > 1) errors.push(`ステージ表 ${key} の長さが揃っていません(${[...lengths].join(" / ")})`);
  });
  return errors;
}

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
    ENUM_SHAPES,
    b64urlDecode,
    b64urlEncode,
    countText,
    enumCase,
    enumPayload,
    loadText,
    repsText,
    ruleText,
    validate,
  };
}
