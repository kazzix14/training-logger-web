import reader from "./reader-model.js";
import ui from "./ui-model.js";

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

{
  const envelope = ui.template("531");
  const stats = reader.collectStatistics(envelope.program);
  assert("統計はフェーズ数を集計する", stats.phaseCount === 4);
  assert("統計はサイクルから週日数を算出する", stats.weeklyDays === 1);
  assert("統計は種目枠を種目数として数える", stats.exerciseCount === 1);
  assert("統計は全対象の推定セット数を集計する", stats.estimatedSets === 12);
  assert("統計は全フェーズのサイクル日数を集計する", stats.cycleDays === 28);
}

{
  const envelope = ui.template("minimal");
  const program = envelope.program;
  program.slots[0].exerciseName = "スクワット";
  program.slots.push({
    id: "front_squat",
    label: "フロントスクワット枠",
    exerciseUuid: null,
    exerciseName: "フロントスクワット",
    muscleKeys: ["quadriceps"],
    conditionText: "",
  });
  const group = program.phases[0].days[0].groups[0];
  const entry = group.entries[0];
  entry.slotIds = ["main", "front_squat"];
  const setGroup = group.setGroups[0];
  setGroup.count = { fixed: { _0: 3 } };
  const target = setGroup.targets[0];
  target.reps = { fixed: { _0: 5 } };
  target.load = {
    percentOfVar: { varId: "main_tm", percent: 75, annotate: true },
  };
  target.extras = [{ fieldKey: "rpe", kind: { exact: { _0: 8 } } }];
  target.measureId = "squat_top";

  const prescription = reader.formatPrescription(program, group, setGroup, target);
  assert(
    "処方行はローテーション・セット・回数・重量・RPE・実測を一文にする",
    prescription.text ===
      "スクワット ⇄ フロントスクワット — 3セット × 5回 @ メイン種目 TMの75% (RPE 8)〔実測〕",
    prescription.text,
  );
}

{
  const envelope = ui.template("minimal");
  const program = envelope.program;
  program.slots[0].exerciseName = "スクワット";
  const target =
    program.phases[0].days[0].groups[0].setGroups[0].targets[0];
  target.measureId = "squat_measure";
  const references = reader.collectMeasureReferences(program);
  assert(
    "実測参照はフェーズ・日・ブロック・セットを解決する",
    references.squat_measure.description.includes(
      "「フェーズ 1」の「Day 1」、ブロック1・セット1",
    ),
    references.squat_measure.description,
  );

  const rule = {
    progressIfReached: {
      id: "progress",
      varId: "main_tm",
      measureId: "squat_measure",
      target: { fixed: { _0: 5 } },
      increment: 2.5,
    },
  };
  const formatted = reader.formatReaderRule(
    rule,
    program.variables,
    references,
  );
  assert("進行ルールは logic.js の本文を日本語文として整える", formatted.html.endsWith("。"));
  assert(
    "進行ルールは参照する実測位置を併記する",
    formatted.measureReference.includes("ブロック1・セット1"),
    formatted.measureReference,
  );
}

{
  const envelope = ui.template("531");
  const flow = reader.phaseFlow(envelope.program);
  assert("複数フェーズの循環は先頭へ戻る流れを作る", flow.length === 5);
  assert(
    "循環の末尾は先頭フェーズの反復である",
    flow.at(-1).id === flow[0].id && flow.at(-1).repeated,
  );

  const references = reader.collectMeasureReferences(envelope.program);
  const rule = {
    progressIfReached: {
      id: "phase_specific",
      varId: "main_tm",
      measureId: "main_amrap",
      target: { fixed: { _0: 1 } },
      increment: 2.5,
    },
  };
  const phaseRule = reader.formatReaderRule(
    rule,
    envelope.program.variables,
    references,
    2,
  );
  assert(
    "同じmeasureIdが複数フェーズにある場合はルールと同じフェーズを参照する",
    phaseRule.measureReference.includes("Week 3"),
    phaseRule.measureReference,
  );
}

{
  const envelope = ui.template("minimal");
  envelope.program.slots[0].exerciseName = "スクワット";
  envelope.program.slots[0].muscleKeys = ["quadriceps", "glutes"];
  envelope.program.variables[0].e1rmFactor = 0.9;
  const resources = reader.summarizeResources(envelope.program);
  assert("種目要約は種目名と筋肉を持つ", resources.slots[0].muscles === "quadriceps・glutes");
  assert(
    "基準重量要約は初期値とe1RM由来を持つ",
    resources.variables[0].initialValue === "60kg" &&
      resources.variables[0].source === "スクワットの e1RM × 0.9",
  );
}

console.log(`\n${assertions - failures}/${assertions} assertions passed`);
