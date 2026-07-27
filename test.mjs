import logic from "./logic.js";

const { b64urlDecode, b64urlEncode, validate } = logic;

let assertionCount = 0;
let failureCount = 0;

function assert(name, condition, detail = "") {
  assertionCount += 1;
  if (condition) {
    console.log(`✓ ${name}`);
    return;
  }
  failureCount += 1;
  process.exitCode = 1;
  console.error(`✗ ${name}${detail ? `\n  ${detail}` : ""}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectValidationError(name, change, expectedText) {
  const envelope = clone(validEnvelope);
  change(envelope);
  const errors = validate(envelope);
  assert(
    name,
    errors.some(error => error.includes(expectedText)),
    `期待: ${expectedText}\n  実際: ${errors.join(" / ") || "エラーなし"}`,
  );
}

const validEnvelope = {
  format: "traininglogger.program",
  version: 1,
  program: {
    name: "最小テストプログラム",
    note: "",
    variables: [{
      id: "v1",
      label: "テスト TM",
      unit: "kg",
      e1rmFactor: null,
      fallbackValue: 60,
      slotId: "s1",
    }],
    slots: [{
      id: "s1",
      label: "メイン種目",
      exerciseUuid: null,
      exerciseName: null,
      muscleKeys: ["quads"],
      conditionText: "",
    }],
    phases: [{
      id: "p1",
      label: "フェーズ1",
      windowDays: 7,
      days: [{
        id: "d1",
        label: "Day 1",
        pill: "A",
        groups: [{
          id: "g1",
          entries: [{
            id: "e1",
            slotIds: ["s1"],
            methodologyId: null,
          }],
          setGroups: [{
            id: "sg1",
            count: { fixed: { _0: 3 } },
            targets: [{
              entryId: "e1",
              reps: { amrap: { min: 5 } },
              load: { percentOfVar: { varId: "v1", percent: 75, annotate: true } },
              extras: [],
              measureId: "m1",
              measureFieldKey: null,
            }],
          }],
        }],
      }],
      endRules: [{
        progressIfReached: {
          id: "r1",
          varId: "v1",
          measureId: "m1",
          target: { fixed: { _0: 5 } },
          increment: 2.5,
        },
      }],
      nextPhaseId: null,
    }],
  },
};

const validErrors = validate(clone(validEnvelope));
assert(
  "妥当な traininglogger.program v1 はエラー0件",
  validErrors.length === 0,
  validErrors.join(" / "),
);

expectValidationError(
  "percent 7500 はエラー",
  envelope => {
    envelope.program.phases[0].days[0].groups[0].setGroups[0]
      .targets[0].load.percentOfVar.percent = 7500;
  },
  "percent 7500",
);

expectValidationError(
  "固定重量 6000kg はエラー",
  envelope => {
    envelope.program.phases[0].days[0].groups[0].setGroups[0]
      .targets[0].load = { fixed: { _0: 6000 } };
  },
  "固定重量 6000kg",
);

expectValidationError(
  "fallbackValue 600kg はエラー",
  envelope => {
    envelope.program.variables[0].fallbackValue = 600;
  },
  "fallbackValue 600kg",
);

expectValidationError(
  "targets と entries の1:1不一致はエラー",
  envelope => {
    envelope.program.phases[0].days[0].groups[0].setGroups[0]
      .targets[0].entryId = "unknown-entry";
  },
  "targets が entries と1:1対応していません",
);

expectValidationError(
  "存在しない slotId はエラー",
  envelope => {
    envelope.program.phases[0].days[0].groups[0].entries[0].slotIds = ["unknown-slot"];
  },
  "種目枠 unknown-slot が slots にありません",
);

expectValidationError(
  "同じ stageKey の長さ不一致はエラー",
  envelope => {
    const phase = envelope.program.phases[0];
    phase.days[0].groups[0].setGroups[0].count = {
      byStage: { stageKey: "stage", values: [5, 6, 10] },
    };
    phase.endRules[0].progressIfReached.target = {
      stageReps: { stageKey: "stage", values: [5, 3] },
    };
  },
  "ステージ表 stage の長さが揃っていません",
);

expectValidationError(
  "measureId 重複はエラー",
  envelope => {
    const group = envelope.program.phases[0].days[0].groups[0];
    const duplicate = clone(group.setGroups[0]);
    duplicate.id = "sg2";
    group.setGroups.push(duplicate);
  },
  "同じ日に複数",
);

expectValidationError(
  "ルールが未定義の measureId を参照するとエラー",
  envelope => {
    envelope.program.phases[0].endRules[0]
      .progressIfReached.measureId = "missing-measure";
  },
  "実測 missing-measure を参照するルール",
);

expectValidationError(
  "必須キー day.pill の欠落はエラー",
  envelope => {
    delete envelope.program.phases[0].days[0].pill;
  },
  ".pill: キーがありません",
);

const unicodeText = "TrainingLogger 日本語テスト 🏋️‍♀️";
assert(
  "b64urlEncode → b64urlDecode は日本語を含めて往復できる",
  b64urlDecode(b64urlEncode(unicodeText)) === unicodeText,
);


// 実測マークのスコープ: フェーズ/日を跨ぐ再利用は正当(5/3/1)、同日重複のみ違反
{
  const envelope = clone(validEnvelope);
  const phase2 = clone(envelope.program.phases[0]);
  phase2.id = "p2"; phase2.label = "Week 2"; phase2.endRules = [];
  phase2.days = [clone(envelope.program.phases[0].days[0])];
  phase2.days[0].id = "d_w2";
  envelope.program.phases.push(phase2);
  const errors = validate(envelope);
  assert("同じ measureId をフェーズ跨ぎで再利用できる(5/3/1)", errors.length === 0,
         errors.join(" / "));
}
console.log(`\n${assertionCount - failureCount}/${assertionCount} assertions passed`);
