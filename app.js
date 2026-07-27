// TrainingLogger プログラムリーダー・ビルダー
// 形式: traininglogger.program v1 (本体リポジトリ docs/formats/program-json.md)
// 検証ルールはアプリ(ProgramTransfer / BuilderIssue)と揃えている。

"use strict";

let envelope = null; // {format, version, program}

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
  if (v === undefined) { errors.push(`${path}.${key}: キーがありません(既定値があるキーも省略できません)`); return undefined; }
  if (type === "array" ? !Array.isArray(v) : (v !== null && typeof v !== type)) {
    errors.push(`${path}.${key}: 型が違います(${type} を期待)`);
  }
  return v;
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
  const measureIds = new Map(); // id -> count
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
      req(day, "id", "string", dpath, errors);
      req(day, "label", "string", dpath, errors);
      req(day, "pill", "string", dpath, errors);
      const groups = req(day, "groups", "array", dpath, errors) || [];
      if (groups.length === 0) errors.push(`${dpath}: 種目がありません(groups が空)`);
      groups.forEach((group, gi) => {
        const gpath = `${dpath}.groups[${gi}]`;
        const entries = req(group, "entries", "array", gpath, errors) || [];
        const setGroups = req(group, "setGroups", "array", gpath, errors) || [];
        if (entries.length === 0) errors.push(`${gpath}: entries が空です`);
        if (setGroups.length === 0) errors.push(`${gpath}: setGroups が空です`);
        const entryIds = entries.map(e => e.id);
        entries.forEach((entry, ei) => {
          const epath = `${gpath}.entries[${ei}]`;
          const ids = entry.slotIds || (entry.slotId ? [entry.slotId] : []);
          if (ids.length === 0) errors.push(`${epath}: slotIds が空です`);
          if (ids.length > 12) errors.push(`${epath}: ローテーション周期が12を超えています`);
          ids.forEach(id => { if (!slotIds.has(id)) errors.push(`${epath}: 種目枠 ${id} が slots にありません`); });
        });
        setGroups.forEach((sg, si) => {
          const spath = `${gpath}.setGroups[${si}]`;
          const countCase = checkEnum(sg.count, "count", `${spath}.count`, errors, false);
          if (countCase === "byStage") noteStage(sg.count.byStage.stageKey, (sg.count.byStage.values || []).length);
          const targets = req(sg, "targets", "array", spath, errors) || [];
          const targetIds = targets.map(t => t.entryId);
          if (entryIds.length !== targetIds.length ||
              !entryIds.every(id => targetIds.includes(id))) {
            errors.push(`${spath}: targets が entries と1:1対応していません(entries: ${entryIds.join(",")} / targets: ${targetIds.join(",")})`);
          }
          targets.forEach((target, ti) => {
            const tpath = `${spath}.targets[${ti}]`;
            const repsCase = checkEnum(target.reps, "reps", `${tpath}.reps`, errors, false);
            if (repsCase === "byStage" || repsCase === "amrapByStage") {
              const payload = enumPayload(target.reps);
              noteStage(payload.stageKey, (payload.values || []).length);
            }
            const loadCase = checkEnum(target.load, "load", `${tpath}.load`, errors, true);
            if (loadCase === "fixed") {
              const kg = target.load.fixed._0;
              if (!(kg > 0 && kg <= 500)) errors.push(`${tpath}: 固定重量 ${kg}kg(0超〜500kgの範囲外)`);
            }
            if (loadCase === "percentOfVar") {
              const { varId, percent } = target.load.percentOfVar;
              if (!varIds.has(varId)) errors.push(`${tpath}: 基準重量 ${varId} が variables にありません`);
              if (!(percent > 0 && percent <= 200)) errors.push(`${tpath}: percent ${percent}(0超〜200の範囲外。75% は 75 と書く)`);
            }
            if (loadCase === "variable" && !varIds.has(target.load.variable.varId)) {
              errors.push(`${tpath}: 基準重量 ${target.load.variable.varId} が variables にありません`);
            }
            (target.extras || []).forEach((extra, xi) => {
              checkEnum(extra.kind, "extraKind", `${tpath}.extras[${xi}].kind`, errors, false);
            });
            if (target.measureId) {
              measureIds.set(target.measureId, (measureIds.get(target.measureId) || 0) + 1);
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
        if (typeof v === "number" && !(v > 0 && v <= 50)) errors.push(`${rpath}: ${label} ${v}kg(0超〜50kgの範囲外)`);
      };
      if (c === "progressIfReached" || c === "always") checkInc(payload.increment, "increment");
      if (c === "adjustByBand") checkInc(payload.delta, "delta");
      if (c === "progressByTable") (payload.steps || []).forEach(s => checkInc(s.increment, "increment"));
      if (c === "stageDemotion") {
        if (!(payload.resetFactor > 0 && payload.resetFactor <= 1)) {
          errors.push(`${rpath}: resetFactor ${payload.resetFactor}(0超〜1の範囲外)`);
        }
        noteStage(payload.stageKey, (payload.stageTargets || []).length);
      }
      if (c === "progressIfReached") checkEnum(payload.target, "target", `${rpath}.target`, errors, false);
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
  measureIds.forEach((count, id) => {
    if (count > 1) errors.push(`実測マーク ${id} が${count}箇所にあります(1箇所のみ)`);
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

// ---------- 編集ヘルパ ----------

function setPath(obj, pathStr, value) {
  const parts = pathStr.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur[/^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i]];
    if (cur == null) return;
  }
  const last = parts[parts.length - 1];
  cur[/^\d+$/.test(last) ? Number(last) : last] = value;
}

function bindInput(input, pathStr, isNumber) {
  input.addEventListener("input", () => {
    const raw = input.value;
    const value = isNumber ? (raw === "" ? 0 : Number(raw)) : raw;
    if (isNumber && Number.isNaN(value)) return;
    setPath(envelope, pathStr, value);
    refreshJSON();
  });
}

function el(tag, cls, html) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function textInput(pathStr, value, cls) {
  const input = el("input", cls || "");
  input.type = "text";
  input.value = value ?? "";
  bindInput(input, pathStr, false);
  return input;
}

function numberInput(pathStr, value, step) {
  const input = el("input");
  input.type = "number";
  input.step = step || "0.5";
  input.value = value ?? "";
  bindInput(input, pathStr, true);
  return input;
}

function labeledRow(labelText, control) {
  const row = el("div", "row");
  const label = el("label", "", labelText);
  row.append(label, control);
  return row;
}

// ---------- 描画 ----------

function render() {
  const editor = document.getElementById("editor");
  editor.innerHTML = "";
  if (!envelope) {
    editor.classList.add("hidden");
    document.getElementById("empty-state").classList.remove("hidden");
    return;
  }
  editor.classList.remove("hidden");
  document.getElementById("empty-state").classList.add("hidden");
  const program = envelope.program;
  const variables = program.variables || [];

  // 概要
  const head = el("div", "card");
  head.append(el("h3", "", "プログラム"));
  head.append(labeledRow("名前", textInput("program.name", program.name, "wide")));
  head.append(labeledRow("メモ", textInput("program.note", program.note, "wide")));
  editor.append(head);

  // 基準重量
  if (variables.length) {
    const card = el("div", "card");
    card.append(el("h3", "", "基準重量(進行ルールが増減させる)"));
    variables.forEach((variable, vi) => {
      const row = el("div", "row");
      row.append(textInput(`program.variables.${vi}.label`, variable.label));
      row.append(el("span", "", "初期値"));
      row.append(numberInput(`program.variables.${vi}.fallbackValue`, variable.fallbackValue));
      row.append(el("span", "", variable.unit || "kg"));
      if (variable.e1rmFactor != null) {
        row.append(el("span", "chip", `採用時 e1RM×${variable.e1rmFactor}`));
      }
      card.append(row);
    });
    editor.append(card);
  }

  // 種目枠
  const slotCard = el("div", "card");
  slotCard.append(el("h3", "", "種目枠"));
  (program.slots || []).forEach((slot, si) => {
    const row = el("div", "row");
    row.append(el("span", "", slot.label || slot.id));
    row.append(textInput(`program.slots.${si}.exerciseName`, slot.exerciseName ?? ""));
    (slot.muscleKeys || []).forEach(key => row.append(el("span", "chip", key)));
    if (!slot.exerciseName) row.append(el("span", "chip", "採用時に選ぶ条件枠"));
    slotCard.append(row);
  });
  editor.append(slotCard);

  // フェーズ
  (program.phases || []).forEach((phase, pi) => {
    const card = el("div", "card phase");
    const title = el("div", "row");
    title.append(el("h3", "", `フェーズ: ${phase.label || phase.id}`));
    if (phase.windowDays != null) title.append(el("span", "chip", `${phase.windowDays}日サイクル`));
    if (phase.nextPhaseId) title.append(el("span", "chip", `次 → ${phase.nextPhaseId}`));
    card.append(title);

    (phase.days || []).forEach((day, di) => {
      const dayEl = el("div", "day");
      dayEl.append(el("div", "day-title", `${day.label}${day.pill ? ` <span class="chip">${day.pill}</span>` : ""}`));
      (day.groups || []).forEach((group, gi) => {
        const groupEl = el("div", "group");
        const entries = group.entries || [];
        if (entries.length > 1) groupEl.append(el("div", "superset", `スーパーセット(${entries.length}種目)`));
        (group.setGroups || []).forEach((sg, si) => {
          const base = `program.phases.${pi}.days.${di}.groups.${gi}.setGroups.${si}`;
          (sg.targets || []).forEach((target, ti) => {
            const entry = entries.find(e => e.id === target.entryId) || {};
            const slotName = slotNameFor(program, entry);
            const targetEl = el("div", "target");
            const extras = (target.extras || []).map(x => {
              const kind = enumCase(x.kind);
              const p = enumPayload(x.kind);
              const label = x.fieldKey === "rpe.rpe" ? "RPE" : x.fieldKey;
              return kind === "exact" ? `${label}${p._0}` : `${label}${p.lo}〜${p.hi}`;
            }).join(" ");
            targetEl.append(el("div", "prescription",
              `${slotName} — ${countText(sg.count)} × ${repsText(target.reps)} @ ${loadText(target.load, variables)}` +
              (extras ? ` <span class="chip">${extras}</span>` : "") +
              (target.measureId ? ` <span class="measure-chip">実測 ${target.measureId}</span>` : "")));

            const controls = el("div", "row");
            const loadCase = enumCase(target.load);
            if (loadCase === "percentOfVar") {
              controls.append(el("span", "", "percent"));
              controls.append(numberInput(`${base}.targets.${ti}.load.percentOfVar.percent`, target.load.percentOfVar.percent, "2.5"));
            } else if (loadCase === "fixed") {
              controls.append(el("span", "", "kg"));
              controls.append(numberInput(`${base}.targets.${ti}.load.fixed._0`, target.load.fixed._0));
            }
            const repsCase = enumCase(target.reps);
            if (repsCase === "fixed") {
              controls.append(el("span", "", "回数"));
              controls.append(numberInput(`${base}.targets.${ti}.reps.fixed._0`, target.reps.fixed._0, "1"));
            } else if (repsCase === "amrap") {
              controls.append(el("span", "", "最低回数"));
              controls.append(numberInput(`${base}.targets.${ti}.reps.amrap.min`, target.reps.amrap.min, "1"));
            } else if (repsCase === "range") {
              controls.append(el("span", "", "回数"));
              controls.append(numberInput(`${base}.targets.${ti}.reps.range.lo`, target.reps.range.lo, "1"));
              controls.append(el("span", "", "〜"));
              controls.append(numberInput(`${base}.targets.${ti}.reps.range.hi`, target.reps.range.hi, "1"));
            }
            if (enumCase(sg.count) === "fixed" && ti === 0) {
              controls.append(el("span", "", "セット数"));
              controls.append(numberInput(`${base}.count.fixed._0`, sg.count.fixed._0, "1"));
            }
            if (controls.childNodes.length) targetEl.append(controls);
            groupEl.append(targetEl);
          });
        });
        dayEl.append(groupEl);
      });
      card.append(dayEl);
    });

    if ((phase.endRules || []).length) {
      card.append(el("h3", "", "進行ルール(フェーズ終了時)"));
      phase.endRules.forEach(rule => card.append(el("div", "rule", ruleText(rule, variables))));
    } else {
      card.append(el("div", "rule", "⚠ 進行ルールがありません(進行しないプログラム)"));
    }
    editor.append(card);
  });
}

function slotNameFor(program, entry) {
  const ids = entry.slotIds || (entry.slotId ? [entry.slotId] : []);
  const names = ids.map(id => {
    const slot = (program.slots || []).find(s => s.id === id);
    return slot ? (slot.exerciseName || slot.label || id) : id;
  });
  return names.join(" ⇄ ") || "(種目なし)";
}

// ---------- JSON パネル ----------

function refreshJSON() {
  document.getElementById("json-text").value = JSON.stringify(envelope, null, 2);
  showErrors(validate(envelope));
}

function showErrors(errors) {
  const box = document.getElementById("errors");
  if (!errors.length) {
    box.classList.add("hidden");
    setStatus("検証OK — アプリにインポートできます", "ok");
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = `<strong>検証エラー ${errors.length}件</strong><ul>` +
    errors.map(e => `<li>${e}</li>`).join("") + "</ul>";
  setStatus(`検証エラーが${errors.length}件あります`, "err");
}

let statusTimer = null;
function setStatus(text, kind) {
  const node = document.getElementById("status");
  node.textContent = text;
  node.className = `status ${kind}`;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => node.classList.add("hidden"), 4000);
}

function applyFromTextarea() {
  const text = document.getElementById("json-text").value.trim();
  if (!text) return;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    showErrors([`JSONとして読めません: ${error.message}`]);
    return;
  }
  envelope = parsed;
  const errors = validate(envelope);
  showErrors(errors);
  render();
}

// ---------- 起動 ----------

document.getElementById("btn-apply").addEventListener("click", applyFromTextarea);
document.getElementById("btn-format").addEventListener("click", () => {
  try {
    const parsed = JSON.parse(document.getElementById("json-text").value);
    document.getElementById("json-text").value = JSON.stringify(parsed, null, 2);
  } catch (error) {
    showErrors([`JSONとして読めません: ${error.message}`]);
  }
});
document.getElementById("btn-copy").addEventListener("click", async () => {
  if (!envelope) { setStatus("プログラムがありません", "err"); return; }
  await navigator.clipboard.writeText(JSON.stringify(envelope, null, 2));
  setStatus("JSONをコピーしました — アプリの「JSONを読み込む」へ", "ok");
});
document.getElementById("btn-link").addEventListener("click", async () => {
  if (!envelope) { setStatus("プログラムがありません", "err"); return; }
  const url = `${location.origin}${location.pathname}#p=${b64urlEncode(JSON.stringify(envelope))}`;
  await navigator.clipboard.writeText(url);
  setStatus("共有リンクをコピーしました", "ok");
});
document.getElementById("json-text").addEventListener("input", () => {
  // 手編集中は反映ボタン待ち。ステータスだけ薄く出す
});

(function boot() {
  const match = location.hash.match(/#p=([A-Za-z0-9_-]+)/);
  if (!match) return;
  try {
    const json = b64urlDecode(match[1]);
    envelope = JSON.parse(json);
    document.getElementById("json-text").value = JSON.stringify(envelope, null, 2);
    showErrors(validate(envelope));
    render();
  } catch (error) {
    setStatus(`リンクのデータを読めません: ${error.message}`, "err");
  }
})();
