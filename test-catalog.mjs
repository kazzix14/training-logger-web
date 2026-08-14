import catalog from "./catalog-model.js";

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

function envelope(overrides = {}) {
  return JSON.stringify({
    format: "traininglogger.catalog",
    version: 1,
    exportedAt: "2026-08-14T10:00:00Z",
    exercises: [
      { name: "ベンチプレス", uuid: "u-bench", kind: "strength", archived: false },
      { name: "スクワット", uuid: "u-squat", kind: "strength", archived: false },
    ],
    muscles: [{ key: "pecs", name: "大胸筋" }],
    ...overrides,
  });
}

// 正常系
{
  const { catalog: parsed, error } = catalog.parseCatalog(envelope());
  assert("正しいカタログを読める", error === null && parsed !== null, String(error));
  assert("種目が並ぶ", parsed.exercises.length === 2);
  assert("取得日時を保つ", parsed.exportedAt === "2026-08-14T10:00:00Z");
  assert(
    "名前一覧を出す",
    JSON.stringify(catalog.exerciseNames(parsed)) ===
      JSON.stringify(["ベンチプレス", "スクワット"]),
  );
  assert(
    "uuid一覧を出す",
    JSON.stringify(catalog.exerciseUuids(parsed)) ===
      JSON.stringify(["u-bench", "u-squat"]),
  );
  assert(
    "筋肉キー一覧を出す",
    JSON.stringify(catalog.muscleKeys(parsed)) === JSON.stringify(["pecs"]),
  );
}

// 異常系: 生成元はアプリだけなので、想定外の形は黙って捨てずに理由を返す
{
  const cases = [
    ["空文字", "", "空"],
    ["壊れたJSON", "{", "JSONとして読めません"],
    ["配列", "[]", "JSONオブジェクトではありません"],
    ["format違い", envelope({ format: "traininglogger.program" }), "format"],
    ["version違い", envelope({ version: 2 }), "version"],
    ["exercisesが配列でない", envelope({ exercises: {} }), "exercises"],
    ["名前の無い項目", envelope({ exercises: [{ uuid: "u" }] }), "種目名"],
    [
      "未対応のkind",
      envelope({ exercises: [{ name: "謎", uuid: "u", kind: "swimming" }] }),
      "kind",
    ],
    [
      "uuid重複",
      envelope({
        exercises: [
          { name: "A", uuid: "dup", kind: "strength" },
          { name: "B", uuid: "dup", kind: "strength" },
        ],
      }),
      "重複",
    ],
    ["exportedAtが不正", envelope({ exportedAt: "2026/08/14" }), "exportedAt"],
    ["musclesが配列でない", envelope({ muscles: "pecs" }), "muscles"],
    ["キーの無い筋肉", envelope({ muscles: [{ name: "大胸筋" }] }), "キー"],
    [
      "筋肉キー重複",
      envelope({ muscles: [{ key: "pecs", name: "大胸筋" }, { key: "pecs", name: "大胸筋" }] }),
      "重複",
    ],
  ];
  for (const [name, text, expected] of cases) {
    const { catalog: parsed, error } = catalog.parseCatalog(text);
    assert(
      `${name}を拒否する`,
      parsed === null && typeof error === "string" && error.includes(expected),
      `error=${error}`,
    );
  }
}

// uuid の空文字は「uuid なし」に正規化する（アプリの Exercise.uuid は既定が空文字）
{
  const { catalog: parsed } = catalog.parseCatalog(
    envelope({ exercises: [{ name: "懸垂", uuid: "", kind: "strength" }] }),
  );
  assert("空uuidはnullになる", parsed.exercises[0].uuid === null);
  assert("空uuidは照合に載せない", catalog.exerciseUuids(parsed).length === 0);
}

// 名前から種目を引く
{
  const { catalog: parsed } = catalog.parseCatalog(envelope());
  assert(
    "名前で引ける",
    catalog.findExercise(parsed, "ベンチプレス")?.uuid === "u-bench",
  );
  assert("無い名前はnull", catalog.findExercise(parsed, "デッドリフト") === null);
  assert("空名はnull", catalog.findExercise(parsed, "") === null);
  assert("カタログ無しはnull", catalog.findExercise(null, "ベンチプレス") === null);
}

// 同名が複数あるとuuidを確定できない（勝手に選ぶと取り違える）
{
  const { catalog: parsed } = catalog.parseCatalog(
    envelope({
      exercises: [
        { name: "ベンチプレス", uuid: "u-a", kind: "strength" },
        { name: "ベンチプレス", uuid: "u-b", kind: "strength" },
      ],
    }),
  );
  assert("同名複数はnullを返す", catalog.findExercise(parsed, "ベンチプレス") === null);
  assert("名前一覧は重複しない", catalog.exerciseNames(parsed).length === 1);
  assert("uuidは両方とも照合に載る", catalog.exerciseUuids(parsed).length === 2);
}

// アーカイブ済みは候補に出さないが、照合には使う
// （アプリのインポートはアーカイブ状態を問わないため）
{
  const { catalog: parsed } = catalog.parseCatalog(
    envelope({
      exercises: [
        { name: "現役種目", uuid: "u-live", kind: "strength" },
        { name: "引退種目", uuid: "u-old", kind: "strength", archived: true },
      ],
    }),
  );
  assert(
    "候補はアーカイブ済みを除く",
    JSON.stringify(catalog.candidateNames(parsed)) === JSON.stringify(["現役種目"]),
  );
  assert("照合名にはアーカイブ済みも入る", catalog.exerciseNames(parsed).length === 2);
  assert("照合uuidにもアーカイブ済みが入る", catalog.exerciseUuids(parsed).length === 2);
}

// 種目タイプで候補を絞る（枠の型条件と揃える）
{
  const { catalog: parsed } = catalog.parseCatalog(
    envelope({
      exercises: [
        { name: "ベンチプレス", uuid: "u-b", kind: "strength" },
        { name: "ジョグ", uuid: "u-j", kind: "running" },
      ],
    }),
  );
  assert(
    "strengthの候補だけ出す",
    JSON.stringify(catalog.candidateNames(parsed, "strength")) ===
      JSON.stringify(["ベンチプレス"]),
  );
  assert("kind未指定なら全部出す", catalog.candidateNames(parsed).length === 2);
}

// 名前とuuidの同一性（名前を正として uuid を追従させる）
{
  const { catalog: parsed } = catalog.parseCatalog(envelope());
  const resolved = catalog.resolveExerciseSelection(parsed, "ベンチプレス");
  assert("一意に引ければuuidを返す", resolved.uuid === "u-bench" && resolved.status === "resolved");
  assert("種目タイプも返す", resolved.kind === "strength");

  const unknown = catalog.resolveExerciseSelection(parsed, "知らない種目");
  assert("未知の名前はuuidを消す", unknown.uuid === null && unknown.status === "unknown");

  const cleared = catalog.resolveExerciseSelection(parsed, "");
  assert("空名はuuidを消す", cleared.uuid === null && cleared.status === "cleared");

  const withoutCatalog = catalog.resolveExerciseSelection(null, "ベンチプレス");
  assert(
    "カタログ無しでもuuidは残さない",
    withoutCatalog.uuid === null && withoutCatalog.status === "unknown",
  );
}

// 同名が複数あるときは uuid を確定できないので書かない
{
  const { catalog: parsed } = catalog.parseCatalog(
    envelope({
      exercises: [
        { name: "ベンチプレス", uuid: "u-a", kind: "strength" },
        { name: "ベンチプレス", uuid: "u-b", kind: "cycling" },
      ],
    }),
  );
  const resolved = catalog.resolveExerciseSelection(parsed, "ベンチプレス");
  assert("同名複数はuuidなし", resolved.uuid === null && resolved.status === "ambiguous");
}

// アプリが生成した実物（Swiftのテストが同じ内容を固定している）を読めること
{
  const { readFileSync } = await import("node:fs");
  const text = readFileSync(new URL("./fixtures-exercise-catalog.json", import.meta.url), "utf8");
  const { catalog: parsed, error } = catalog.parseCatalog(text);
  assert("Swift生成のfixtureを読める", error === null && parsed !== null, String(error));
  assert("fixtureに候補がある", catalog.candidateNames(parsed).length > 0);
  assert("fixtureに筋肉がある", catalog.muscleKeys(parsed).length > 0);
}

if (failures === 0) {
  console.log(`\n${assertions}/${assertions} assertions passed`);
} else {
  console.error(`\n${failures} 件の失敗 / ${assertions} assertions`);
}
