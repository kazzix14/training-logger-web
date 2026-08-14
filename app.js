// TrainingLogger プログラムビルダー UI。
// Preact + htm をローカル vendor から読み込み、ビルドなしで動作させる。
import { Component, h, render } from "./vendor/preact.module.js";
import htm from "./vendor/htm.module.js";
import { programFixtureWithWasm, validateWithWasm } from "./wasm-core.js";

const html = htm.bind(h);
const ui = globalThis.TrainingLoggerUIModel;
const reader = globalThis.TrainingLoggerReaderModel;
const catalogModel = globalThis.TrainingLoggerCatalogModel;
const {
  b64urlDecode,
  b64urlEncode,
  countText,
  enumCase,
  enumPayload,
  extraText,
  loadText,
  repsText,
  ruleText,
  sideText,
} = globalThis;

const STORAGE_KEY = "traininglogger.program.builder.v2";
const MODE_STORAGE_KEY = "traininglogger.program.builder.mode.v2";
const CATALOG_STORAGE_KEY = "traininglogger.exercise.catalog.v1";
const EXERCISE_LIST_ID = "catalog-exercise-names";
const MUSCLE_LIST_ID = "catalog-muscle-keys";
const HISTORY_LIMIT = 100;
const EXTRA_FIELD_KEYS = [
  "rpe.rpe",
  "rir.rir",
  "vbt.velocity",
  "core.distance",
  "core.pace",
  "core.duration",
];
const SIDE_LABELS = {
  "": "両側",
  left: "左",
  right: "右",
};

function activityPrescriptionKind(activity) {
  return activity && typeof activity === "object"
    ? Object.keys(activity)[0] || ""
    : "";
}

function exactQuantity(value, unit) {
  return value == null
    ? null
    : { exact: { _0: { value: Number(value), unit } } };
}

function exactQuantityValue(target) {
  const value = Number(target?.exact?._0?.value);
  return Number.isFinite(value) ? value : null;
}

function quantityBounds(target, multiplier = 1) {
  const exact = Number(target?.exact?._0?.value);
  if (Number.isFinite(exact)) {
    return { lower: exact * multiplier, upper: exact * multiplier };
  }
  const lower = Number(target?.range?.lower?.value);
  const upper = Number(target?.range?.upper?.value);
  return {
    lower: Number.isFinite(lower) ? lower * multiplier : null,
    upper: Number.isFinite(upper) ? upper * multiplier : null,
  };
}

function quantityRangeBySetting(target, bound, displayValue, unit, divisor = 1) {
  if (displayValue == null) return null;
  const value = Number(displayValue) / divisor;
  const bounds = quantityBounds(target);
  let lower = bounds.lower ?? value;
  let upper = bounds.upper ?? value;
  if (bound === "lower") {
    lower = value;
    upper = Math.max(upper, value);
  } else {
    upper = Math.max(value, lower);
  }
  return lower === upper
    ? exactQuantity(lower, unit)
    : {
        range: {
          lower: { value: lower, unit },
          upper: { value: upper, unit },
        },
      };
}

function updateStrengthPrescription(activity, field, bound, displayValue) {
  if (activityPrescriptionKind(activity) !== "strength") return activity;
  const next = JSON.parse(JSON.stringify(activity));
  const value = next.strength._0;
  if (field === "sets") {
    value.sets = quantityRangeBySetting(
      value.sets,
      bound,
      displayValue,
      "count",
    );
  } else {
    value.relativeLoad ??= {
      baselineKey: "strength.training1RM",
      multiplier: { open: {} },
    };
    value.relativeLoad.multiplier =
      quantityRangeBySetting(
        value.relativeLoad.multiplier,
        bound,
        displayValue,
        "ratio",
        100,
      ) ?? { open: {} };
  }
  return next;
}

function updateStrengthRelativeLoad(activity, enabled, baselineKey = null) {
  if (activityPrescriptionKind(activity) !== "strength") return activity;
  const next = JSON.parse(JSON.stringify(activity));
  if (!enabled) {
    next.strength._0.relativeLoad = null;
    return next;
  }
  next.strength._0.relativeLoad ??= {
    baselineKey: "strength.training1RM",
    multiplier: { open: {} },
  };
  if (baselineKey != null) {
    next.strength._0.relativeLoad.baselineKey = baselineKey;
  }
  return next;
}

function defaultActivityPrescription(kind) {
  if (kind === "running") {
    return {
      running: {
        _0: {
          distance: null,
          duration: null,
          pace: { open: {} },
          derivedField: null,
          targetRPE: null,
          workoutLabel: null,
        },
      },
    };
  }
  if (kind === "cycling") {
    return {
      cycling: {
        _0: {
          distance: null,
          duration: null,
          speed: null,
          derivedField: null,
          targetRPE: null,
        },
      },
    };
  }
  if (kind === "strength") {
    return {
      strength: {
        _0: {
          sets: null,
          load: { open: {} },
          relativeLoad: null,
          repetitions: { open: {} },
          targetRPE: null,
        },
      },
    };
  }
  return null;
}

function updateEndurancePrescription(activity, field, displayValue) {
  const kind = activityPrescriptionKind(activity);
  if (kind !== "running" && kind !== "cycling") return activity;
  const next = JSON.parse(JSON.stringify(activity));
  const value = next[kind]._0;
  const previousDerived = value.derivedField;
  if (previousDerived && previousDerived !== field) {
    if (previousDerived === "pace") value.pace = { open: {} };
    else value[previousDerived] = null;
  }
  value.derivedField = null;

  if (field === "distance") {
    value.distance = exactQuantity(displayValue, "kilometers");
  } else if (field === "duration") {
    value.duration = exactQuantity(displayValue, "minutes");
  } else if (field === "pace") {
    value.pace =
      displayValue == null
        ? { open: {} }
        : {
            absolute: {
              _0: exactQuantity(displayValue * 60, "secondsPerKilometer"),
            },
          };
  } else if (field === "speed") {
    value.speed = exactQuantity(displayValue, "kilometersPerHour");
  }
  if (displayValue == null) return next;

  const distance = exactQuantityValue(value.distance);
  const duration = exactQuantityValue(value.duration);
  const pace = exactQuantityValue(value.pace?.absolute?._0);
  const speed = exactQuantityValue(value.speed);
  if (kind === "running") {
    if ((field === "distance" || field === "duration") && distance && duration) {
      value.pace = {
        absolute: {
          _0: exactQuantity((duration / distance) * 60, "secondsPerKilometer"),
        },
      };
      value.derivedField = "pace";
    } else if ((field === "distance" || field === "pace") && distance && pace) {
      value.duration = exactQuantity((distance * pace) / 60, "minutes");
      value.derivedField = "duration";
    } else if ((field === "duration" || field === "pace") && duration && pace) {
      value.distance = exactQuantity((duration * 60) / pace, "kilometers");
      value.derivedField = "distance";
    }
  } else if ((field === "distance" || field === "duration") && distance && duration) {
    value.speed = exactQuantity(distance / (duration / 60), "kilometersPerHour");
    value.derivedField = "speed";
  } else if ((field === "distance" || field === "speed") && distance && speed) {
    value.duration = exactQuantity((distance / speed) * 60, "minutes");
    value.derivedField = "duration";
  } else if ((field === "duration" || field === "speed") && duration && speed) {
    value.distance = exactQuantity(speed * (duration / 60), "kilometers");
    value.derivedField = "distance";
  }
  return next;
}

/**
 * 検証へ渡す既知種目。カタログがあればアプリの種目一覧、無ければ
 * プログラム自身の名前（= 実質チェックなし、従来の挙動）。
 */
function knownExercises(envelope, catalog) {
  if (catalog) {
    return {
      names: catalogModel.exerciseNames(catalog),
      uuids: catalogModel.exerciseUuids(catalog),
    };
  }
  return {
    names: (envelope?.program?.slots || [])
      .map(slot => slot.exerciseName)
      .filter(name => typeof name === "string" && name.length > 0),
    uuids: [],
  };
}
const KIND_LABELS = {
  strength: "筋トレ",
  running: "ランニング",
  cycling: "サイクリング",
};
const RULE_LABELS = {
  progressIfReached: "達成で加重",
  always: "毎回加重",
  progressByTable: "実測テーブル加重",
  adjustByBand: "帯で自動調整",
  stageDemotion: "ステージ降格",
};
const RULE_DESCRIPTIONS = {
  progressIfReached: "目標回数を達成したときだけ、次回の基準値を増やす",
  always: "結果にかかわらず、1周するたびに基準値を増やす",
  progressByTable: "実際にできた回数に応じて、増やす量を変える",
  adjustByBand: "結果が範囲より上なら増やし、下なら減らす",
  stageDemotion: "ステージ目標に届かなければ難易度を戻し、必要なら基準値も下げる",
};
const REPS_LABELS = {
  fixed: "固定回数",
  amrap: "AMRAP",
  range: "回数範囲",
  byStage: "ステージ表",
  amrapByStage: "AMRAP表",
};
const LOAD_LABELS = {
  none: "重量なし",
  fixed: "固定重量",
  percentOfVar: "基準重量%",
  variable: "基準重量そのまま",
};
const COUNT_LABELS = { fixed: "固定", byStage: "ステージ表" };
const EXTRA_LABELS = { exact: "固定値", range: "範囲" };
const TARGET_LABELS = { fixed: "固定回数", stageReps: "ステージ表" };

function pathKey(path) {
  return path.join(".");
}

function entryVariants(entry) {
  if (Array.isArray(entry?.variants)) return entry.variants;
  const slotIds = entry?.slotIds || (entry?.slotId ? [entry.slotId] : []);
  return slotIds.map((slotId, index) => ({
    id: `${entry.id}_v${index + 1}`,
    slotId,
    label: null,
    methodologyId: { inherit: {} },
    targetOverrides: [],
    progressionRules: { inherit: {} },
  }));
}

function slotUsageCount(program, slotId) {
  let count = 0;
  for (const phase of program.phases || []) {
    for (const day of phase.days || []) {
      for (const group of day.groups || []) {
        for (const entry of group.entries || []) {
          count += entryVariants(entry).filter(variant => variant.slotId === slotId).length;
        }
      }
    }
  }
  return count;
}

function overrideCase(value) {
  if (value?.value) return "value";
  if (value?.none) return "none";
  return "inherit";
}

function optionalExplicit(value) {
  return value == null ? { none: {} } : { value: { _0: structuredClone(value) } };
}

function explicitTargetOverride(setGroupId, target) {
  return {
    setGroupId,
    reps: { value: { _0: structuredClone(target.reps) } },
    load: optionalExplicit(target.load),
    extras: optionalExplicit(target.extras || []),
    measureId: optionalExplicit(target.measureId),
    measureFieldKey: optionalExplicit(target.measureFieldKey),
    note: optionalExplicit(target.note),
    side: optionalExplicit(target.side),
    activityPrescription: optionalExplicit(target.activityPrescription),
  };
}

function asNumber(value, nullable = false) {
  if (value === "" && nullable) return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? (nullable ? null : 0) : parsed;
}

function safeCall(callback, fallback = "?") {
  try {
    return callback();
  } catch {
    return fallback;
  }
}

function isRenderableProgram(program) {
  if (
    !program ||
    typeof program !== "object" ||
    !Array.isArray(program.variables) ||
    !Array.isArray(program.slots) ||
    !Array.isArray(program.phases)
  ) {
    return false;
  }
  return (
    program.variables.every(item => item && typeof item === "object") &&
    program.slots.every(item => item && typeof item === "object") &&
    program.phases.every(
      phase =>
        phase &&
        typeof phase === "object" &&
        Array.isArray(phase.days) &&
        Array.isArray(phase.endRules) &&
        phase.days.every(
          day =>
            day &&
            typeof day === "object" &&
            Array.isArray(day.groups) &&
            day.groups.every(
              group =>
                group &&
                typeof group === "object" &&
                Array.isArray(group.entries) &&
                Array.isArray(group.setGroups) &&
                group.entries.every(entry => entry && typeof entry === "object") &&
                group.setGroups.every(
                  setGroup =>
                    setGroup &&
                    typeof setGroup === "object" &&
                    Array.isArray(setGroup.targets) &&
                    setGroup.targets.every(
                      target =>
                        target &&
                        typeof target === "object" &&
                        Array.isArray(target.extras),
                    ),
                ),
            ),
        ),
    )
  );
}

function previewHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("&lt;span class=&quot;pct&quot;&gt;", '<span class="pct">')
    .replaceAll("&lt;span class=&quot;kind&quot;&gt;", '<span class="kind">')
    .replaceAll("&lt;/span&gt;", "</span>");
}

function optionsFrom(map) {
  return Object.entries(map).map(([value, label]) => html`<option value=${value}>${label}</option>`);
}

function closeContainingDetails(event) {
  event.currentTarget.closest("details")?.removeAttribute("open");
}

function Button({ children, className = "", title, disabled = false, onClick }) {
  return html`
    <button
      type="button"
      class=${className}
      title=${title || ""}
      disabled=${disabled}
      onClick=${onClick}
    >
      ${children}
    </button>
  `;
}

function IconButton({ icon, label, disabled = false, danger = false, onClick }) {
  return Button({
    children: html`<span aria-hidden="true">${icon}</span><span class="sr-only">${label}</span>`,
    className: `icon-button${danger ? " danger" : ""}`,
    title: label,
    disabled,
    onClick,
  });
}

function TextField({
  label,
  value,
  onInput,
  className = "",
  placeholder = "",
  nullable = false,
  multiline = false,
  focusKey = "",
  list = "",
  hint = "",
}) {
  // 日本語IMEの変換中にモデル全体を再描画すると、未確定文字や候補表示が
  // 途切れる。変換が確定するまではブラウザに入力を任せ、確定時だけ反映する。
  let composing = false;
  const handleInput = event => {
    if (composing || event.isComposing || event.nativeEvent?.isComposing) return;
    onInput(nullable && event.currentTarget.value === "" ? null : event.currentTarget.value);
  };
  const handleCompositionEnd = event => {
    composing = false;
    handleInput(event);
  };
  return html`
    <label class=${`field ${className}`}>
      <span>${label}</span>
      ${multiline
        ? html`
            <textarea
              value=${value ?? ""}
              placeholder=${placeholder}
              data-focus=${focusKey}
              onCompositionStart=${() => { composing = true; }}
              onCompositionEnd=${handleCompositionEnd}
              onInput=${handleInput}
            ></textarea>
          `
        : html`
            <input
              type="text"
              value=${value ?? ""}
              placeholder=${placeholder}
              list=${list || undefined}
              data-focus=${focusKey}
              onCompositionStart=${() => { composing = true; }}
              onCompositionEnd=${handleCompositionEnd}
              onInput=${handleInput}
            />
          `}
      ${hint ? html`<small class="input-hint">${hint}</small>` : null}
    </label>
  `;
}

function NumberField({
  label,
  value,
  onInput,
  step = "1",
  min,
  max,
  nullable = false,
  className = "",
  focusKey = "",
  hint = "",
}) {
  return html`
    <label class=${`field number-field ${className}`}>
      <span>${label}</span>
      <input
        type="number"
        value=${value ?? ""}
        step=${step}
        min=${min}
        max=${max}
        data-focus=${focusKey}
        onInput=${event => onInput(asNumber(event.currentTarget.value, nullable))}
      />
      ${hint ? html`<small class="input-hint">${hint}</small>` : null}
    </label>
  `;
}

function SelectField({
  label,
  value,
  onInput,
  children,
  className = "",
  focusKey = "",
  hint = "",
}) {
  return html`
    <label class=${`field select-field ${className}`}>
      <span>${label}</span>
      <select
        value=${value ?? ""}
        data-focus=${focusKey}
        onInput=${event => onInput(event.currentTarget.value)}
      >
        ${children}
      </select>
      ${hint ? html`<small class="input-hint">${hint}</small>` : null}
    </label>
  `;
}

function Toggle({ label, checked, onInput, className = "" }) {
  return html`
    <label class=${`toggle ${className}`}>
      <input
        type="checkbox"
        checked=${Boolean(checked)}
        onInput=${event => onInput(event.currentTarget.checked)}
      />
      <span>${label}</span>
    </label>
  `;
}

function EmptyHint({ children }) {
  return html`<p class="empty-hint">${children}</p>`;
}

function AdvancedSettings({ title = "詳細設定", description = "", children, open = false, className = "" }) {
  return html`
    <details class=${`advanced-settings ${className}`} open=${open || undefined}>
      <summary>
        <span>${title}</span>
        ${description ? html`<small>${description}</small>` : null}
      </summary>
      <div class="advanced-settings-body">${children}</div>
    </details>
  `;
}

function Explanation({ title, children, tone = "info" }) {
  return html`
    <div class=${`explanation ${tone}`}>
      <span aria-hidden="true">${tone === "tip" ? "✓" : "i"}</span>
      <div><strong>${title}</strong><p>${children}</p></div>
    </div>
  `;
}

class ProgramBuilder extends Component {
  constructor() {
    super();
    const initial = this.loadInitialEnvelope();
    this.state = {
      envelope: initial.envelope,
      past: [],
      future: [],
      activeDay: "day-0-0",
      jsonOpen: false,
      jsonText: JSON.stringify(initial.envelope, null, 2),
      jsonErrors: [],
      catalog: this.loadInitialCatalog(),
      catalogOpen: false,
      catalogText: "",
      catalogError: null,
      customExerciseInputs: {},
      validationErrors: null,
      validationEngine: "loading",
      templateName: "minimal",
      status: initial.status,
      mode: this.loadInitialMode(Boolean(location.hash.match(/^#p=/))),
    };
    this.lastEditGroup = null;
    this.lastEditTime = 0;
    this.statusTimer = null;
    this.observer = null;
    this.validationRequest = 0;
  }

  loadInitialEnvelope() {
    const match = location.hash.match(/^#p=([A-Za-z0-9_-]+)$/);
    if (match) {
      try {
        return {
          envelope: JSON.parse(b64urlDecode(match[1])),
          status: { kind: "ok", text: "共有リンクから読み込みました" },
        };
      } catch (error) {
        return {
          envelope: ui.template("minimal"),
          status: { kind: "error", text: `共有リンクを読めません: ${error.message}` },
        };
      }
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return {
          envelope: JSON.parse(saved),
          status: { kind: "ok", text: "前回の編集内容を復元しました" },
        };
      }
    } catch {
      // localStorage が無効でも編集自体は続行できる。
    }
    return { envelope: ui.template("minimal"), status: null };
  }

  /** アプリから貼り付けた種目カタログ（ADR-0080）。壊れていれば無いものとして続行する */
  loadInitialCatalog() {
    try {
      const saved = localStorage.getItem(CATALOG_STORAGE_KEY);
      if (!saved) return null;
      return catalogModel.parseCatalog(saved).catalog;
    } catch {
      return null;
    }
  }

  applyCatalog() {
    const { catalog, error } = catalogModel.parseCatalog(this.state.catalogText);
    if (error) {
      this.setState({ catalogError: error });
      return;
    }
    try {
      localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(catalog));
    } catch {
      // 保存できなくてもこのセッションでは使えるので続行する。
    }
    // 検証のかけ直しは componentDidUpdate が catalog の変化を見て行う
    this.setState({ catalog, catalogError: null, catalogOpen: false, catalogText: "" });
    this.showStatus(`種目${catalogModel.candidateNames(catalog).length}件を読み込みました`);
  }

  clearCatalog() {
    try {
      localStorage.removeItem(CATALOG_STORAGE_KEY);
    } catch {
      // 消せなくても state 側を空にすれば照合は止まる。
    }
    this.setState({ catalog: null, catalogError: null, catalogText: "" });
    this.showStatus("種目リストを消去しました");
  }

  loadInitialMode(isSharedLink) {
    if (isSharedLink) return "reader";
    try {
      return localStorage.getItem(MODE_STORAGE_KEY) === "reader"
        ? "reader"
        : "edit";
    } catch {
      return "edit";
    }
  }

  componentDidMount() {
    this.keyHandler = event => this.handleKeyDown(event);
    this.hashHandler = () => this.loadFragment();
    addEventListener("keydown", this.keyHandler);
    addEventListener("hashchange", this.hashHandler);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, this.state.mode);
    } catch {
      // localStorage が無効でも表示は続行できる。
    }
    this.refreshObserver();
    this.refreshValidation(this.state.envelope);
  }

  componentDidUpdate(_previousProps, previousState) {
    if (previousState.envelope !== this.state.envelope) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state.envelope));
      } catch {
        this.showStatus("自動保存できませんでした", "error");
      }
      document.title = `${this.state.envelope?.program?.name || "名称未設定"} — TrainingLogger`;
      this.refreshValidation(this.state.envelope);
    } else if (previousState.catalog !== this.state.catalog) {
      // 既知種目の集合が変わると指摘も変わる（ADR-0080）
      this.refreshValidation(this.state.envelope);
    }
    if (previousState.mode !== this.state.mode) {
      try {
        localStorage.setItem(MODE_STORAGE_KEY, this.state.mode);
      } catch {
        // モードの保存に失敗しても表示と編集は続行できる。
      }
    }
    this.refreshObserver();
  }

  componentWillUnmount() {
    removeEventListener("keydown", this.keyHandler);
    removeEventListener("hashchange", this.hashHandler);
    this.observer?.disconnect();
    this.validationRequest += 1;
  }

  refreshValidation(envelope) {
    // 検証は Swift コア(wasm)のみ。ロード完了までは「読み込み中」を出す
    // (JSフォールバックは廃止 — ユーザー方針 2026-07-27)
    const request = ++this.validationRequest;
    this.setState({ validationErrors: null, validationEngine: "loading" });
    validateWithWasm(
      envelope,
      knownExercises(envelope, this.state.catalog),
    ).then(errors => {
      if (request !== this.validationRequest) return;
      if (errors === null) {
        this.setState({
          validationErrors: ["Swiftコアを読み込めませんでした。再読み込みしてください"],
          validationEngine: "error",
        });
        return;
      }
      this.setState({ validationErrors: errors, validationEngine: "wasm" });
    });
  }

  async validateCandidate(envelope) {
    // 貼り付けの可否はカタログを使わずに判定する（ADR-0080）。
    // カタログは端末に残るスナップショットなので、アプリで種目を足した直後は
    // 古いままになる。そこで貼り付けを止めると、正しいプログラムが入らない。
    // 種目名の不一致は検証パネル側で指摘する。
    const wasmErrors = await validateWithWasm(
      envelope,
      knownExercises(envelope, null),
    );
    return wasmErrors
      ?? ["Swiftコアを読み込めませんでした。再読み込みしてください"];
  }

  refreshObserver() {
    this.observer?.disconnect();
    if (!("IntersectionObserver" in globalThis)) return;
    this.observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((left, right) => Math.abs(left.boundingClientRect.top - 96) - Math.abs(right.boundingClientRect.top - 96));
        const key = visible[0]?.target.dataset.dayKey;
        if (key && key !== this.state.activeDay) this.setState({ activeDay: key });
      },
      { rootMargin: "-92px 0px -62% 0px", threshold: [0, 0.05, 0.2] },
    );
    document.querySelectorAll("[data-day-key]").forEach(node => this.observer.observe(node));
  }

  loadFragment() {
    const match = location.hash.match(/^#p=([A-Za-z0-9_-]+)$/);
    if (!match) return;
    try {
      const envelope = JSON.parse(b64urlDecode(match[1]));
      this.replaceEnvelope(envelope, "共有リンクから読み込みました");
      this.setState({ mode: "reader" });
    } catch (error) {
      this.showStatus(`共有リンクを読めません: ${error.message}`, "error");
    }
  }

  showStatus(text, kind = "ok") {
    clearTimeout(this.statusTimer);
    this.setState({ status: { text, kind } });
    this.statusTimer = setTimeout(() => this.setState({ status: null }), 4000);
  }

  setMode(mode, options = {}) {
    this.setState({ mode }, () => {
      if (!options.focusValidation) return;
      const validation = document.querySelector(".validation-pane");
      validation?.scrollIntoView({ behavior: "smooth", block: "start" });
      validation?.classList.add("flash");
      setTimeout(() => validation?.classList.remove("flash"), 900);
    });
  }

  commit(nextEnvelope, options = {}) {
    const now = Date.now();
    const grouped =
      options.group &&
      this.lastEditGroup === options.group &&
      now - this.lastEditTime < 700;
    this.setState(state => ({
      envelope: nextEnvelope,
      past: grouped
        ? state.past
        : [...state.past, state.envelope].slice(-HISTORY_LIMIT),
      future: [],
      jsonText: state.jsonOpen ? state.jsonText : JSON.stringify(nextEnvelope, null, 2),
    }));
    this.lastEditGroup = options.group || null;
    this.lastEditTime = now;
    if (options.message) this.showStatus(options.message);
  }

  replaceEnvelope(envelope, message) {
    this.commit(envelope, { message });
    this.setState({
      jsonText: JSON.stringify(envelope, null, 2),
      jsonErrors: [],
    });
  }

  update(path, value, group = pathKey(path)) {
    this.commit(ui.setValue(this.state.envelope, path, value), { group });
  }

  /**
   * 種目名の更新（ADR-0080）。
   *
   * 種目名を同一性の正とし、`exerciseUuid` を常にそれへ追従させる（カタログが
   * 無いときは null になる）。名前と uuid が食い違ったまま残ると、アプリの
   * インポートは uuid を優先するため、画面の名前とは違う種目が入ってしまう。
   * 名前を空にした枠は uuid も消えて条件枠へ戻る。
   *
   * 種目UUID欄は残してあるので、カタログ無しで uuid 指定を続けたい場合は
   * そちらへ直接入れる。
   */
  setExerciseName(path, value, options = {}) {
    const current = ui.getAtPath(this.state.envelope, path) || {};
    const { uuid } = catalogModel.resolveExerciseSelection(this.state.catalog, value);
    let next = ui.setValue(this.state.envelope, [...path, "exerciseName"], value);
    next = ui.setValue(next, [...path, "exerciseUuid"], uuid);
    const labelIsAutomatic =
      !current.label?.trim() ||
      current.label === current.exerciseName ||
      current.label === "メイン種目" ||
      current.label === "種目枠" ||
      current.label === "新しい種目" ||
      /^種目 \d+$/.test(current.label);
    if (options.syncLabel && labelIsAutomatic) {
      next = ui.setValue(next, [...path, "label"], value?.trim() || "新しい種目");
    }
    this.commit(next, {
      group: pathKey([...path, "exerciseName"]),
    });
  }

  focusSoon(focusKey) {
    requestAnimationFrame(() => {
      setTimeout(() => {
        document.querySelector(`[data-focus="${focusKey}"]`)?.focus();
      }, 0);
    });
  }

  addExerciseEntry(groupPath) {
    const slot = ui.createSlot(this.state.envelope);
    slot.label = "新しい種目";
    let next = ui.insertItem(this.state.envelope, ["program", "slots"], slot);
    next = ui.addEntry(next, groupPath);
    const entryIndex = (ui.getAtPath(next, [...groupPath, "entries"]) || []).length - 1;
    const variantPath = [...groupPath, "entries", entryIndex, "variants", 0];
    next = ui.setValue(next, [...variantPath, "slotId"], slot.id);
    this.commit(next, { message: "種目を追加しました。名前をそのまま入力できます" });
    this.focusSoon(`${pathKey(variantPath)}.exerciseName`);
  }

  addRotationExercise(entry, entryPath) {
    const variants = entryVariants(entry);
    const slot = ui.createSlot(this.state.envelope);
    slot.label = "新しい種目";
    const nextIndex = variants.length + 1;
    const variantPath = [...entryPath, "variants", variants.length];
    let next = ui.insertItem(this.state.envelope, ["program", "slots"], slot);
    next = ui.setValue(next, [...entryPath, "variants"], [
      ...variants,
      {
        id: `${entry.id}_v${nextIndex}`,
        slotId: slot.id,
        label: null,
        methodologyId: { inherit: {} },
        targetOverrides: [],
        progressionRules: { inherit: {} },
      },
    ]);
    this.commit(next, { message: "交互に使う種目を追加しました" });
    this.focusSoon(`${pathKey(variantPath)}.exerciseName`);
  }

  detachVariantSlot(variantPath, slot) {
    const fresh = structuredClone(slot);
    fresh.id = ui.createSlot(this.state.envelope).id;
    let next = ui.insertItem(this.state.envelope, ["program", "slots"], fresh);
    next = ui.setValue(next, [...variantPath, "slotId"], fresh.id);
    this.commit(next, { message: "この場所専用の種目に分けました" });
    this.focusSoon(`${pathKey(variantPath)}.exerciseName`);
  }

  rename(path, value, referenceKeys) {
    this.commit(ui.renameReferences(this.state.envelope, path, value, referenceKeys), {
      group: `rename:${pathKey(path)}`,
    });
  }

  mutate(callback, message) {
    this.commit(callback(this.state.envelope), { message });
  }

  undo() {
    this.setState(state => {
      if (!state.past.length) return null;
      const previous = state.past[state.past.length - 1];
      return {
        envelope: previous,
        past: state.past.slice(0, -1),
        future: [state.envelope, ...state.future].slice(0, HISTORY_LIMIT),
        jsonText: JSON.stringify(previous, null, 2),
      };
    });
    this.lastEditGroup = null;
  }

  redo() {
    this.setState(state => {
      if (!state.future.length) return null;
      const [next, ...rest] = state.future;
      return {
        envelope: next,
        past: [...state.past, state.envelope].slice(-HISTORY_LIMIT),
        future: rest,
        jsonText: JSON.stringify(next, null, 2),
      };
    });
    this.lastEditGroup = null;
  }

  handleKeyDown(event) {
    if (this.state.mode !== "edit") return;
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (event.target?.dataset?.jsonEditor === "true") return;
    const key = event.key.toLowerCase();
    if (key === "z") {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
    } else if (key === "y") {
      event.preventDefault();
      this.redo();
    }
  }

  confirmDelete(label, callback) {
    if (confirm(`${label}を削除します。取り消しで戻せます。`)) callback();
  }

  async writeClipboard(text, successMessage) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      this.showStatus(successMessage);
    } catch (error) {
      this.showStatus(`コピーできません: ${error.message}`, "error");
    }
  }

  copyJSON() {
    this.writeClipboard(
      JSON.stringify(this.state.envelope, null, 2),
      "アプリへ戻すデータをコピーしました。TrainingLoggerの「JSONを読み込む」に貼り付けてください",
    );
  }

  copyLink() {
    const url = `${location.origin}${location.pathname}#p=${b64urlEncode(
      JSON.stringify(this.state.envelope),
    )}`;
    this.writeClipboard(url, "共有リンクをコピーしました");
  }

  async insertTemplate() {
    const fixtureLabels = {
      "viada-strength-5k": "Viada STRENGTH + 5K",
      "viada-strength-5k-taper": "Viada STRENGTH + 5K · Taper/Deload",
    };
    const fixtureLabel = fixtureLabels[this.state.templateName];
    const label =
      fixtureLabel ??
      (this.state.templateName === "531" ? "5/3/1風" : "最小線形");
    if (!confirm(`${label}テンプレートで現在の内容を置き換えます。取り消しで戻せます。`)) return;

    if (fixtureLabel) {
      const envelope = await programFixtureWithWasm(this.state.templateName);
      if (!envelope) {
        this.showStatus("共有Coreからプリセットを読み込めませんでした", "error");
        return;
      }
      this.replaceEnvelope(envelope, `${label}テンプレートを挿入しました`);
      return;
    }

    this.replaceEnvelope(ui.template(this.state.templateName), `${label}テンプレートを挿入しました`);
  }

  openJSON() {
    this.setState({
      jsonOpen: true,
      jsonText: JSON.stringify(this.state.envelope, null, 2),
      jsonErrors: [],
    });
  }

  formatJSON() {
    try {
      const parsed = JSON.parse(this.state.jsonText);
      this.setState({ jsonText: JSON.stringify(parsed, null, 2), jsonErrors: [] });
    } catch (error) {
      this.setState({ jsonErrors: [`JSONとして読めません: ${error.message}`] });
    }
  }

  async applyJSON() {
    try {
      const parsed = JSON.parse(this.state.jsonText);
      const errors = await this.validateCandidate(parsed);
      if (errors.length) {
        this.setState({
          jsonText: JSON.stringify(parsed, null, 2),
          jsonErrors: errors,
          jsonOpen: true,
        });
        this.showStatus(`反映前に ${errors.length}件の問題を修正してください`, "error");
        return;
      }
      this.commit(parsed, {
        message: "JSONを検証して反映しました",
      });
      this.setState({
        jsonText: JSON.stringify(parsed, null, 2),
        jsonErrors: [],
        jsonOpen: false,
      });
    } catch (error) {
      this.setState({ jsonErrors: [`JSONとして読めません: ${error.message}`] });
    }
  }

  scrollTo(id) {
    const node = document.getElementById(id);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
    node.classList.add("flash");
    setTimeout(() => node.classList.remove("flash"), 900);
  }

  scrollToError(error) {
    const rawPath = error.match(/(?:program\.)?(?:phases|variables|slots)\[\d+\](?:\.[A-Za-z]+(?:\[\d+\])?)*/)?.[0];
    if (!rawPath) {
      this.scrollTo("program-overview");
      return;
    }
    const normalized = `${rawPath.startsWith("program.") ? "" : "program."}${rawPath}`
      .replaceAll("[", ".")
      .replaceAll("]", "");
    const candidates = [...document.querySelectorAll("[data-model-path]")]
      .filter(node => normalized.startsWith(node.dataset.modelPath))
      .sort((left, right) => right.dataset.modelPath.length - left.dataset.modelPath.length);
    const target = candidates[0];
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("flash");
      setTimeout(() => target.classList.remove("flash"), 900);
    } else {
      this.scrollTo("program-overview");
    }
  }

  structureActions(arrayPath, index, label, options = {}) {
    const array = ui.getAtPath(this.state.envelope, arrayPath) || [];
    return html`
      <details class="row-action-menu">
        <summary title=${`${label}の操作`} aria-label=${`${label}の操作`}>•••</summary>
        <div class="row-action-popover">
          ${Button({
            children: "↑ 上へ移動",
            disabled: index === 0,
            onClick: event => {
              closeContainingDetails(event);
              this.mutate(envelope => ui.moveItem(envelope, arrayPath, index, -1));
            },
          })}
          ${Button({
            children: "↓ 下へ移動",
            disabled: index === array.length - 1,
            onClick: event => {
              closeContainingDetails(event);
              this.mutate(envelope => ui.moveItem(envelope, arrayPath, index, 1));
            },
          })}
          ${options.duplicate === false
            ? null
            : Button({
                children: "⧉ 複製",
                onClick: event => {
                  closeContainingDetails(event);
                  this.mutate(envelope => ui.duplicateStructure(envelope, arrayPath, index, {
                    clearMeasures: options.clearMeasures,
                  }));
                },
              })}
          ${Button({
            children: "× 削除",
            className: "danger-action",
            onClick: event => {
              closeContainingDetails(event);
              this.confirmDelete(label, () =>
                this.mutate(envelope => ui.removeItem(envelope, arrayPath, index)));
            },
          })}
        </div>
      </details>
    `;
  }

  renderHeader(program, errors) {
    const readerMode = this.state.mode === "reader";
    return html`
      <header class="app-header">
        <div class="brand">
          <span class="brand-mark">TL</span>
          <div>
            <strong>${program?.name || "名称未設定"}</strong>
            <small>${readerMode ? "完成イメージ" : "編集中・自動保存済み"}</small>
          </div>
        </div>
        <div class="header-actions">
          <div class="mode-switch" role="group" aria-label="表示モード">
            ${Button({
              children: html`<span class="desktop-label">完成イメージ</span><span class="mobile-label">確認</span>`,
              className: readerMode ? "active" : "",
              onClick: () => this.setMode("reader"),
            })}
            ${Button({
              children: "編集",
              className: readerMode ? "" : "active",
              onClick: () => this.setMode("edit"),
            })}
          </div>
          ${Button({
            children: html`<span class="desktop-label">アプリへ戻す</span><span class="mobile-label">戻す</span>`,
            className: "primary",
            title: "TrainingLoggerへ貼り付けるJSONをコピー",
            onClick: () => this.copyJSON(),
          })}
          ${readerMode && errors.length
            ? Button({
                children: `要確認 ${errors.length}件`,
                className: "header-validation-badge",
                title: "編集画面の仕上げチェックを開く",
                onClick: () => this.setMode("edit", { focusValidation: true }),
              })
            : null}
          ${readerMode
            ? Button({ children: "共有リンク", onClick: () => this.copyLink() })
            : html`
                <div class="history-actions">
                  ${IconButton({
                    icon: "↶",
                    label: "取り消し (⌘/Ctrl+Z)",
                    disabled: !this.state.past.length,
                    onClick: () => this.undo(),
                  })}
                  ${IconButton({
                    icon: "↷",
                    label: "やり直し (⌘/Ctrl+Shift+Z)",
                    disabled: !this.state.future.length,
                    onClick: () => this.redo(),
                  })}
                </div>
                <details class="header-menu">
                  <summary>その他 <span aria-hidden="true">⌄</span></summary>
                  <div class="header-menu-popover">
                    <strong>データと共有</strong>
                    ${Button({ children: "共有リンクをコピー", onClick: () => this.copyLink() })}
                    ${Button({
                      children: this.state.catalog
                        ? `アプリの種目を更新（${catalogModel.candidateNames(this.state.catalog).length}件）`
                        : "アプリの種目を読み込む",
                      className: this.state.catalog ? "" : "needs-attention",
                      onClick: () => this.setState({ catalogOpen: true, catalogError: null }),
                    })}
                    ${Button({ children: "JSONを直接編集", onClick: () => this.openJSON() })}
                    <strong>テンプレートでやり直す</strong>
                    <div class="template-control">
                      <select
                        aria-label="テンプレート"
                        value=${this.state.templateName}
                        onInput=${event =>
                          this.setState({ templateName: event.currentTarget.value })}
                      >
                          <option value="minimal">シンプルな筋トレ</option>
                          <option value="531">5/3/1風</option>
                          <option value="viada-strength-5k">筋トレ + 5K</option>
                          <option value="viada-strength-5k-taper">5K テーパー / デロード</option>
                      </select>
                      ${Button({ children: "置き換える", onClick: () => this.insertTemplate() })}
                    </div>
                    <small>現在の内容は置き換わりますが、取り消しで戻せます。</small>
                  </div>
                </details>
              `}
        </div>
      </header>
    `;
  }

  renderTree(phases) {
    return html`
      <nav class="tree-pane" aria-label="プログラム構造">
        <div class="pane-title">
          <span>編集する場所</span>
          <span class="count-badge">${phases.length} 期間</span>
        </div>
        <div class="tree-scroll">
          <div class="tree-setup">
            <button type="button" onClick=${() => this.scrollTo("program-overview")}>
              <span aria-hidden="true">1</span><strong>名前とメモ</strong>
            </button>
          </div>
          <p class="tree-section-label">トレーニング内容</p>
          ${phases.map(
            (phase, phaseIndex) => html`
              <div class="tree-phase">
                <button
                  type="button"
                  onClick=${() => this.scrollTo(`phase-${phaseIndex}`)}
                >
                  <span class="tree-number">${phaseIndex + 1}</span>
                  <span>${phase.label || phase.id || "名称未設定"}</span>
                </button>
                <div class="tree-days">
                  ${(phase.days || []).map((day, dayIndex) => {
                    const dayKey = `day-${phaseIndex}-${dayIndex}`;
                    return html`
                      <button
                        type="button"
                        class=${this.state.activeDay === dayKey ? "active" : ""}
                        onClick=${() => {
                          this.setState({ activeDay: dayKey });
                          this.scrollTo(dayKey);
                        }}
                      >
                        <span class="tree-line"></span>
                        <span>${day.label || day.id || "名称未設定"}</span>
                        ${day.pill ? html`<small>${day.pill}</small>` : null}
                      </button>
                    `;
                  })}
                </div>
              </div>
            `,
          )}
          <p class="tree-section-label tree-detail-label">必要なときだけ</p>
          <div class="tree-setup tree-details">
            <button type="button" onClick=${() => this.scrollTo("exercise-setup")}>
              <span aria-hidden="true">⋯</span><strong>種目の共通設定</strong>
            </button>
            <button type="button" onClick=${() => this.scrollTo("baseline-setup")}>
              <span aria-hidden="true">%</span><strong>割合計算の基準値</strong>
            </button>
          </div>
        </div>
        ${Button({
          children: "＋ 新しい期間を追加",
          className: "wide-button",
          onClick: () =>
            this.mutate(envelope =>
              ui.insertItem(
                envelope,
                ["program", "phases"],
                ui.createPhase(envelope),
              ),
            ),
        })}
      </nav>
    `;
  }

  renderStartGuide(program, errors, coreLoading) {
    const hasName = Boolean(program.name?.trim());
    const hasExercise = (program.slots || []).some(slot =>
      Boolean(slot.exerciseName?.trim() || slot.conditionText?.trim()),
    );
    const hasMenu = (program.phases || []).some(phase =>
      (phase.days || []).some(day => (day.groups || []).length > 0),
    );
    const checked = !coreLoading && errors.length === 0;
    const steps = [
      ["program-overview", "1", "名前をつける", "何のためのプログラムかを書く", hasName],
      ["phase-0", "2", "メニューを作る", "種目名もセット・回数・重量もここで入力", hasExercise && hasMenu],
      ["finish-check", "3", "仕上げを確認", "問題がなければアプリへ戻す", checked],
    ];
    return html`
      <section class="start-guide" aria-labelledby="start-guide-title">
        <div class="start-guide-heading">
          <div>
            <span class="eyebrow">はじめに</span>
            <h1 id="start-guide-title">3ステップで、そのまま作れます</h1>
            <p>事前準備は不要です。メニューの中へ種目名を直接入力してください。</p>
          </div>
          <span class="guide-progress">${steps.filter(step => step[4]).length} / 3</span>
        </div>
        <ol class="guide-steps">
          ${steps.map(([id, number, title, description, done]) => html`
            <li class=${done ? "done" : ""}>
              <button type="button" onClick=${() => this.scrollTo(id)}>
                <span class="guide-step-number">${done ? "✓" : number}</span>
                <span><strong>${title}</strong><small>${description}</small></span>
              </button>
            </li>
          `)}
        </ol>
      </section>
    `;
  }

  renderOverview(program) {
    return html`
      <section
        id="program-overview"
        class="editor-card overview-card"
        data-model-path="program"
      >
        <div class="section-heading">
          <div>
            <span class="eyebrow">PROGRAM</span>
            <h1>まず、プログラムに名前をつける</h1>
            <p>あとから見返したときに、目的がわかる名前とメモを残します。</p>
          </div>
        </div>
        <div class="form-grid overview-grid">
          ${TextField({
            label: "プログラム名（必須）",
            value: program.name,
            className: "span-2",
            focusKey: "program.name",
            onInput: value => this.update(["program", "name"], value),
          })}
          ${TextField({
            label: "目的や進め方（任意）",
            value: program.note,
            className: "span-2",
            multiline: true,
            focusKey: "program.note",
            placeholder: "例：週3回。8週間かけてスクワットを伸ばす。疲労が強い日は重量を下げる。",
            onInput: value => this.update(["program", "note"], value),
          })}
        </div>
      </section>
    `;
  }

  renderVariables(program) {
    const variablesPath = ["program", "variables"];
    return html`
      <section id="baseline-setup" class="editor-card" data-model-path="program.variables">
        <div class="section-heading">
          <div>
            <span class="eyebrow">必要な場合だけ</span>
            <h2>割合計算の基準を用意する</h2>
            <p>「基準の75%」のように重量や距離を指定するときに使います。固定値だけなら不要です。</p>
          </div>
          ${Button({
            children: "＋ 基準値を追加",
            className: "small primary",
            onClick: () =>
              this.mutate(envelope =>
                ui.insertItem(envelope, variablesPath, ui.createVariable(envelope)),
              ),
          })}
        </div>
        <div class="compact-list">
          ${(program.variables || []).map((variable, index) => {
            const path = [...variablesPath, index];
            return html`
              <article class="resource-row resource-card" data-model-path=${pathKey(path)}>
                <div class="resource-card-main">
                  <div class="resource-basic-grid variable-basic-grid">
                  ${TextField({
                    label: "画面に表示する名前",
                    value: variable.label,
                    placeholder: "例：スクワットのトレーニングMAX",
                    focusKey: `${pathKey(path)}.label`,
                    onInput: value => this.update([...path, "label"], value),
                  })}
                  ${NumberField({
                    label: "最初の値",
                    value: variable.fallbackValue,
                    step: "0.5",
                    min: "0.5",
                    max: "500",
                    hint: "アプリで個別変更できます",
                    focusKey: `${pathKey(path)}.fallbackValue`,
                    onInput: value => this.update([...path, "fallbackValue"], value),
                  })}
                  ${TextField({
                    label: "単位",
                    value: variable.unit,
                    className: "short-field",
                    focusKey: `${pathKey(path)}.unit`,
                    onInput: value => this.update([...path, "unit"], value),
                  })}
                  </div>
                  ${AdvancedSettings({
                    title: "計算方法と内部ID",
                    description: "通常は変更不要",
                    children: html`
                      <div class="advanced-grid">
                        ${TextField({
                          label: "内部ID",
                          value: variable.id,
                          hint: "他の設定からこの基準値を参照するための名前です",
                          focusKey: `${pathKey(path)}.id`,
                          onInput: value => this.rename(path, value, ["varId", "weightVarId"]),
                        })}
                        ${SelectField({
                          label: "値の種類",
                          value: variable.dimension,
                          focusKey: `${pathKey(path)}.dimension`,
                          onInput: value => this.update([...path, "dimension"], value),
                          children: [
                            ["load", "重量"], ["distance", "距離"], ["duration", "時間"],
                            ["pace", "ペース"], ["speed", "速度"], ["count", "回数"],
                            ["ratio", "比率"], ["effort", "強度"], ["scalar", "数値"],
                          ].map(([value, label]) => html`<option value=${value}>${label}</option>`),
                        })}
                        ${NumberField({
                          label: "推定1RMへ換算する係数",
                          value: variable.e1rmFactor,
                          nullable: true,
                          step: "0.01",
                          min: "0",
                          max: "2",
                          hint: "空欄なら換算しません",
                          focusKey: `${pathKey(path)}.e1rmFactor`,
                          onInput: value => this.update([...path, "e1rmFactor"], value),
                        })}
                        ${SelectField({
                          label: "対応する種目",
                          value: variable.slotId || "",
                          focusKey: `${pathKey(path)}.slotId`,
                          onInput: value => this.update([...path, "slotId"], value || null),
                          children: [
                            html`<option value="">指定なし</option>`,
                            ...(program.slots || []).map(slot =>
                              html`<option value=${slot.id}>${slot.label || slot.id}</option>`),
                          ],
                        })}
                      </div>
                    `,
                  })}
                </div>
                ${this.structureActions(variablesPath, index, "基準値")}
              </article>
            `;
          })}
          ${(program.variables || []).length
            ? null
            : Explanation({ title: "固定の重量だけを使うなら、このままでOKです", children: "割合指定や自動加重を使いたくなったときに追加してください。", tone: "tip" })}
        </div>
      </section>
    `;
  }

  renderSlots(program) {
    const slotsPath = ["program", "slots"];
    return html`
      <section id="exercise-setup" class="editor-card" data-model-path="program.slots">
        <div class="section-heading">
          <div>
            <span class="eyebrow">必要なときだけ</span>
            <h2>種目の共通設定</h2>
            <p>メニューで入力した種目は、ここへ自動で追加されます。選択条件や筋肉、内部IDをまとめて直す場所です。</p>
          </div>
          ${Button({
            children: "＋ 種目を追加",
            className: "small primary",
            onClick: () =>
              this.mutate(envelope => ui.insertItem(envelope, slotsPath, ui.createSlot(envelope))),
          })}
        </div>
        <div class="compact-list">
          ${(program.slots || []).map((slot, index) => {
            const path = [...slotsPath, index];
            const activityKind =
              slot.activityRequirement?.fact?._0?.kind?._0 || "";
            return html`
              <article class="resource-row resource-card" data-model-path=${pathKey(path)}>
                <div class="resource-card-main">
                  <div class="resource-basic-grid slot-basic-grid">
                  ${TextField({
                    label: "メニュー上の名前",
                    value: slot.label,
                    placeholder: "例：メインの脚種目",
                    focusKey: `${pathKey(path)}.label`,
                    onInput: value => this.update([...path, "label"], value),
                  })}
                  <div class="field-with-hint">
                    ${TextField({
                      label: "行う種目",
                      value: slot.exerciseName,
                      nullable: true,
                      placeholder: "未指定ならアプリで選ぶ",
                      list: this.state.catalog
                        ? exerciseListId(activityKind)
                        : "",
                      focusKey: `${pathKey(path)}.exerciseName`,
                      onInput: value => this.setExerciseName(path, value),
                    })}
                    ${this.exerciseNameHint(slot, activityKind)}
                  </div>
                  ${SelectField({
                    label: "運動の種類",
                    value: activityKind,
                    focusKey: `${pathKey(path)}.activityRequirement`,
                    onInput: value =>
                      this.update(
                        [...path, "activityRequirement"],
                        value
                          ? { fact: { _0: { kind: { _0: value } } } }
                          : null,
                      ),
                    children: [
                      html`<option value="">指定なし</option>`,
                      html`<option value="strength">筋トレ</option>`,
                      html`<option value="running">ランニング</option>`,
                      html`<option value="cycling">サイクリング</option>`,
                    ],
                  })}
                    ${TextField({
                      label: "アプリで選ぶときの条件",
                      value: slot.conditionText,
                      placeholder: "例：脚のコンパウンド種目（種目を決めた場合は空欄でOK）",
                      focusKey: `${pathKey(path)}.conditionText`,
                      onInput: value => this.update([...path, "conditionText"], value),
                    })}
                  </div>
                  ${AdvancedSettings({
                    title: "絞り込みと内部情報",
                    description: "筋肉・重複制御・ID",
                    children: html`
                      <div class="advanced-grid">
                        ${TextField({
                          label: "内部ID",
                          value: slot.id,
                          hint: "メニューからこの種目を参照するための名前です",
                          focusKey: `${pathKey(path)}.id`,
                          onInput: value => this.rename(path, value, ["slotId", "slotIds"]),
                        })}
                        ${TextField({
                          label: "種目UUID",
                          value: slot.exerciseUuid,
                          nullable: true,
                          placeholder: "種目リストから選ぶと自動入力",
                          focusKey: `${pathKey(path)}.exerciseUuid`,
                          onInput: value => this.update([...path, "exerciseUuid"], value),
                        })}
                        <div class="field-with-hint span-2">
                          ${TextField({
                            label: "対象の筋肉（カンマ区切り）",
                            value: (slot.muscleKeys || []).join(", "),
                            focusKey: `${pathKey(path)}.muscleKeys`,
                            onInput: value => this.update(
                              [...path, "muscleKeys"],
                              value.split(",").map(item => item.trim()).filter(Boolean),
                            ),
                          })}
                          ${this.renderMuscleChips(path, slot)}
                        </div>
                        ${TextField({
                          label: "同じ種目にしたくないグループ",
                          value: slot.distinctGroup,
                          nullable: true,
                          placeholder: "同じ名前を設定した枠どうしで重複を防ぎます",
                          hint: "例：pull。空欄なら重複を許可します",
                          focusKey: `${pathKey(path)}.distinctGroup`,
                          onInput: value => this.update([...path, "distinctGroup"], value),
                        })}
                      </div>
                    `,
                  })}
                </div>
                ${this.structureActions(slotsPath, index, "種目")}
              </article>
            `;
          })}
          ${(program.slots || []).length ? null : EmptyHint({ children: "まだ種目がありません。上のボタンから追加してください。" })}
        </div>
      </section>
    `;
  }

  renderNumberList(label, values, path, options = {}) {
    const items = Array.isArray(values) ? values : [];
    return html`
      <div class="number-list">
        <span class="mini-label">${label}</span>
        <div>
          ${items.map(
            (value, index) => html`
              <span class="number-list-item">
                <input
                  type="number"
                  value=${value}
                  step=${options.step || "1"}
                  data-focus=${`${pathKey(path)}.${index}`}
                  aria-label=${`${label} ${index + 1}`}
                  onInput=${event =>
                    this.update([...path, index], asNumber(event.currentTarget.value))}
                />
                <button
                  type="button"
                  title="${label}の列を削除"
                  onClick=${() =>
                    this.update(
                      path,
                      items.filter((_, itemIndex) => itemIndex !== index),
                      `remove:${pathKey(path)}`,
                    )}
                >×</button>
              </span>
            `,
          )}
          <button
            type="button"
            class="inline-add"
            onClick=${() =>
              this.update(path, [...items, options.defaultValue ?? 1], `add:${pathKey(path)}`)}
          >＋列</button>
        </div>
      </div>
    `;
  }

  renderEnumFields(kind, value, path, program) {
    const currentCase = value == null && kind === "load" ? "none" : enumCase(value);
    const payload = value == null ? null : enumPayload(value);
    const labels = {
      reps: REPS_LABELS,
      load: LOAD_LABELS,
      count: COUNT_LABELS,
      extraKind: EXTRA_LABELS,
      target: TARGET_LABELS,
    }[kind];
    const fields = [];
    const changeCase = nextCase =>
      this.mutate(envelope =>
        ui.switchEnum(envelope, path, kind, nextCase, { variables: program.variables || [] }),
      );

    fields.push(
      SelectField({
        label: "指定方法",
        value: currentCase || Object.keys(labels)[0],
        focusKey: `${pathKey(path)}.case`,
        onInput: changeCase,
        children: optionsFrom(labels),
      }),
    );
    if (!payload) return fields;

    if (currentCase === "fixed" || (kind === "extraKind" && currentCase === "exact")) {
      fields.push(
        NumberField({
          label:
            kind === "extraKind"
              ? "値"
              : kind === "load"
                ? "kg"
                : kind === "count"
                  ? "セット"
                  : "回",
          value: payload._0,
          step: kind === "extraKind" ? "0.01" : kind === "load" ? "0.5" : "1",
          focusKey: `${pathKey(path)}.${currentCase}._0`,
          onInput: next => this.update([...path, currentCase, "_0"], next),
        }),
      );
    } else if (currentCase === "amrap") {
      fields.push(
        NumberField({
          label: "最低回数",
          value: payload.min,
          focusKey: `${pathKey(path)}.amrap.min`,
          onInput: next => this.update([...path, "amrap", "min"], next),
        }),
      );
    } else if (currentCase === "range" || (kind === "extraKind" && currentCase === "range")) {
      fields.push(
        NumberField({
          label: "下限",
          value: payload.lo,
          step: kind === "extraKind" ? "0.01" : "1",
          focusKey: `${pathKey(path)}.${currentCase}.lo`,
          onInput: next => this.update([...path, currentCase, "lo"], next),
        }),
        NumberField({
          label: "上限",
          value: payload.hi,
          step: kind === "extraKind" ? "0.01" : "1",
          focusKey: `${pathKey(path)}.${currentCase}.hi`,
          onInput: next => this.update([...path, currentCase, "hi"], next),
        }),
      );
    } else if (currentCase === "percentOfVar") {
      fields.push(
        SelectField({
          label: "基準重量",
          value: payload.varId,
          focusKey: `${pathKey(path)}.percentOfVar.varId`,
          onInput: next => this.update([...path, "percentOfVar", "varId"], next),
          children: (program.variables || []).map(
            variable => html`<option value=${variable.id}>${variable.label || variable.id}</option>`,
          ),
        }),
                NumberField({
                  label: "%",
                  value: payload.percent * 100,
                  step: "0.5",
                  focusKey: `${pathKey(path)}.percentOfVar.percent`,
                  onInput: next =>
                    this.update([...path, "percentOfVar", "percent"], next / 100),
                }),
        Toggle({
          label: "割合を表示",
          checked: payload.annotate,
          onInput: next => this.update([...path, "percentOfVar", "annotate"], next),
        }),
      );
    } else if (currentCase === "variable") {
      fields.push(
        SelectField({
          label: "基準重量",
          value: payload.varId,
          focusKey: `${pathKey(path)}.variable.varId`,
          onInput: next => this.update([...path, "variable", "varId"], next),
          children: (program.variables || []).map(
            variable => html`<option value=${variable.id}>${variable.label || variable.id}</option>`,
          ),
        }),
      );
    } else if (
      currentCase === "byStage" ||
      currentCase === "amrapByStage" ||
      currentCase === "stageReps"
    ) {
      fields.push(
        TextField({
          label: "ステージの識別名",
          value: payload.stageKey,
          hint: "同じ名前のステージ表が連動します",
          focusKey: `${pathKey(path)}.${currentCase}.stageKey`,
          onInput: next => this.update([...path, currentCase, "stageKey"], next),
        }),
        this.renderNumberList(
          "ステージ値",
          payload.values,
          [...path, currentCase, "values"],
        ),
      );
    }
    return fields;
  }

  renderInlineExercisePicker(program, variant, variantPath) {
    const slotIndex = (program.slots || []).findIndex(slot => slot.id === variant.slotId);
    const slot = program.slots?.[slotIndex];
    if (!slot) {
      return SelectField({
        label: "行う種目",
        value: variant.slotId,
        focusKey: `${pathKey(variantPath)}.slotId`,
        onInput: value => this.update([...variantPath, "slotId"], value),
        children: (program.slots || []).map(item =>
          html`<option value=${item.id}>${item.exerciseName || item.label || item.id}</option>`),
      });
    }

    const slotPath = ["program", "slots", slotIndex];
    const focusKey = `${pathKey(variantPath)}.exerciseName`;
    const kind = slot.activityRequirement?.fact?._0?.kind?._0 || "";
    const candidates = this.state.catalog
      ? catalogModel.candidateNames(this.state.catalog, kind)
      : [];
    const known = candidates.includes(slot.exerciseName);
    const customOpen =
      !this.state.catalog ||
      Boolean(slot.exerciseName && !known) ||
      Boolean(this.state.customExerciseInputs[focusKey]);
    const usageCount = slotUsageCount(program, slot.id);

    return html`
      <div class="inline-exercise-picker">
        ${this.state.catalog
          ? html`
              <label class="field select-field">
                <span>行う種目</span>
                <select
                  value=${known ? slot.exerciseName : customOpen ? "__custom__" : ""}
                  onInput=${event => {
                    const value = event.currentTarget.value;
                    if (value === "__custom__") {
                      this.setState(state => ({
                        customExerciseInputs: {
                          ...state.customExerciseInputs,
                          [focusKey]: true,
                        },
                      }), () => this.focusSoon(focusKey));
                      return;
                    }
                    this.setState(state => ({
                      customExerciseInputs: {
                        ...state.customExerciseInputs,
                        [focusKey]: false,
                      },
                    }));
                    this.setExerciseName(slotPath, value || null, { syncLabel: true });
                  }}
                >
                  <option value="">アプリで使うときに選ぶ</option>
                  ${candidates.map(name => html`<option value=${name}>${name}</option>`)}
                  <option value="__custom__">一覧にない名前を直接入力…</option>
                </select>
                <small class="input-hint">クリックするとアプリの種目が一覧で出ます</small>
              </label>
              ${customOpen
                ? TextField({
                    label: "種目名を直接入力",
                    value: slot.exerciseName,
                    nullable: true,
                    placeholder: "例：ベンチプレス",
                    focusKey,
                    onInput: value => this.setExerciseName(slotPath, value, { syncLabel: true }),
                  })
                : null}
            `
          : html`
              ${TextField({
                label: "行う種目",
                value: slot.exerciseName,
                nullable: true,
                placeholder: "ここに種目名を直接入力",
                focusKey,
                hint: "入力した名前はメニュー表示にも自動で反映します",
                onInput: value => this.setExerciseName(slotPath, value, { syncLabel: true }),
              })}
              <button
                type="button"
                class="catalog-inline-button"
                onClick=${() => this.setState({ catalogOpen: true, catalogError: null })}
              >アプリの種目から選べるようにする</button>
            `}
        ${usageCount > 1
          ? html`
              <div class="shared-slot-note">
                <span>この種目は${usageCount}か所で共通です。名前を変えるとすべてに反映されます。</span>
                ${Button({
                  children: "この場所だけ分ける",
                  className: "small",
                  onClick: () => this.detachVariantSlot(variantPath, slot),
                })}
              </div>
            `
          : null}
      </div>
    `;
  }

  renderEntries(program, group, groupPath) {
    return html`
      <div class="entries-panel">
        <div class="subheading">
          <div>
            <strong>このブロックで行う種目</strong>
            <small>2種目以上にするとスーパーセットになります。</small>
          </div>
          ${Button({
            children: "＋ 種目を追加",
            className: "small",
            onClick: () => this.addExerciseEntry(groupPath),
          })}
        </div>
        ${(group.entries || []).map((entry, entryIndex) => {
          const path = [...groupPath, "entries", entryIndex];
          return html`
            <article class="entry-card" data-model-path=${pathKey(path)}>
              <div class="entry-card-heading">
                <strong><span>${entryIndex + 1}</span> 種目 ${entryIndex + 1}</strong>
                <details class="row-action-menu">
                  <summary title="種目の操作" aria-label="種目の操作">•••</summary>
                  <div class="row-action-popover">
                  ${Button({
                    children: "↑ 上へ移動", disabled: entryIndex === 0,
                    onClick: event => {
                      closeContainingDetails(event);
                      this.mutate(envelope => ui.moveEntry(envelope, groupPath, entryIndex, -1));
                    },
                  })}
                  ${Button({
                    children: "↓ 下へ移動", disabled: entryIndex === group.entries.length - 1,
                    onClick: event => {
                      closeContainingDetails(event);
                      this.mutate(envelope => ui.moveEntry(envelope, groupPath, entryIndex, 1));
                    },
                  })}
                  ${Button({
                    children: "⧉ 複製",
                    onClick: event => {
                      closeContainingDetails(event);
                      this.mutate(envelope => ui.duplicateEntry(envelope, groupPath, entryIndex));
                    },
                  })}
                  ${Button({
                    children: "× 削除", className: "danger-action",
                    onClick: event => {
                      closeContainingDetails(event);
                      this.confirmDelete("種目", () =>
                        this.mutate(envelope => ui.removeEntry(envelope, groupPath, entryIndex)));
                    },
                  })}
                  </div>
                </details>
              </div>
              ${this.renderEntryVariants(program, entry, path)}
              ${AdvancedSettings({
                title: "トレーニング体系の識別名",
                description: "外部の方法論と連携するときだけ",
                children: TextField({
                  label: "共通のmethodology ID",
                  value: entry.methodologyId,
                  nullable: true,
                  placeholder: "通常は空欄",
                  hint: "この種目行のすべてのローテーションに適用します",
                  focusKey: `${pathKey(path)}.methodologyId`,
                  onInput: value => this.update([...path, "methodologyId"], value),
                }),
              })}
            </article>
          `;
        })}
      </div>
    `;
  }

  renderEntryVariants(program, entry, entryPath) {
    const variants = entryVariants(entry);
    const variantsPath = [...entryPath, "variants"];
    return html`
      <div class="entry-variants">
        ${variants.length > 1
          ? html`<p class="rotation-explanation">この場所では、採用するたびに下の種目を順番に切り替えます。</p>`
          : null}
        <div class="compact-list variant-list">
          ${variants.map((variant, index) => {
            const path = [...variantsPath, index];
            const methodologyMode = overrideCase(variant.methodologyId);
            const progressionMode = overrideCase(variant.progressionRules);
            return html`
              <div class="variant-card" data-model-path=${pathKey(path)}>
                ${variants.length > 1 ? html`<span class="variant-number">${index + 1}</span>` : null}
                <div class="variant-basic-grid">
                  ${this.renderInlineExercisePicker(program, variant, path)}
                  ${TextField({
                    label: "この場所だけの呼び名（任意）",
                    value: variant.label,
                    nullable: true,
                    placeholder: "通常は空欄でOK",
                    hint: "例：同じスクワットを「軽い日」と表示したい場合",
                    focusKey: `${pathKey(path)}.label`,
                    onInput: value => this.update([...path, "label"], value || null),
                  })}
                </div>
                ${AdvancedSettings({
                  title: "この種目だけの詳細設定",
                  description: "通常は共通設定を使います",
                  children: html`
                    <div class="advanced-grid">
                      ${SelectField({
                        label: "登録済みの別の種目へ切り替える",
                        value: variant.slotId,
                        focusKey: `${pathKey(path)}.slotId`,
                        onInput: value => this.update([...path, "slotId"], value),
                        children: (program.slots || []).map(slot =>
                          html`<option value=${slot.id}>${slot.exerciseName || slot.label || slot.id}</option>`),
                      })}
                      ${SelectField({
                        label: "トレーニング体系",
                        value: methodologyMode,
                        focusKey: `${pathKey(path)}.methodologyId`,
                        onInput: value => this.update(
                          [...path, "methodologyId"],
                          value === "none" ? { none: {} }
                            : value === "value" ? { value: { _0: "" } }
                            : { inherit: {} },
                        ),
                        children: [
                          html`<option value="inherit">種目行の共通設定を使う</option>`,
                          html`<option value="value">この種目だけ指定</option>`,
                          html`<option value="none">体系なし</option>`,
                        ],
                      })}
                      ${methodologyMode === "value" ? TextField({
                        label: "methodology ID",
                        value: variant.methodologyId.value?._0 || "",
                        focusKey: `${pathKey(path)}.methodologyId.value`,
                        onInput: value => this.update([...path, "methodologyId"], { value: { _0: value } }),
                      }) : null}
                      ${SelectField({
                        label: "フェーズ終了時の進行",
                        value: progressionMode,
                        focusKey: `${pathKey(path)}.progressionRules`,
                        onInput: value => this.update(
                          [...path, "progressionRules"],
                          value === "none" ? { none: {} } : { inherit: {} },
                        ),
                        children: [
                          html`<option value="inherit">共通ルールを使う</option>`,
                          html`<option value="none">この種目は自動進行しない</option>`,
                          ...(progressionMode === "value" ? [html`<option value="value">個別ルール</option>`] : []),
                        ],
                      })}
                    </div>
                  `,
                })}
                ${variants.length > 1
                  ? Button({
                      children: "この候補を削除",
                      className: "small danger-action variant-remove",
                      onClick: () => this.update(
                        variantsPath,
                        variants.filter((_, variantIndex) => variantIndex !== index),
                      ),
                    })
                  : null}
              </div>
            `;
          })}
        </div>
        ${Button({
          children: variants.length > 1 ? "＋ 交互に使う種目を追加" : "＋ 同じ場所で別の種目と交互に使う",
          className: "small rotation-add",
          onClick: () => this.addRotationExercise(entry, entryPath),
        })}
      </div>
    `;
  }

  toggleMeasure(targetPath, enabled, fallbackId) {
    let next = ui.setValue(
      this.state.envelope,
      [...targetPath, "measureId"],
      enabled ? fallbackId : null,
    );
    if (!enabled) next = ui.setValue(next, [...targetPath, "measureFieldKey"], null);
    this.commit(next);
  }

  renderExtra(extra, extraIndex, extrasPath) {
    const path = [...extrasPath, extraIndex];
    return html`
      <div class="extra-row" data-model-path=${pathKey(path)}>
        ${TextField({
          label: "指標キー",
          value: extra.fieldKey,
          className: "short-field",
          list: "extra-field-key-list",
          focusKey: `${pathKey(path)}.fieldKey`,
          onInput: value => this.update([...path, "fieldKey"], value),
        })}
        ${this.renderEnumFields(
          "extraKind",
          extra.kind,
          [...path, "kind"],
          this.state.envelope.program,
        )}
        ${IconButton({
          icon: "×",
          label: "追加指標を削除",
          danger: true,
          onClick: () =>
            this.mutate(envelope => ui.removeItem(envelope, extrasPath, extraIndex)),
        })}
      </div>
    `;
  }

  renderTarget(program, target, targetIndex, setGroup, setGroupPath, group, location) {
    const path = [...setGroupPath, "targets", targetIndex];
    const entry = (group.entries || []).find(item => item.id === target.entryId);
    const slotIds = entryVariants(entry).map(variant => variant.slotId);
    const slotNames = slotIds.map(
      id => (program.slots || []).find(slot => slot.id === id)?.label || id,
    );
    const extrasPreview = (target.extras || []).map(extraText).join(" · ");
    const notePreview = typeof target.note === "string" ? target.note.trim() : "";
    const activityKind = activityPrescriptionKind(target.activityPrescription);
    const activityValue = target.activityPrescription?.[activityKind]?._0 || {};
    const preview = activityKind
      ? reader.formatPrescription(program, group, setGroup, target).text
      : `${safeCall(() => countText(setGroup.count))} × ${safeCall(() =>
          repsText(target.reps),
        )}${target.load == null ? "" : ` ・ ${safeCall(() => loadText(target.load, program.variables || []))}`}${
          extrasPreview ? ` 〔${extrasPreview}〕` : ""
        }${notePreview ? ` ✎ ${notePreview}` : ""}`;
    const measureFallback = `measure_${location.map(value => value + 1).join("_")}`;
    const extrasPath = [...path, "extras"];

    return html`
      <div class="target-row" data-model-path=${pathKey(path)}>
        <div class="target-title">
          <div>
            <span class="entry-name">${slotNames.join(" / ") || target.entryId}${sideText(
              target.side,
            )}</span>
            <code class="technical-id">内部ID: ${target.entryId}</code>
          </div>
          <div class="prescription" dangerouslySetInnerHTML=${{ __html: previewHTML(preview) }}></div>
        </div>
        <div class="prescription-kind-line">
          ${SelectField({
            label: "メニューの種類",
            value: activityKind,
            focusKey: `${pathKey(path)}.activityPrescription`,
            onInput: value =>
              this.update(
                [...path, "activityPrescription"],
                defaultActivityPrescription(value),
              ),
            children: [
              html`<option value="">筋トレ（セット・回数・重量）</option>`,
              html`<option value="running">ランニング</option>`,
              html`<option value="cycling">サイクリング</option>`,
              html`<option value="strength">筋トレ（範囲や相対重量を細かく指定）</option>`,
            ],
          })}
          ${activityKind === "running" || activityKind === "cycling"
            ? [
                NumberField({
                  label: "距離 km",
                  value: exactQuantityValue(activityValue.distance),
                  nullable: true,
                  step: "0.1",
                  min: "0",
                  focusKey: `${pathKey(path)}.activityDistance`,
                  onInput: value =>
                    this.update(
                      [...path, "activityPrescription"],
                      updateEndurancePrescription(
                        target.activityPrescription,
                        "distance",
                        value,
                      ),
                    ),
                }),
                NumberField({
                  label: "時間 分",
                  value: exactQuantityValue(activityValue.duration),
                  nullable: true,
                  step: "0.1",
                  min: "0",
                  focusKey: `${pathKey(path)}.activityDuration`,
                  onInput: value =>
                    this.update(
                      [...path, "activityPrescription"],
                      updateEndurancePrescription(
                        target.activityPrescription,
                        "duration",
                        value,
                      ),
                    ),
                }),
                activityKind === "running"
                  ? NumberField({
                      label: "ペース 分/km",
                      value:
                        exactQuantityValue(
                          activityValue.pace?.absolute?._0,
                        ) == null
                          ? null
                          : exactQuantityValue(
                              activityValue.pace?.absolute?._0,
                            ) / 60,
                      nullable: true,
                      step: "0.05",
                      min: "0",
                      focusKey: `${pathKey(path)}.activityPace`,
                      onInput: value =>
                        this.update(
                          [...path, "activityPrescription"],
                          updateEndurancePrescription(
                            target.activityPrescription,
                            "pace",
                            value,
                          ),
                        ),
                    })
                  : NumberField({
                      label: "速度 km/h",
                      value: exactQuantityValue(activityValue.speed),
                      nullable: true,
                      step: "0.1",
                      min: "0",
                      focusKey: `${pathKey(path)}.activitySpeed`,
                      onInput: value =>
                        this.update(
                          [...path, "activityPrescription"],
                          updateEndurancePrescription(
                            target.activityPrescription,
                            "speed",
                            value,
                          ),
                        ),
                    }),
              ]
            : null}
          ${activityKind === "strength"
            ? [
                NumberField({
                  label: "処方セット下限",
                  value: quantityBounds(activityValue.sets).lower,
                  nullable: true,
                  step: "1",
                  min: "1",
                  focusKey: `${pathKey(path)}.activitySetLower`,
                  onInput: value =>
                    this.update(
                      [...path, "activityPrescription"],
                      updateStrengthPrescription(
                        target.activityPrescription,
                        "sets",
                        "lower",
                        value,
                      ),
                    ),
                }),
                NumberField({
                  label: "処方セット上限",
                  value: quantityBounds(activityValue.sets).upper,
                  nullable: true,
                  step: "1",
                  min: "1",
                  focusKey: `${pathKey(path)}.activitySetUpper`,
                  onInput: value =>
                    this.update(
                      [...path, "activityPrescription"],
                      updateStrengthPrescription(
                        target.activityPrescription,
                        "sets",
                        "upper",
                        value,
                      ),
                    ),
                }),
                SelectField({
                  label: "相対重量",
                  value: activityValue.relativeLoad ? "value" : "",
                  focusKey: `${pathKey(path)}.activityRelativeLoad`,
                  onInput: value =>
                    this.update(
                      [...path, "activityPrescription"],
                      updateStrengthRelativeLoad(
                        target.activityPrescription,
                        value === "value",
                      ),
                    ),
                  children: [
                    html`<option value="">指定なし</option>`,
                    html`<option value="value">基準比率</option>`,
                  ],
                }),
                activityValue.relativeLoad
                  ? TextField({
                      label: "相対重量の基準キー",
                      value: activityValue.relativeLoad.baselineKey || "",
                      focusKey: `${pathKey(path)}.activityRelativeBaseline`,
                      onInput: value =>
                        this.update(
                          [...path, "activityPrescription"],
                          updateStrengthRelativeLoad(
                            target.activityPrescription,
                            true,
                            value,
                          ),
                        ),
                    })
                  : null,
                activityValue.relativeLoad
                  ? NumberField({
                      label: "相対重量 下限 %",
                      value: quantityBounds(
                        activityValue.relativeLoad.multiplier,
                        100,
                      ).lower,
                      nullable: true,
                      step: "0.5",
                      min: "0",
                      focusKey: `${pathKey(path)}.activityRelativeLower`,
                      onInput: value =>
                        this.update(
                          [...path, "activityPrescription"],
                          updateStrengthPrescription(
                            target.activityPrescription,
                            "relativeLoad",
                            "lower",
                            value,
                          ),
                        ),
                    })
                  : null,
                activityValue.relativeLoad
                  ? NumberField({
                      label: "相対重量 上限 %",
                      value: quantityBounds(
                        activityValue.relativeLoad.multiplier,
                        100,
                      ).upper,
                      nullable: true,
                      step: "0.5",
                      min: "0",
                      focusKey: `${pathKey(path)}.activityRelativeUpper`,
                      onInput: value =>
                        this.update(
                          [...path, "activityPrescription"],
                          updateStrengthPrescription(
                            target.activityPrescription,
                            "relativeLoad",
                            "upper",
                            value,
                          ),
                        ),
                    })
                  : null,
              ]
            : null}
        </div>
        <div class="enum-line">
          <div class="enum-group">
            <span class="mini-label">1セットあたりの回数</span>
            ${this.renderEnumFields("reps", target.reps, [...path, "reps"], program)}
          </div>
          <div class="enum-group">
            <span class="mini-label">使用重量</span>
            ${this.renderEnumFields("load", target.load, [...path, "load"], program)}
          </div>
        </div>
        <div class="target-meta-line">
          ${SelectField({
            label: "側",
            value: target.side || "",
            className: "side-field",
            focusKey: `${pathKey(path)}.side`,
            onInput: value => this.update([...path, "side"], value || null),
            children: optionsFrom(SIDE_LABELS),
          })}
          ${TextField({
            label: "この種目への指示（任意）",
            value: target.note,
            nullable: true,
            className: "note-field",
            placeholder: "指示メモ(任意)",
            focusKey: `${pathKey(path)}.note`,
            onInput: value => this.update([...path, "note"], value),
          })}
        </div>
        ${AdvancedSettings({
          title: "記録・進行・種目ローテーションの詳細",
          description: target.measureId || (target.extras || []).length ? "設定あり" : "必要な場合だけ",
          open: Boolean(target.measureId || (target.extras || []).length),
          className: "target-advanced",
          children: html`
            ${Explanation({
              title: "自動進行に使う結果を記録する",
              children: "進行ルールで達成回数などを参照したい種目だけ、実測を有効にします。",
            })}
            <div class="measure-line">
              ${Toggle({
                label: "この種目の結果を記録し、進行判定に使う",
                checked: Boolean(target.measureId),
                className: target.measureId ? "measured" : "",
                onInput: enabled => this.toggleMeasure(path, enabled, measureFallback),
              })}
              ${target.measureId ? [
                TextField({
                  label: "記録の内部ID",
                  value: target.measureId,
                  className: "measure-field",
                  hint: "進行ルールからこの結果を参照するための名前です",
                  focusKey: `${pathKey(path)}.measureId`,
                  onInput: value => this.update([...path, "measureId"], value),
                }),
                TextField({
                  label: "記録する値の種類",
                  value: target.measureFieldKey,
                  nullable: true,
                  className: "measure-field",
                  placeholder: "空欄なら既定の回数",
                  focusKey: `${pathKey(path)}.measureFieldKey`,
                  onInput: value => this.update([...path, "measureFieldKey"], value),
                }),
              ] : null}
            </div>
            <div class="extras">
              ${(target.extras || []).map((extra, extraIndex) => this.renderExtra(extra, extraIndex, extrasPath))}
              ${Button({
                children: "＋ RPE・RIR・距離などの指標を追加",
                className: "text-button",
                onClick: () => this.mutate(envelope => ui.addExtra(envelope, path)),
              })}
              ${(target.extras || []).length
                ? html`<span class="extra-preview">${target.extras.map(extraText).join(" / ")}</span>`
                : null}
            </div>
            ${this.renderVariantTargetOverrides(group, entry, target, setGroup, setGroupPath)}
          `,
        })}
      </div>
    `;
  }

  renderVariantTargetOverrides(group, entry, target, setGroup, setGroupPath) {
    const variants = entryVariants(entry);
    if (variants.length <= 1) return null;
    const entryIndex = (group.entries || []).findIndex(item => item.id === entry.id);
    const groupPath = setGroupPath.slice(0, -2);

    return html`
      <div class="variant-targets">
        <span class="mini-label">ローテーションごとの個別メニュー</span>
        ${variants.map((variant, variantIndex) => {
          const variantPath = [
            ...groupPath,
            "entries",
            entryIndex,
            "variants",
            variantIndex,
          ];
          const overrides = variant.targetOverrides || [];
          const overrideIndex = overrides.findIndex(
            item => item.setGroupId === setGroup.id,
          );
          const targetOverride = overrideIndex >= 0 ? overrides[overrideIndex] : null;
          const overridePath = [
            ...variantPath,
            "targetOverrides",
            Math.max(overrideIndex, 0),
          ];
          const replaceOverride = value => {
            const next = [...overrides];
            if (overrideIndex >= 0) next[overrideIndex] = value;
            else next.push(value);
            this.update([...variantPath, "targetOverrides"], next);
          };
          const removeOverride = () =>
            this.update(
              [...variantPath, "targetOverrides"],
              overrides.filter(item => item.setGroupId !== setGroup.id),
            );

          if (!targetOverride) {
            return html`
              <div class="target-meta-line">
                <strong>${variant.label || variant.slotId}</strong>
                ${Button({
                  children: "個別処方にする",
                  className: "small",
                  onClick: () =>
                    replaceOverride(explicitTargetOverride(setGroup.id, target)),
                })}
                <span class="muted">共通処方を継承</span>
              </div>
            `;
          }

          const loadMode = overrideCase(targetOverride.load);
          const measureMode = overrideCase(targetOverride.measureId);
          const activityMode = overrideCase(targetOverride.activityPrescription);
          const activity =
            activityMode === "value"
              ? targetOverride.activityPrescription.value?._0
              : null;
          const activityKind = activityPrescriptionKind(activity);
          const activityValue = activity?.[activityKind]?._0 || {};
          const setActivity = value =>
            this.update(
              [...overridePath, "activityPrescription"],
              optionalExplicit(value),
            );

          return html`
            <div class="target-row" data-model-path=${pathKey(overridePath)}>
              <div class="target-title">
                <strong>${variant.label || variant.slotId}</strong>
                ${Button({
                  children: "共通処方へ戻す",
                  className: "small",
                  onClick: removeOverride,
                })}
              </div>
              <div class="enum-line">
                <div class="enum-group">
                  <span class="mini-label">回数</span>
                  ${this.renderEnumFields(
                    "reps",
                    targetOverride.reps.value?._0 || target.reps,
                    [...overridePath, "reps", "value", "_0"],
                    this.state.envelope.program,
                  )}
                </div>
                <div class="enum-group">
                  ${SelectField({
                    label: "重量",
                    value: loadMode,
                    focusKey: `${pathKey(overridePath)}.load`,
                    onInput: value =>
                      this.update(
                        [...overridePath, "load"],
                        value === "none"
                          ? { none: {} }
                          : value === "inherit"
                            ? { inherit: {} }
                            : optionalExplicit(
                                target.load || { fixed: { _0: 0 } },
                              ),
                      ),
                    children: [
                      html`<option value="inherit">共通を継承</option>`,
                      html`<option value="value">個別指定</option>`,
                      html`<option value="none">なし・手入力</option>`,
                    ],
                  })}
                  ${loadMode === "value"
                    ? this.renderEnumFields(
                        "load",
                        targetOverride.load.value._0,
                        [...overridePath, "load", "value", "_0"],
                        this.state.envelope.program,
                      )
                    : null}
                </div>
              </div>
              <div class="target-meta-line">
                ${SelectField({
                  label: "記録と自動進行",
                  value: measureMode,
                  focusKey: `${pathKey(overridePath)}.measureId`,
                  onInput: value =>
                    this.update(
                      [...overridePath, "measureId"],
                      value === "none"
                        ? { none: {} }
                        : value === "inherit"
                          ? { inherit: {} }
                          : optionalExplicit(
                              target.measureId || `measure_${variant.id}`,
                            ),
                    ),
                  children: [
                    html`<option value="inherit">共通を継承</option>`,
                    html`<option value="value">個別指定</option>`,
                    html`<option value="none">進行なし</option>`,
                  ],
                })}
                ${measureMode === "value"
                  ? TextField({
                      label: "記録の内部ID",
                      value: targetOverride.measureId.value?._0 || "",
                      focusKey: `${pathKey(overridePath)}.measureId.value`,
                      onInput: value =>
                        this.update(
                          [...overridePath, "measureId"],
                          optionalExplicit(value),
                        ),
                    })
                  : null}
                ${TextField({
                  label: "指示メモ",
                  value:
                    overrideCase(targetOverride.note) === "value"
                      ? targetOverride.note.value?._0
                      : null,
                  nullable: true,
                  placeholder: "空ならメモなし",
                  focusKey: `${pathKey(overridePath)}.note`,
                  onInput: value =>
                    this.update(
                      [...overridePath, "note"],
                      value ? optionalExplicit(value) : { none: {} },
                    ),
                })}
              </div>
              <div class="target-meta-line">
                ${SelectField({
                  label: "メニューの種類",
                  value: activityMode === "value" ? activityKind : activityMode,
                  focusKey: `${pathKey(overridePath)}.activityPrescription`,
                  onInput: value =>
                    this.update(
                      [...overridePath, "activityPrescription"],
                      value === "inherit"
                        ? { inherit: {} }
                        : value === "none"
                          ? { none: {} }
                          : optionalExplicit(defaultActivityPrescription(value)),
                    ),
                  children: [
                    html`<option value="inherit">共通を継承</option>`,
                    html`<option value="none">なし</option>`,
                    html`<option value="running">ランニング</option>`,
                    html`<option value="cycling">サイクリング</option>`,
                    html`<option value="strength">筋トレ（範囲や相対重量を細かく指定）</option>`,
                  ],
                })}
                ${activityKind === "running" || activityKind === "cycling"
                  ? [
                      NumberField({
                        label: "距離 km",
                        value: exactQuantityValue(activityValue.distance),
                        nullable: true,
                        step: "0.1",
                        min: "0",
                        focusKey: `${pathKey(overridePath)}.activityDistance`,
                        onInput: value =>
                          setActivity(
                            updateEndurancePrescription(activity, "distance", value),
                          ),
                      }),
                      NumberField({
                        label: "時間 分",
                        value: exactQuantityValue(activityValue.duration),
                        nullable: true,
                        step: "0.1",
                        min: "0",
                        focusKey: `${pathKey(overridePath)}.activityDuration`,
                        onInput: value =>
                          setActivity(
                            updateEndurancePrescription(activity, "duration", value),
                          ),
                      }),
                      activityKind === "running"
                        ? NumberField({
                            label: "ペース 分/km",
                            value:
                              exactQuantityValue(activityValue.pace?.absolute?._0) == null
                                ? null
                                : exactQuantityValue(
                                    activityValue.pace.absolute._0,
                                  ) / 60,
                            nullable: true,
                            step: "0.05",
                            min: "0",
                            focusKey: `${pathKey(overridePath)}.activityPace`,
                            onInput: value =>
                              setActivity(
                                updateEndurancePrescription(activity, "pace", value),
                              ),
                          })
                        : NumberField({
                            label: "速度 km/h",
                            value: exactQuantityValue(activityValue.speed),
                            nullable: true,
                            step: "0.1",
                            min: "0",
                            focusKey: `${pathKey(overridePath)}.activitySpeed`,
                            onInput: value =>
                              setActivity(
                                updateEndurancePrescription(activity, "speed", value),
                              ),
                          }),
                    ]
                  : null}
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }

  renderSetGroup(program, setGroup, setGroupIndex, group, groupPath, location) {
    const setGroupsPath = [...groupPath, "setGroups"];
    const path = [...setGroupsPath, setGroupIndex];
    return html`
      <section class="set-group" data-model-path=${pathKey(path)}>
        <div class="set-group-heading">
          <div>
            <span class="set-number">パターン ${setGroupIndex + 1}</span>
            <small>${setGroupIndex === 0 ? "基本メニュー" : "別の回数・重量"}</small>
            <code class="technical-id">${setGroup.id}</code>
          </div>
          <div class="count-editor">
            <span class="mini-label">何セット行う？</span>
            ${this.renderEnumFields("count", setGroup.count, [...path, "count"], program)}
          </div>
          ${this.structureActions(setGroupsPath, setGroupIndex, "セット群", {
            clearMeasures: true,
          })}
        </div>
        <div class="targets">
          ${(setGroup.targets || []).map((target, targetIndex) =>
            this.renderTarget(
              program,
              target,
              targetIndex,
              setGroup,
              path,
              group,
              [...location, setGroupIndex, targetIndex],
            ),
          )}
        </div>
      </section>
    `;
  }

  renderExecutionEditor(session, path) {
    const value = session.execution
      ? JSON.stringify(session.execution, null, 2)
      : "";
    return html`
      <label class="field span-2 execution-json-field">
        <span>実行順・休憩・反復（上級者向けJSON）</span>
        <textarea
          value=${value}
          placeholder="空欄ならブロック順。JSONを設定すると実行順・休憩・反復を明示できます。"
          data-focus=${`${pathKey(path)}.execution`}
          onChange=${event => {
            const text = event.currentTarget.value.trim();
            if (!text) {
              this.update([...path, "execution"], null);
              return;
            }
            try {
              this.update([...path, "execution"], JSON.parse(text));
            } catch (error) {
              this.showStatus(`実行順JSONを読めません: ${error.message}`, "error");
            }
          }}
        ></textarea>
      </label>
    `;
  }

  renderSessions(day, dayPath) {
    const sessions = Array.isArray(day.sessions) ? day.sessions : [];
    if (!sessions.length) {
      return html`
        <div class="sessions-empty">
          <span>現在は、この日の全ブロックを1回のトレーニングとして記録します。</span>
          ${Button({
            children: "朝・夜などに分ける",
            className: "small",
            onClick: () =>
              this.mutate(envelope => ui.enableSessions(envelope, dayPath)),
          })}
        </div>
      `;
    }

    return html`
      <section class="sessions-panel" data-model-path=${pathKey([...dayPath, "sessions"])}>
        <div class="subheading">
          <div>
            <strong>1日の中のトレーニング分け</strong>
            <small>朝・夜など、別々の記録として生成されます。</small>
          </div>
          ${Button({
            children: "＋ 時間帯を追加",
            className: "small primary",
            onClick: () =>
              this.mutate(envelope => ui.addSession(envelope, dayPath)),
          })}
        </div>
        <div class="compact-list">
          ${sessions.map((session, sessionIndex) => {
            const sessionPath = [...dayPath, "sessions", sessionIndex];
            return html`
              <div class="resource-row session-row" data-model-path=${pathKey(sessionPath)}>
                <div class="form-grid session-fields">
                  ${TextField({
                    label: "内部ID",
                    value: session.id,
                    className: "id-field",
                    focusKey: `${pathKey(sessionPath)}.id`,
                    onInput: value =>
                      this.rename(sessionPath, value, ["sessionID"]),
                  })}
                  ${TextField({
                    label: "表示名",
                    value: session.label,
                    focusKey: `${pathKey(sessionPath)}.label`,
                    onInput: value => this.update([...sessionPath, "label"], value),
                  })}
                  ${TextField({
                    label: "短いラベル",
                    value: session.pill,
                    className: "short-field",
                    focusKey: `${pathKey(sessionPath)}.pill`,
                    onInput: value => this.update([...sessionPath, "pill"], value),
                  })}
                  ${this.renderExecutionEditor(session, sessionPath)}
                </div>
                ${IconButton({
                  icon: "×",
                  label:
                    sessions.length === 1
                      ? "セッション分割を解除"
                      : "セッションを削除",
                  danger: true,
                  onClick: () =>
                    this.confirmDelete("セッション", () =>
                      this.mutate(envelope =>
                        ui.removeSession(envelope, dayPath, sessionIndex)
                      )
                    ),
                })}
              </div>
            `;
          })}
        </div>
      </section>
    `;
  }

  renderGroup(program, group, groupIndex, dayPath, location, sessions = []) {
    const groupsPath = [...dayPath, "groups"];
    const path = [...groupsPath, groupIndex];
    return html`
      <article class="block-card" data-model-path=${pathKey(path)}>
        <div class="block-heading">
          <div>
            <span class="eyebrow">ブロック ${groupIndex + 1}</span>
            <h4>${(group.entries || []).length > 1 ? "スーパーセット" : "1種目ずつ行う"}</h4>
            <p>${(group.entries || []).length > 1
              ? "並んだ種目を続けて行い、すべて終えたら次のセットへ進みます。"
              : "この種目のセットを終えてから次のブロックへ進みます。"}</p>
            <code class="technical-id">内部ID: ${group.id}</code>
          </div>
          ${this.structureActions(groupsPath, groupIndex, "ブロック", {
            clearMeasures: true,
          })}
      </div>
      ${sessions.length
        ? SelectField({
            label: "いつ行う？",
            value: group.sessionID || sessions[0].id,
            className: "session-picker",
            focusKey: `${pathKey(path)}.sessionID`,
            onInput: value => this.update([...path, "sessionID"], value),
            children: sessions.map(
              session =>
                html`<option value=${session.id}>${session.label || session.id}</option>`
            ),
          })
        : null}
      ${this.renderEntries(program, group, path)}
        ${(group.setGroups || []).map((setGroup, setGroupIndex) =>
          this.renderSetGroup(
            program,
            setGroup,
            setGroupIndex,
            group,
            path,
            [...location, groupIndex],
          ),
        )}
        ${Button({
          children: "＋ 別のセット数・回数・重量パターンを追加",
          className: "wide-button dashed",
          onClick: () => this.mutate(envelope => ui.addSetGroup(envelope, path)),
        })}
      </article>
    `;
  }

  renderDay(program, day, dayIndex, phasePath, location) {
    const daysPath = [...phasePath, "days"];
    const path = [...daysPath, dayIndex];
    const dayKey = `day-${location[0]}-${dayIndex}`;
    return html`
      <section
        id=${dayKey}
        class="day-card"
        data-day-key=${dayKey}
        data-model-path=${pathKey(path)}
      >
        <div class="day-heading">
          <span class="day-number">${dayIndex + 1}日目</span>
          <div class="day-fields">
            ${TextField({
              label: "この日の名前",
              value: day.label,
              focusKey: `${pathKey(path)}.label`,
              onInput: value => this.update([...path, "label"], value),
            })}
            ${TextField({
              label: "短いラベル",
              value: day.pill,
              className: "short-field",
              hint: "例：重い日・30分",
              focusKey: `${pathKey(path)}.pill`,
              onInput: value => this.update([...path, "pill"], value),
            })}
          </div>
          ${this.structureActions(daysPath, dayIndex, "日")}
        </div>
      ${AdvancedSettings({
        title: "この日を朝・夜など複数回に分ける",
        description: (day.sessions || []).length ? `${day.sessions.length}回に分割中` : "必要な場合だけ",
        open: Boolean((day.sessions || []).length),
        className: "day-sessions-settings",
        children: this.renderSessions(day, path),
      })}
      ${(day.groups || []).map((group, groupIndex) =>
        this.renderGroup(
          program,
          group,
          groupIndex,
          path,
          [...location, dayIndex],
          day.sessions || []
        ),
      )}
      ${Button({
        children: "＋ 次の種目・スーパーセットを追加",
        className: "wide-button dashed",
        onClick: () =>
          this.mutate(envelope =>
            ui.insertItem(
              envelope,
              [...path, "groups"],
              ui.createGroup(envelope, day.sessions?.[0]?.id || null)
            ),
          ),
      })}
      </section>
    `;
  }

  renderRuleFields(program, rule, ruleIndex, phasePath) {
    const path = [...phasePath, "endRules", ruleIndex];
    const ruleCase = enumCase(rule);
    const payload = enumPayload(rule) || {};
    const payloadPath = [...path, ruleCase];
    const variables = program.variables || [];
    const measures = ui.collectMeasureIds(this.state.envelope);
    const fields = [
      TextField({
        label: "ルールの内部ID",
        value: payload.id,
        hint: "他の設定と区別するための名前です。通常は変更不要です",
        focusKey: `${pathKey(payloadPath)}.id`,
        onInput: value => this.update([...payloadPath, "id"], value),
      }),
    ];
    const variableField = key =>
      SelectField({
        label: "変更する基準重量",
        value: payload[key],
        focusKey: `${pathKey(payloadPath)}.${key}`,
        onInput: value => this.update([...payloadPath, key], value),
        children: variables.map(
          variable => html`<option value=${variable.id}>${variable.label || variable.id}</option>`,
        ),
      });
    const measureField = () =>
      SelectField({
        label: "どの種目の結果で判定する？",
        value: payload.measureId,
        focusKey: `${pathKey(payloadPath)}.measureId`,
        onInput: value => this.update([...payloadPath, "measureId"], value),
        children: measures.length
          ? measures.map(measure => html`<option value=${measure}>${measure}</option>`)
          : html`<option value="">先に種目の「結果を記録」を有効にしてください</option>`,
      });

    if (["progressIfReached", "always", "progressByTable", "adjustByBand"].includes(ruleCase)) {
      fields.push(variableField("varId"));
    }
    if (ruleCase === "stageDemotion") fields.push(variableField("weightVarId"));
    if (ruleCase !== "always") fields.push(measureField());

    if (ruleCase === "progressIfReached") {
      fields.push(
        ...this.renderEnumFields("target", payload.target, [...payloadPath, "target"], program),
        NumberField({
          label: "加重量 kg",
          value: payload.increment,
          step: "0.5",
          focusKey: `${pathKey(payloadPath)}.increment`,
          onInput: value => this.update([...payloadPath, "increment"], value),
        }),
      );
    } else if (ruleCase === "always") {
      fields.push(
        NumberField({
          label: "加重量 kg",
          value: payload.increment,
          step: "0.5",
          focusKey: `${pathKey(payloadPath)}.increment`,
          onInput: value => this.update([...payloadPath, "increment"], value),
        }),
      );
    } else if (ruleCase === "progressByTable") {
      const steps = Array.isArray(payload.steps) ? payload.steps : [];
      fields.push(html`
        <div class="steps-editor">
          <span class="mini-label">回数ごとの加重量</span>
          ${steps.map(
            (step, stepIndex) => html`
              <div>
                ${NumberField({
                  label: "最低回数",
                  value: step.atLeast,
                  focusKey: `${pathKey(payloadPath)}.steps.${stepIndex}.atLeast`,
                  onInput: value =>
                    this.update([...payloadPath, "steps", stepIndex, "atLeast"], value),
                })}
                ${NumberField({
                  label: "加重量 kg",
                  value: step.increment,
                  step: "0.5",
                  focusKey: `${pathKey(payloadPath)}.steps.${stepIndex}.increment`,
                  onInput: value =>
                    this.update([...payloadPath, "steps", stepIndex, "increment"], value),
                })}
                ${IconButton({
                  icon: "×",
                  label: "行を削除",
                  danger: true,
                  onClick: () =>
                    this.update(
                      [...payloadPath, "steps"],
                      steps.filter((_, index) => index !== stepIndex),
                    ),
                })}
              </div>
            `,
          )}
          ${Button({
            children: "＋ 行",
            className: "text-button",
            onClick: () =>
              this.update(
                [...payloadPath, "steps"],
                [...steps, { atLeast: 5, increment: 2.5 }],
              ),
          })}
        </div>
      `);
    } else if (ruleCase === "adjustByBand") {
      fields.push(
        NumberField({
          label: "下限",
          value: payload.lower,
          focusKey: `${pathKey(payloadPath)}.lower`,
          onInput: value => this.update([...payloadPath, "lower"], value),
        }),
        NumberField({
          label: "上限",
          value: payload.upper,
          focusKey: `${pathKey(payloadPath)}.upper`,
          onInput: value => this.update([...payloadPath, "upper"], value),
        }),
        NumberField({
          label: "増減量 kg",
          value: payload.delta,
          step: "0.5",
          focusKey: `${pathKey(payloadPath)}.delta`,
          onInput: value => this.update([...payloadPath, "delta"], value),
        }),
      );
    } else if (ruleCase === "stageDemotion") {
      fields.push(
        TextField({
          label: "ステージの識別名",
          value: payload.stageKey,
          hint: "セット・回数表と同じ名前にすると連動します",
          focusKey: `${pathKey(payloadPath)}.stageKey`,
          onInput: value => this.update([...payloadPath, "stageKey"], value),
        }),
        this.renderNumberList(
          "ステージ目標",
          payload.stageTargets,
          [...payloadPath, "stageTargets"],
        ),
        NumberField({
          label: "リセット係数",
          value: payload.resetFactor,
          step: "0.05",
          focusKey: `${pathKey(payloadPath)}.resetFactor`,
          onInput: value => this.update([...payloadPath, "resetFactor"], value),
        }),
        NumberField({
          label: "リセット閾値",
          value: payload.resetThreshold,
          focusKey: `${pathKey(payloadPath)}.resetThreshold`,
          onInput: value => this.update([...payloadPath, "resetThreshold"], value),
        }),
      );
    }
    return fields;
  }

  renderRules(program, phase, phaseIndex, phasePath) {
    const rulesPath = [...phasePath, "endRules"];
    return html`
      <section class="rules-panel" data-model-path=${pathKey(rulesPath)}>
        <div class="subheading rules-heading">
          <div>
            <strong>1周終わったあとの自動調整</strong>
            <span>記録した結果を使って、次回の基準値やステージを変えます。不要なら設定しなくてOKです。</span>
          </div>
          <details class="rule-add-menu">
            <summary>＋ 自動調整を追加</summary>
            <div class="rule-choice-popover">
              <strong>どう調整したいですか？</strong>
              ${Object.entries(RULE_LABELS).map(([ruleCase, label]) => html`
                <button type="button" onClick=${() =>
                  this.mutate(envelope =>
                    ui.insertItem(envelope, rulesPath, ui.ruleDefault(ruleCase, envelope)))}>
                  <span>${label}</span>
                  <small>${RULE_DESCRIPTIONS[ruleCase]}</small>
                </button>
              `)}
            </div>
          </details>
        </div>
        ${(phase.endRules || []).map((rule, ruleIndex) => {
          const path = [...rulesPath, ruleIndex];
          const ruleCase = enumCase(rule);
          const ruleId = enumPayload(rule)?.id || "";
          const missingMetricBehavior =
            (phase.progressionPolicies || []).find(
              policy => policy.ruleId === ruleId
            )?.missingMetricBehavior || "maintain";
          const preview = safeCall(() => ruleText(rule, program.variables || []));
          return html`
            <div class="rule-card" data-model-path=${pathKey(path)}>
              <div class="rule-card-heading">
                ${SelectField({
                  label: "調整方法",
                  value: ruleCase,
                  focusKey: `${pathKey(path)}.case`,
                  onInput: value =>
                    this.mutate(envelope => ui.switchRule(envelope, path, value)),
                  children: optionsFrom(RULE_LABELS),
                })}
                <div
                  class="rule-preview"
                  dangerouslySetInnerHTML=${{ __html: previewHTML(preview) }}
                ></div>
                ${this.structureActions(rulesPath, ruleIndex, "進行ルール")}
              </div>
              <div class="rule-fields">
                ${this.renderRuleFields(program, rule, ruleIndex, phasePath)}
                ${ruleCase === "always"
                  ? null
                  : SelectField({
                      label: "結果を記録しなかったとき",
                      value: missingMetricBehavior,
                      focusKey: `${pathKey(phasePath)}.progressionPolicies.${ruleId}`,
                      onInput: value =>
                        this.mutate(envelope =>
                          ui.setRuleMissingMetricBehavior(
                            envelope,
                            phasePath,
                            ruleId,
                            value
                          )
                        ),
                      children: [
                        ["maintain", "値を変えずに次へ進む"],
                        ["failure", "未達成として調整する"],
                        ["pending", "判断せず確認待ちにする"],
                      ].map(
                        ([value, label]) =>
                          html`<option value=${value}>${label}</option>`
                      ),
                    })}
              </div>
            </div>
          `;
        })}
        ${(phase.endRules || []).length
          ? null
          : Explanation({
              title: "自動調整なし",
              children: "この期間を終えても基準値は変わりません。まず固定メニューを作るなら、このままで大丈夫です。",
              tone: "tip",
            })}
      </section>
    `;
  }

  renderPhase(program, phase, phaseIndex) {
    const phasesPath = ["program", "phases"];
    const path = [...phasesPath, phaseIndex];
    return html`
      <section
        id=${`phase-${phaseIndex}`}
        class="phase-card"
        data-model-path=${pathKey(path)}
      >
        <div class="phase-heading">
          <span class="phase-number">${String(phaseIndex + 1).padStart(2, "0")}</span>
          <div class="phase-fields">
            ${TextField({
              label: "期間の名前",
              value: phase.label,
              focusKey: `${pathKey(path)}.label`,
              onInput: value => this.update([...path, "label"], value),
            })}
            ${NumberField({
              label: "何日で1周？",
              value: phase.windowDays,
              nullable: true,
              hint: "例：週単位なら7",
              focusKey: `${pathKey(path)}.windowDays`,
              onInput: value => this.update([...path, "windowDays"], value),
            })}
          </div>
          ${this.structureActions(phasesPath, phaseIndex, "期間")}
        </div>
        ${AdvancedSettings({
          title: "この期間の次に進む期間",
          description: "通常は画面の並び順どおり",
          className: "phase-routing-settings",
          children: SelectField({
            label: "終了後の行き先",
            value: phase.nextPhaseId || "",
            focusKey: `${pathKey(path)}.nextPhaseId`,
            onInput: value => this.update([...path, "nextPhaseId"], value || null),
            children: [
              html`<option value="">次に並んでいる期間へ進む</option>`,
              ...(program.phases || []).map(item =>
                html`<option value=${item.id}>${item.label || item.id}</option>`),
            ],
          }),
        })}
        ${(phase.days || []).map((day, dayIndex) =>
          this.renderDay(program, day, dayIndex, path, [phaseIndex]),
        )}
        ${Button({
          children: "＋ トレーニング日を追加",
          className: "wide-button dashed",
          onClick: () =>
            this.mutate(envelope =>
              ui.insertItem(envelope, [...path, "days"], ui.createDay(envelope)),
            ),
        })}
        ${this.renderRules(program, phase, phaseIndex, path)}
      </section>
    `;
  }

  renderReader(program) {
    const view = reader.buildReaderModel(program);
    const stats = [
      ["フェーズ数", view.stats.phaseCount, "フェーズ"],
      ["週日数", view.stats.weeklyDays, "日"],
      ["種目数", view.stats.exerciseCount, "種目"],
      ["推定セット数", view.stats.estimatedSets, "セット"],
      ["サイクル日数", view.stats.cycleDays || "—", view.stats.cycleDays ? "日" : ""],
    ];
    return html`
      <main class="reader-pane">
        <section class="reader-hero">
          <span class="reader-kicker">TRAINING PROGRAM</span>
          <h1>${view.name}</h1>
          ${view.note
            ? html`<p class="reader-note">${view.note}</p>`
            : html`<p class="reader-note reader-note-empty">メモはありません。</p>`}
          <dl class="reader-stats">
            ${stats.map(
              ([label, value, unit]) => html`
                <div>
                  <dt>${label}</dt>
                  <dd><strong>${value}</strong><span>${unit}</span></dd>
                </div>
              `,
            )}
          </dl>
        </section>

        <section class="reader-section reader-resources">
          <div class="reader-section-heading">
            <span class="reader-kicker">REFERENCE</span>
            <h2>種目と基準重量</h2>
          </div>
          <div class="reader-resource-columns">
            <div>
              <h3>種目枠</h3>
              <div class="reader-resource-grid">
                ${view.resources.slots.map(
                  slot => html`
                    <article class="reader-resource-card">
                      <span class="reader-resource-type">${slot.label}</span>
                      <h4>${slot.exerciseName}</h4>
                      <p><span>筋肉</span>${slot.muscles}</p>
                      ${slot.conditionText
                        ? html`<p><span>条件</span>${slot.conditionText}</p>`
                        : null}
                    </article>
                  `,
                )}
                ${view.resources.slots.length
                  ? null
                  : html`<p class="reader-empty">種目枠はありません。</p>`}
              </div>
            </div>
            <div>
              <h3>基準重量</h3>
              <div class="reader-resource-grid">
                ${view.resources.variables.map(
                  variable => html`
                    <article class="reader-resource-card reader-variable-card">
                      <span class="reader-resource-type">${variable.label}</span>
                      <h4>${variable.initialValue}</h4>
                      <p><span>由来</span>${variable.source}</p>
                    </article>
                  `,
                )}
                ${view.resources.variables.length
                  ? null
                  : html`<p class="reader-empty">基準重量はありません。</p>`}
              </div>
            </div>
          </div>
        </section>

        ${view.flow.length
          ? html`
              <section class="reader-flow" aria-label="フェーズ循環">
                <div>
                  <span class="reader-kicker">CYCLE</span>
                  <h2>フェーズの循環</h2>
                </div>
                <ol>
                  ${view.flow.map(
                    (step, index) => html`
                      <li class=${step.repeated ? "repeated" : ""}>
                        <span>${step.repeated ? "戻る" : String(index + 1).padStart(2, "0")}</span>
                        <strong>${step.label}</strong>
                      </li>
                    `,
                  )}
                </ol>
              </section>
            `
          : null}

        <div class="reader-phases">
          ${view.phases.map(
            (phase, phaseIndex) => html`
              <section class="reader-phase">
                <header class="reader-phase-heading">
                  <div>
                    <span class="reader-kicker">PHASE ${String(phaseIndex + 1).padStart(2, "0")}</span>
                    <h2>${phase.label}</h2>
                  </div>
                  <p>
                    <strong>${phase.windowDays ?? "—"}</strong>
                    <span>${phase.windowDays == null ? "サイクル日数未設定" : "日サイクル"}</span>
                  </p>
                </header>
                <div class="reader-days">
                  ${phase.days.map(
                    (day, dayIndex) => html`
                      <article class="reader-day">
                        <header class="reader-day-heading">
                          <div>
                            <span>DAY ${String(dayIndex + 1).padStart(2, "0")}</span>
                            <h3>${day.label}</h3>
                          </div>
                          ${day.pill ? html`<strong>${day.pill}</strong>` : null}
                        </header>
                        <div class="reader-blocks">
                          ${day.groups.map(
                            group => html`
                              <section class=${`reader-block ${group.isSuperset ? "superset" : ""}`}>
                                <div class="reader-block-heading">
                                  <span>BLOCK ${String(group.number).padStart(2, "0")}</span>
                                  <strong>${group.isSuperset ? "SUPERSET" : "通常ブロック"}</strong>
                                </div>
                                ${group.setGroups.map(
                                  setGroup => html`
                                    <div class="reader-set-group">
                                      ${group.setGroups.length > 1
                                        ? html`<span class="reader-set-label">セット ${setGroup.number}</span>`
                                        : null}
                                      ${setGroup.prescriptions.map(
                                        prescription => html`
                                          <p
                                            class=${`reader-prescription ${
                                              prescription.measured ? "measured" : ""
                                            }`}
                                            dangerouslySetInnerHTML=${{
                                              __html: previewHTML(prescription.html),
                                            }}
                                          ></p>
                                        `,
                                      )}
                                    </div>
                                  `,
                                )}
                              </section>
                            `,
                          )}
                          ${day.groups.length
                            ? null
                            : html`<p class="reader-empty">ブロックはありません。</p>`}
                        </div>
                      </article>
                    `,
                  )}
                  ${phase.days.length
                    ? null
                    : html`<p class="reader-empty">トレーニング日はありません。</p>`}
                </div>
                ${phase.rules.length
                  ? html`
                      <section class="reader-rules">
                        <div>
                          <span class="reader-kicker">PROGRESSION</span>
                          <h3>進行ルール</h3>
                        </div>
                        <div class="reader-rule-list">
                          ${phase.rules.map(
                            rule => html`
                              <article class="reader-rule">
                                <p
                                  dangerouslySetInnerHTML=${{
                                    __html: previewHTML(rule.html),
                                  }}
                                ></p>
                                ${rule.measureReference
                                  ? html`
                                      <small class=${rule.missingReference ? "missing" : ""}>
                                        ${rule.measureReference}
                                      </small>
                                    `
                                  : null}
                              </article>
                            `,
                          )}
                        </div>
                      </section>
                    `
                  : null}
              </section>
            `,
          )}
        </div>
      </main>
    `;
  }

  renderValidation(errors, coreLoading) {
    return html`
      <aside id="finish-check" class="validation-pane">
        <div class="pane-title">
          <span>仕上げチェック</span>
          <span class=${`validation-count ${errors.length ? "has-errors" : ""}`}>
            ${coreLoading ? "確認中" : errors.length ? `要確認 ${errors.length}` : "準備OK"}
          </span>
        </div>
        <div class="validation-scroll">
          ${coreLoading
            ? html`<div class="check-loading"><span></span><p>入力内容に問題がないか確認しています…</p></div>`
            : null}
          ${this.state.catalog || coreLoading
            ? null
            : html`
                <div class="catalog-nudge">
                  <strong>アプリの種目名も確認できます</strong>
                  <p>「その他」からアプリの種目を読み込むと、存在しない種目名を見つけられます。</p>
                  ${Button({
                    children: "種目を読み込む",
                    className: "small",
                    onClick: () => this.setState({ catalogOpen: true, catalogError: null }),
                  })}
                </div>
              `}
          ${errors.length
            ? html`
                <p class="validation-summary">次の項目を直すとアプリへ戻せます。クリックすると該当箇所へ移動します。</p>
                <ol class="error-list">
                  ${errors.map(
                    (error, index) => html`
                      <li>
                        <button type="button" onClick=${() => this.scrollToError(error)}>
                          <span>${index + 1}</span>
                          <span>${error}</span>
                        </button>
                      </li>
                    `,
                  )}
                </ol>
              `
            : html`
                <div class="validation-ok">
                  <span>✓</span>
                  <strong>アプリへ戻せます</strong>
                  <p>入力内容に問題は見つかりませんでした。</p>
                </div>
              `}
        </div>
        ${Button({
          children: "上級者向け：JSONを直接編集",
          className: "wide-button",
          onClick: () => this.openJSON(),
        })}
        <details class="validation-technical">
          <summary>チェック方法について</summary>
          <p>${this.state.validationEngine === "wasm"
            ? "TrainingLoggerと共通のSwiftコアで確認済みです。"
            : this.state.validationEngine === "error"
              ? "チェック機能を読み込めませんでした。ページを再読み込みしてください。"
              : "チェック機能を読み込んでいます。"}</p>
        </details>
        <p class="autosave-note">編集内容は、このブラウザに自動保存されます。</p>
      </aside>
    `;
  }

  renderJSONDrawer() {
    if (!this.state.jsonOpen) return null;
    return html`
      <div class="drawer-backdrop" onClick=${event => {
        if (event.target === event.currentTarget) this.setState({ jsonOpen: false });
      }}>
        <aside class="json-drawer" aria-label="JSONエディタ">
          <div class="drawer-heading">
            <div>
              <span class="eyebrow">上級者向け</span>
              <h2>プログラムのJSONを直接編集</h2>
            </div>
            ${IconButton({
              icon: "×",
              label: "JSONを閉じる",
              onClick: () => this.setState({ jsonOpen: false }),
            })}
          </div>
          <div class="drawer-actions">
            ${Button({ children: "整形", onClick: () => this.formatJSON() })}
            ${Button({
              children: "検証して反映",
              className: "primary",
              onClick: () => this.applyJSON(),
            })}
          </div>
          ${this.state.jsonErrors.length
            ? html`
                <div class="json-errors">
                  <strong>${this.state.jsonErrors.length}件の問題</strong>
                  <ul>${this.state.jsonErrors.map(error => html`<li>${error}</li>`)}</ul>
                </div>
              `
            : null}
          <textarea
            class="json-editor"
            spellcheck="false"
            data-json-editor="true"
            value=${this.state.jsonText}
            onInput=${event => this.setState({ jsonText: event.currentTarget.value })}
          ></textarea>
          <p class="drawer-hint">
            TrainingLoggerからコピーしたプログラムの貼り付けにも使えます。JSONに問題がある場合は、上の一覧を確認して修正してください。
          </p>
        </aside>
      </div>
    `;
  }

  /**
   * 種目名・筋肉キーの入力候補（ADR-0080）。カタログが無ければ何も出さない。
   * 種目名は枠の種目タイプごとに候補を分け、型の合わない種目を出さない。
   */
  renderCatalogDataLists() {
    const catalog = this.state.catalog;
    if (!catalog) return null;
    const kinds = ["", ...catalogModel.KINDS];
    return html`
      ${kinds.map(
        kind => html`
          <datalist id=${exerciseListId(kind)}>
            ${catalogModel.candidateNames(catalog, kind).map(
              name => html`<option value=${name}></option>`,
            )}
          </datalist>
        `,
      )}
      <datalist id=${MUSCLE_LIST_ID}>
        ${(catalog.muscles || []).map(
          muscle => html`<option value=${muscle.key}>${muscle.name}</option>`,
        )}
      </datalist>
    `;
  }

  /**
   * 種目名の状態を1行で伝える。カタログがあるときだけ出す（ADR-0080）。
   * ここは検証（wasm）ではなく入力の手当てなので、指摘一覧には積まない。
   */
  /**
   * 筋肉キーの候補（ADR-0080）。カンマ区切りの入力に datalist を付けても
   * 2個目以降を補完できないので、閉じた集合をトグルとして出す。
   */
  renderMuscleChips(path, slot) {
    const muscles = this.state.catalog?.muscles || [];
    if (!muscles.length) return null;
    const selected = new Set(slot.muscleKeys || []);
    return html`
      <div class="muscle-chips" role="group" aria-label="筋肉キーの候補">
        ${muscles.map(
          muscle => html`
            <button
              type="button"
              class=${selected.has(muscle.key) ? "chip active" : "chip"}
              aria-pressed=${selected.has(muscle.key)}
              title=${muscle.key}
              onClick=${() => this.toggleMuscleKey(path, muscle.key)}
            >
              ${muscle.name}
            </button>
          `,
        )}
      </div>
    `;
  }

  toggleMuscleKey(path, key) {
    const current = ui.getAtPath(this.state.envelope, [...path, "muscleKeys"]) || [];
    const next = current.includes(key)
      ? current.filter(item => item !== key)
      : [...current, key];
    this.update([...path, "muscleKeys"], next, `muscle:${pathKey(path)}`);
  }

  exerciseNameHint(slot, activityKind) {
    const catalog = this.state.catalog;
    if (!catalog || !slot.exerciseName) return null;
    const { status, kind } = catalogModel.resolveExerciseSelection(
      catalog,
      slot.exerciseName,
    );
    if (status === "unknown") {
      return html`<p class="field-hint warn">この名前の種目はアプリにありません</p>`;
    }
    if (status === "ambiguous") {
      return html`
        <p class="field-hint warn">
          同名の種目が複数あるためUUIDを確定できません。アプリ側で名前を分けてください
        </p>
      `;
    }
    if (activityKind && kind && kind !== activityKind) {
      return html`
        <p class="field-hint warn">
          種目タイプが${KIND_LABELS[activityKind] || activityKind}の枠に
          ${KIND_LABELS[kind] || kind}の種目を指定しています
        </p>
      `;
    }
    return null;
  }

  renderCatalogDrawer() {
    if (!this.state.catalogOpen) return null;
    const catalog = this.state.catalog;
    return html`
      <div class="drawer-backdrop" onClick=${event => {
        if (event.target === event.currentTarget) this.setState({ catalogOpen: false });
      }}>
        <aside class="json-drawer" aria-label="種目リスト">
          <div class="drawer-heading">
            <div>
              <span class="eyebrow">任意の準備</span>
              <h2>アプリの種目を読み込む</h2>
            </div>
            ${IconButton({
              icon: "×",
              label: "種目リストを閉じる",
              onClick: () => this.setState({ catalogOpen: false }),
            })}
          </div>
          <p class="drawer-hint">
            TrainingLoggerアプリで「設定 → データ管理 → Web用に種目リストをコピー」を選び、
            コピーされた内容を下に貼り付けてください。種目を候補から選べるようになります。
          </p>
          ${catalog
            ? html`
                <p class="catalog-summary">
                  候補${catalogModel.candidateNames(catalog).length}件
                  ${archivedCount(catalog)
                    ? html`（ほかにアーカイブ済み${archivedCount(catalog)}件を照合に使用）`
                    : null}
                  ・筋肉${catalog.muscles.length}件
                  ${catalog.exportedAt ? html` ・ ${formatExportedAt(catalog.exportedAt)}取得` : null}
                </p>
              `
            : null}
          <div class="drawer-actions">
            ${Button({
              children: "貼り付けた種目を読み込む",
              className: "primary",
              onClick: () => this.applyCatalog(),
            })}
            ${catalog
              ? Button({ children: "消去", onClick: () => this.clearCatalog() })
              : null}
          </div>
          ${this.state.catalogError
            ? html`
                <div class="json-errors">
                  <strong>読み込めません</strong>
                  <ul><li>${this.state.catalogError}</li></ul>
                </div>
              `
            : null}
          <textarea
            class="json-editor"
            spellcheck="false"
            data-json-editor="true"
            placeholder='{"format":"traininglogger.catalog", …}'
            value=${this.state.catalogText}
            onInput=${event => this.setState({ catalogText: event.currentTarget.value })}
          ></textarea>
        </aside>
      </div>
    `;
  }

  render() {
    const envelope = this.state.envelope;
    const candidateProgram = envelope?.program;
    const program = isRenderableProgram(candidateProgram) ? candidateProgram : null;
    // null = Swiftコア読み込み中(検証結果なし)
    const errors = this.state.validationErrors ?? [];
    const coreLoading = this.state.validationErrors === null;
    const phases = program?.phases || [];
    return html`
      <div class=${`app-shell ${this.state.mode === "reader" ? "reader-mode" : "edit-mode"}`}>
        ${this.renderHeader(program, errors)}
        ${this.state.status
          ? html`<div class=${`toast ${this.state.status.kind}`}>${this.state.status.text}</div>`
          : null}
        ${program
          ? this.state.mode === "reader"
            ? this.renderReader(program)
            : html`
              <div class="workspace">
                ${this.renderTree(phases)}
                <main class="editor-pane">
                  ${this.renderStartGuide(program, errors, coreLoading)}
                  ${this.renderOverview(program)}
                  <datalist id="slot-id-list">
                    ${(program.slots || []).map(slot => html`<option value=${slot.id}></option>`)}
                  </datalist>
                  <datalist id="extra-field-key-list">
                    ${EXTRA_FIELD_KEYS.map(fieldKey => html`<option value=${fieldKey}></option>`)}
                  </datalist>
                  ${phases.map((phase, phaseIndex) =>
                    this.renderPhase(program, phase, phaseIndex),
                  )}
                  ${phases.length
                    ? null
                    : html`
                        <section class="editor-card empty-program">
                          ${EmptyHint({ children: "フェーズがありません。" })}
                          ${Button({
                            children: "フェーズを追加",
                            className: "primary",
                            onClick: () =>
                              this.mutate(current =>
                                ui.insertItem(
                                  current,
                                  ["program", "phases"],
                                  ui.createPhase(current),
                                ),
                              ),
                          })}
                        </section>
                  `}
                  ${this.renderSlots(program)}
                  ${this.renderVariables(program)}
                </main>
                ${this.renderValidation(errors, coreLoading)}
              </div>
            `
          : html`
              <main class="invalid-envelope">
                <h1>program を表示できません</h1>
                <p>JSONエディタで traininglogger.program v2 を貼り付けてください。</p>
                ${errors.length
                  ? html`<ul>${errors.slice(0, 8).map(error => html`<li>${error}</li>`)}</ul>`
                  : null}
                ${Button({
                  children: "JSONを開く",
                  className: "primary",
                  onClick: () => this.openJSON(),
                })}
              </main>
            `}
        ${this.renderJSONDrawer()}
        ${this.renderCatalogDrawer()}
        ${this.renderCatalogDataLists()}
      </div>
    `;
  }
}

function archivedCount(catalog) {
  return (catalog?.exercises || []).filter(entry => entry.archived).length;
}

/** 種目タイプ別の候補リスト。kind が空なら全種目 */
function exerciseListId(kind) {
  return kind ? `${EXERCISE_LIST_ID}-${kind}` : EXERCISE_LIST_ID;
}

/** ISO8601 を「2026-08-14」まで縮める。日付として読めなければそのまま出す */
function formatExportedAt(value) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : value;
}

render(h(ProgramBuilder, null), document.getElementById("app"));
