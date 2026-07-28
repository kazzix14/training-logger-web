import model from "./ui-model.js";
import logic from "./logic.js";

const { enumCase } = logic;
let assertions = 0;
let failures = 0;

function assert(name, condition, detail = "") {
  assertions += 1;
  if (condition) {
    console.log(`✓ ${name}`);
    return;
  }
  failures += 1;
  process.exitCode = 1;
  console.error(`✗ ${name}${detail ? `\n  ${detail}` : ""}`);
}

// 完全な妥当性検証は Swift コア(wasm)の test-parity.mjs 側で行う。
// ここではモデル操作が壊してはいけない構造不変条件だけを検査する:
// エンベロープ形式 / phases 非空 / 各組の entries⇔targets 1:1 /
// entry の slotIds が slots に存在 / ルールの varId が variables に存在
function structuralIssues(envelope) {
  const issues = [];
  if (envelope?.format !== "traininglogger.program") issues.push("format");
  const program = envelope?.program;
  if (!Array.isArray(program?.phases) || program.phases.length === 0) {
    issues.push("phases");
    return issues;
  }
  const slotIds = new Set((program.slots || []).map(slot => slot.id));
  const varIds = new Set((program.variables || []).map(v => v.id));
  program.phases.forEach(phase => {
    (phase.days || []).forEach(day => {
      (day.groups || []).forEach(group => {
        const entryIds = (group.entries || []).map(entry => entry.id);
        (group.entries || []).forEach(entry => {
          (entry.slotIds || []).forEach(id => {
            if (!slotIds.has(id)) issues.push(`slot参照 ${id}`);
          });
        });
        (group.setGroups || []).forEach(sg => {
          const targetIds = (sg.targets || []).map(target => target.entryId);
          if (entryIds.length !== targetIds.length ||
              !entryIds.every(id => targetIds.includes(id))) {
            issues.push(`1:1不一致 ${group.id}/${sg.id}`);
          }
        });
      });
    });
    (phase.endRules || []).forEach(rule => {
      const payload = Object.values(rule)[0] || {};
      for (const key of ["varId", "weightVarId"]) {
        if (payload[key] !== undefined && !varIds.has(payload[key])) {
          issues.push(`変数参照 ${payload[key]}`);
        }
      }
    });
  });
  return issues;
}

function valid(name, envelope) {
  const issues = structuralIssues(envelope);
  assert(name, issues.length === 0, issues.join(" / "));
}

const original = model.template("minimal");
valid("最小テンプレートが構造を持つ", original);
assert(
  "組み込みテンプレートの変数はdimensionを明示する",
  original.program.variables.every(variable => variable.dimension === "load") &&
    model
      .template("531")
      .program.variables.every(variable => variable.dimension === "load")
);
assert(
  "種目枠の型条件は未指定が既定",
  original.program.slots[0].activityRequirement === null,
);
assert(
  "種目枠の重複禁止グループは未指定が既定",
  original.program.slots[0].distinctGroup === null,
);
assert(
  "型付き処方は未指定が既定",
  original.program.phases[0].days[0].groups[0].setGroups[0].targets[0]
    .activityPrescription === null,
);
valid("5/3/1風テンプレートが構造を持つ", model.template("531"));

{
  const changed = model.setValue(original, ["program", "name"], "変更後");
  assert("setValue は元モデルを変更しない", original.program.name !== changed.program.name);
}

{
  const renamed = model.renameReferences(
    original,
    ["program", "variables", 0],
    "renamed_tm",
    ["varId", "weightVarId"],
  );
  assert(
    "ID変更は参照先も同時に配線し直す",
    renamed.program.phases[0].days[0].groups[0].setGroups[0].targets[0].load.percentOfVar
      .varId === "renamed_tm",
  );
  valid("ID変更後も妥当", renamed);
}

{
  const path = ["program", "phases", 0, "days"];
  const added = model.insertItem(original, path, model.createDay(original));
  const moved = model.moveItem(added, path, 1, -1);
  const removed = model.removeItem(moved, path, 1);
  assert("追加・並び替え・削除が純関数として動く", original.program.phases[0].days.length === 1);
  assert("並び替えで順序が変わる", moved.program.phases[0].days[0].label === "新しい日");
  assert("削除で要素数が戻る", removed.program.phases[0].days.length === 1);
}

{
  const phasePath = ["program", "phases"];
  const duplicated = model.duplicateStructure(original, phasePath, 0);
  assert(
    "複製時に構造内IDを再採番する",
    duplicated.program.phases[0].days[0].id !== duplicated.program.phases[1].days[0].id,
  );
  valid("フェーズ複製後も妥当", duplicated);
}

{
  const groupPath = ["program", "phases", 0, "days", 0, "groups", 0];
  const withEntry = model.addEntry(original, groupPath);
  const group = model.getAtPath(withEntry, groupPath);
  assert("種目行追加は全セット群に target を追加する", group.setGroups[0].targets.length === 2);
  assert(
    "種目行はslot配列でなく完全な処方variantを持つ",
    Array.isArray(group.entries[1].variants) &&
      group.entries[1].variants.length === 1 &&
      group.entries[1].slotIds == null,
  );
  valid("種目行追加後も entries と targets は1:1", withEntry);

  const copied = model.duplicateEntry(withEntry, groupPath, 0);
  valid("種目行複製後も entries と targets は1:1", copied);

  const moved = model.moveEntry(copied, groupPath, 0, 1);
  assert(
    "種目行の並び替えに target が追従する",
    model.getAtPath(moved, groupPath).entries[0].id ===
      model.getAtPath(moved, groupPath).setGroups[0].targets[0].entryId,
  );

  const removed = model.removeEntry(moved, groupPath, 0);
  valid("種目行削除後も entries と targets は1:1", removed);
}

{
  const groupPath = ["program", "phases", 0, "days", 0, "groups", 0];
  const added = model.addSetGroup(original, groupPath);
  valid("セット群追加は全 entry の target を作る", added);
}

{
  const targetPath = [
    "program",
    "phases",
    0,
    "days",
    0,
    "groups",
    0,
    "setGroups",
    0,
    "targets",
    0,
  ];
  let changed = model.switchEnum(original, [...targetPath, "reps"], "reps", "range");
  assert("reps切替で妥当な既定値を投入する", changed.program.phases[0].days[0].groups[0].setGroups[0].targets[0].reps.range.lo === 8);
  changed = model.switchEnum(changed, [...targetPath, "load"], "load", "fixed");
  assert("load切替で妥当な既定値を投入する", enumCase(model.getAtPath(changed, [...targetPath, "load"])) === "fixed");
  changed = model.switchEnum(changed, [...groupPathFor(targetPath), "count"], "count", "byStage");
  assert("count切替でステージ表を投入する", model.getAtPath(changed, [...groupPathFor(targetPath), "count"]).byStage.values.length === 3);
  valid("enum切替後も妥当", changed);
}

{
  const cases = {
    reps: ["fixed", "amrap", "range", "byStage", "amrapByStage"],
    load: ["none", "fixed", "percentOfVar", "variable"],
    count: ["fixed", "byStage"],
    extraKind: ["exact", "range"],
    target: ["fixed", "stageReps"],
  };
  for (const [kind, enumCases] of Object.entries(cases)) {
    for (const nextCase of enumCases) {
      const value = model.enumDefault(kind, nextCase, {
        variables: original.program.variables,
      });
      assert(
        `${kind}.${nextCase} の既定形が完全`,
        nextCase === "none" ? value === null : enumCase(value) === nextCase,
      );
    }
  }
}

{
  const phasePath = ["program", "phases", 0];
  const rule = model.ruleDefault("stageDemotion", original);
  const withRule = model.insertItem(original, [...phasePath, "endRules"], rule);
  const switched = model.switchRule(withRule, [...phasePath, "endRules", 0], "always");
  assert("進行ルール切替で5種それぞれの完全な形を作れる", enumCase(switched.program.phases[0].endRules[0]) === "always");
  valid("進行ルール切替後も妥当", switched);
}

{
  const targetPath = [
    "program",
    "phases",
    0,
    "days",
    0,
    "groups",
    0,
    "setGroups",
    0,
    "targets",
    0,
  ];
  const measured = model.setValue(original, [...targetPath, "measureId"], "test_measure");
  for (const ruleCase of [
    "progressIfReached",
    "always",
    "progressByTable",
    "adjustByBand",
    "stageDemotion",
  ]) {
    const withRule = model.insertItem(
      measured,
      ["program", "phases", 0, "endRules"],
      model.ruleDefault(ruleCase, measured),
    );
    valid(`進行ルール ${ruleCase} の既定形は妥当`, withRule);
  }
}

function groupPathFor(targetPath) {
  return targetPath.slice(0, targetPath.indexOf("setGroups") + 2);
}

{
  const dayPath = ["program", "phases", 0, "days", 0];
  const enabled = model.enableSessions(original, dayPath);
  const enabledDay = model.getAtPath(enabled, dayPath);
  assert(
    "複数セッションを有効化すると既存ブロックを先頭へ割り当てる",
    enabledDay.sessions.length === 1 &&
      enabledDay.groups.every(group => group.sessionID === enabledDay.sessions[0].id)
  );

  const added = model.addSession(enabled, dayPath);
  const addedDay = model.getAtPath(added, dayPath);
  assert(
    "同じ日にセッションを追加できる",
    addedDay.sessions.length === 2 &&
      addedDay.sessions[0].id !== addedDay.sessions[1].id
  );

  const assigned = model.setValue(
    added,
    [...dayPath, "groups", 0, "sessionID"],
    addedDay.sessions[1].id
  );
  const removed = model.removeSession(assigned, dayPath, 1);
  const removedDay = model.getAtPath(removed, dayPath);
  assert(
    "セッション削除時に所属ブロックを残るセッションへ移す",
    removedDay.sessions.length === 1 &&
      removedDay.groups[0].sessionID === removedDay.sessions[0].id
  );

  const disabled = model.removeSession(removed, dayPath, 0);
  const disabledDay = model.getAtPath(disabled, dayPath);
  assert(
    "最後のセッションを削除すると単一セッション形式へ戻る",
    disabledDay.sessions === null &&
      disabledDay.groups.every(group => group.sessionID === null)
  );
  valid("セッション編集後も妥当", disabled);
}

console.log(`\n${assertions - failures}/${assertions} assertions passed`);
