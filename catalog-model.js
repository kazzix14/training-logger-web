// アプリから貼り付ける種目カタログ（ADR-0080）の解析。
// ブラウザでは TrainingLoggerCatalogModel、Node では module.exports として公開する。
(function exposeCatalogModel(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.TrainingLoggerCatalogModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCatalogModel() {
  "use strict";

  const FORMAT = "traininglogger.catalog";
  const VERSION = 1;
  // ActivityKind の raw 値（web/Core の ActivityKind と対応）
  const KINDS = ["strength", "running", "cycling"];

  /**
   * 貼り付けテキストをカタログへ。壊れている場合は理由を日本語で返す。
   * 生成元はアプリだけなので、想定外の形は黙って捨てずにエラーにする。
   *
   * @returns {{ catalog: object|null, error: string|null }}
   */
  function parseCatalog(text) {
    if (typeof text !== "string" || text.trim() === "") {
      return { catalog: null, error: "種目リストが空です" };
    }
    let value;
    try {
      value = JSON.parse(text);
    } catch (error) {
      return { catalog: null, error: `JSONとして読めません: ${error.message}` };
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { catalog: null, error: "JSONオブジェクトではありません" };
    }
    if (value.format !== FORMAT) {
      return {
        catalog: null,
        error: `format が ${describe(value.format)}（${FORMAT} を期待）`,
      };
    }
    if (value.version !== VERSION) {
      return {
        catalog: null,
        error: `version が ${describe(value.version)}（${VERSION} を期待）。`
          + "アプリを更新して取り直してください",
      };
    }
    if (!Array.isArray(value.exercises)) {
      return { catalog: null, error: "exercises が配列ではありません" };
    }

    if (typeof value.exportedAt !== "string" || !ISO8601.test(value.exportedAt)) {
      return {
        catalog: null,
        error: `exportedAt がISO8601ではありません（${describe(value.exportedAt)}）`,
      };
    }

    const exercises = [];
    const seenUuids = new Set();
    for (const entry of value.exercises) {
      if (!entry || typeof entry !== "object" || typeof entry.name !== "string" || !entry.name) {
        return { catalog: null, error: "種目名を持たない項目があります" };
      }
      if (!KINDS.includes(entry.kind)) {
        return {
          catalog: null,
          error: `${entry.name} の kind が未対応です（${describe(entry.kind)}）`,
        };
      }
      const uuid = typeof entry.uuid === "string" && entry.uuid ? entry.uuid : null;
      if (uuid && seenUuids.has(uuid)) {
        return { catalog: null, error: `種目UUIDが重複しています: ${uuid}` };
      }
      if (uuid) seenUuids.add(uuid);
      exercises.push({
        name: entry.name,
        uuid,
        kind: entry.kind,
        archived: entry.archived === true,
      });
    }

    if (!Array.isArray(value.muscles)) {
      return { catalog: null, error: "muscles が配列ではありません" };
    }
    const muscles = [];
    const seenKeys = new Set();
    for (const entry of value.muscles) {
      if (!entry || typeof entry.key !== "string" || !entry.key) {
        return { catalog: null, error: "キーを持たない筋肉があります" };
      }
      if (seenKeys.has(entry.key)) {
        return { catalog: null, error: `筋肉キーが重複しています: ${entry.key}` };
      }
      seenKeys.add(entry.key);
      muscles.push({
        key: entry.key,
        name: typeof entry.name === "string" && entry.name ? entry.name : entry.key,
      });
    }

    return {
      catalog: { exportedAt: value.exportedAt, exercises, muscles },
      error: null,
    };
  }

  /**
   * 入力候補の種目名（重複なし）。アーカイブ済みは出さない。
   * kind を渡すと、その種目タイプの候補だけに絞る（種目枠の型条件と揃える）。
   */
  function candidateNames(catalog, kind = "") {
    return unique(
      (catalog?.exercises || [])
        .filter(entry => !entry.archived && (!kind || entry.kind === kind))
        .map(entry => entry.name),
    );
  }

  /** 照合に使う種目名。アーカイブ済みも含む（アプリのインポートが受けるため） */
  function exerciseNames(catalog) {
    return unique((catalog?.exercises || []).map(entry => entry.name));
  }

  /** 既知種目の照合に使う uuid（空 uuid の種目は持たない） */
  function exerciseUuids(catalog) {
    return unique(
      (catalog?.exercises || []).map(entry => entry.uuid).filter(Boolean),
    );
  }

  function muscleKeys(catalog) {
    return unique((catalog?.muscles || []).map(entry => entry.key));
  }

  /**
   * 名前から種目を引く。同名が複数ある場合は uuid を確定できないので null を返す
   * （アプリのインポートは先頭一致で拾うが、こちらが勝手に選ぶと取り違える）。
   */
  function findExercise(catalog, name) {
    if (!catalog || typeof name !== "string" || name === "") return null;
    const matches = catalog.exercises.filter(entry => entry.name === name);
    return matches.length === 1 ? matches[0] : null;
  }

  /**
   * 種目名から「枠に書き込む同一性」を決める（ADR-0080）。
   *
   * 名前と uuid が食い違ったまま残ると、アプリのインポートは uuid を優先するので
   * 画面の名前と違う種目が入る。そのため uuid は常に名前から引き直し、
   * 引けなければ null にする。
   *
   * @returns {{uuid: string|null, status: "resolved"|"ambiguous"|"unknown"|"cleared",
   *            kind: string}}
   */
  function resolveExerciseSelection(catalog, name) {
    if (typeof name !== "string" || name === "") {
      return { uuid: null, status: "cleared", kind: "" };
    }
    const matches = (catalog?.exercises || []).filter(entry => entry.name === name);
    if (matches.length === 0) return { uuid: null, status: "unknown", kind: "" };
    if (matches.length > 1) {
      // どれを指しているか決められない。uuid を書かず、名前だけで渡す
      return { uuid: null, status: "ambiguous", kind: matches[0].kind };
    }
    return { uuid: matches[0].uuid, status: "resolved", kind: matches[0].kind };
  }

  function unique(values) {
    return [...new Set(values)];
  }

  function describe(value) {
    return value === undefined ? "未指定" : JSON.stringify(value);
  }

  const ISO8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

  return {
    FORMAT,
    VERSION,
    KINDS,
    parseCatalog,
    candidateNames,
    exerciseNames,
    exerciseUuids,
    muscleKeys,
    findExercise,
    resolveExerciseSelection,
  };
});
