// TrainingLogger プログラムリーダー・ビルダー
// 形式: traininglogger.program v1 (本体リポジトリ docs/formats/program-json.md)
// 検証ルールはアプリ(ProgramTransfer / BuilderIssue)と揃えている。

"use strict";

let envelope = null; // {format, version, program}

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
