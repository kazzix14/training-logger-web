// TrainingLogger プログラムビルダー UI。
// Preact + htm をローカル vendor から読み込み、ビルドなしで動作させる。
import { Component, h, render } from "./vendor/preact.module.js";
import htm from "./vendor/htm.module.js";
import { validateWithWasm } from "./wasm-core.js";

const html = htm.bind(h);
const ui = globalThis.TrainingLoggerUIModel;
const {
  b64urlDecode,
  b64urlEncode,
  countText,
  enumCase,
  enumPayload,
  loadText,
  repsText,
  ruleText,
} = globalThis;

const STORAGE_KEY = "traininglogger.program.builder.v1";
const HISTORY_LIMIT = 100;

function knownExerciseNames(envelope) {
  return (envelope?.program?.slots || [])
    .map(slot => slot.exerciseName)
    .filter(name => typeof name === "string" && name.length > 0);
}
const RULE_LABELS = {
  progressIfReached: "達成で加重",
  always: "毎回加重",
  progressByTable: "実測テーブル加重",
  adjustByBand: "帯で自動調整",
  stageDemotion: "ステージ降格",
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

function extraText(extra) {
  const extraCase = enumCase(extra.kind);
  const payload = enumPayload(extra.kind) || {};
  const label = extra.fieldKey || "追加指標";
  if (extraCase === "exact") return `${label} ${payload._0}`;
  if (extraCase === "range") return `${label} ${payload.lo}〜${payload.hi}`;
  return `${label} ?`;
}

function optionsFrom(map) {
  return Object.entries(map).map(([value, label]) => html`<option value=${value}>${label}</option>`);
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
}) {
  const handleInput = event => onInput(nullable && event.currentTarget.value === "" ? null : event.currentTarget.value);
  return html`
    <label class=${`field ${className}`}>
      <span>${label}</span>
      ${multiline
        ? html`
            <textarea
              value=${value ?? ""}
              placeholder=${placeholder}
              data-focus=${focusKey}
              onInput=${handleInput}
            ></textarea>
          `
        : html`
            <input
              type="text"
              value=${value ?? ""}
              placeholder=${placeholder}
              data-focus=${focusKey}
              onInput=${handleInput}
            />
          `}
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
    </label>
  `;
}

function SelectField({ label, value, onInput, children, className = "", focusKey = "" }) {
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
      validationErrors: null,
      validationEngine: "loading",
      templateName: "minimal",
      status: initial.status,
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

  componentDidMount() {
    this.keyHandler = event => this.handleKeyDown(event);
    this.hashHandler = () => this.loadFragment();
    addEventListener("keydown", this.keyHandler);
    addEventListener("hashchange", this.hashHandler);
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
    validateWithWasm(envelope, knownExerciseNames(envelope)).then(errors => {
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
    const wasmErrors = await validateWithWasm(
      envelope,
      knownExerciseNames(envelope),
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
    } catch (error) {
      this.showStatus(`共有リンクを読めません: ${error.message}`, "error");
    }
  }

  showStatus(text, kind = "ok") {
    clearTimeout(this.statusTimer);
    this.setState({ status: { text, kind } });
    this.statusTimer = setTimeout(() => this.setState({ status: null }), 4000);
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
      "JSONをコピーしました",
    );
  }

  copyLink() {
    const url = `${location.origin}${location.pathname}#p=${b64urlEncode(
      JSON.stringify(this.state.envelope),
    )}`;
    this.writeClipboard(url, "共有リンクをコピーしました");
  }

  insertTemplate() {
    const label = this.state.templateName === "531" ? "5/3/1風" : "最小線形";
    if (!confirm(`${label}テンプレートで現在の内容を置き換えます。取り消しで戻せます。`)) return;
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
      <div class="row-actions">
        ${IconButton({
          icon: "↑",
          label: `${label}を上へ`,
          disabled: index === 0,
          onClick: () => this.mutate(envelope => ui.moveItem(envelope, arrayPath, index, -1)),
        })}
        ${IconButton({
          icon: "↓",
          label: `${label}を下へ`,
          disabled: index === array.length - 1,
          onClick: () => this.mutate(envelope => ui.moveItem(envelope, arrayPath, index, 1)),
        })}
        ${options.duplicate === false
          ? null
          : IconButton({
              icon: "⧉",
              label: `${label}を複製`,
              onClick: () =>
                this.mutate(envelope =>
                  ui.duplicateStructure(envelope, arrayPath, index, {
                    clearMeasures: options.clearMeasures,
                  }),
                ),
            })}
        ${IconButton({
          icon: "×",
          label: `${label}を削除`,
          danger: true,
          onClick: () =>
            this.confirmDelete(label, () =>
              this.mutate(envelope => ui.removeItem(envelope, arrayPath, index)),
            ),
        })}
      </div>
    `;
  }

  renderHeader(program) {
    return html`
      <header class="app-header">
        <div class="brand">
          <span class="brand-mark">TL</span>
          <div>
            <strong>${program?.name || "名称未設定"}</strong>
            <small>プログラムビルダー</small>
          </div>
        </div>
        <div class="header-actions">
          ${Button({
            children: "JSONをコピー",
            className: "primary",
            onClick: () => this.copyJSON(),
          })}
          ${Button({ children: "共有リンクをコピー", onClick: () => this.copyLink() })}
          <div class="template-control">
            <select
              aria-label="テンプレート"
              value=${this.state.templateName}
              onInput=${event => this.setState({ templateName: event.currentTarget.value })}
            >
              <option value="minimal">最小線形</option>
              <option value="531">5/3/1風</option>
            </select>
            ${Button({ children: "挿入", onClick: () => this.insertTemplate() })}
          </div>
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
        </div>
      </header>
    `;
  }

  renderTree(phases) {
    return html`
      <nav class="tree-pane" aria-label="プログラム構造">
        <div class="pane-title">
          <span>構造</span>
          <span class="count-badge">${phases.length} フェーズ</span>
        </div>
        <div class="tree-scroll">
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
        </div>
        ${Button({
          children: "＋ フェーズを追加",
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
            <h1>プログラム設定</h1>
          </div>
        </div>
        <div class="form-grid overview-grid">
          ${TextField({
            label: "プログラム名",
            value: program.name,
            className: "span-2",
            focusKey: "program.name",
            onInput: value => this.update(["program", "name"], value),
          })}
          ${TextField({
            label: "メモ",
            value: program.note,
            className: "span-2",
            multiline: true,
            focusKey: "program.note",
            placeholder: "目的、頻度、注意点など",
            onInput: value => this.update(["program", "note"], value),
          })}
        </div>
      </section>
    `;
  }

  renderVariables(program) {
    const variablesPath = ["program", "variables"];
    return html`
      <section class="editor-card" data-model-path="program.variables">
        <div class="section-heading">
          <div>
            <span class="eyebrow">VARIABLES</span>
            <h2>基準重量</h2>
            <p>進行ルールや割合指定の基準になる重量です。</p>
          </div>
          ${Button({
            children: "＋ 基準重量",
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
              <div class="resource-row" data-model-path=${pathKey(path)}>
                <div class="resource-main">
                  ${TextField({
                    label: "ID",
                    value: variable.id,
                    className: "id-field",
                    focusKey: `${pathKey(path)}.id`,
                    onInput: value => this.rename(path, value, ["varId", "weightVarId"]),
                  })}
                  ${TextField({
                    label: "表示名",
                    value: variable.label,
                    focusKey: `${pathKey(path)}.label`,
                    onInput: value => this.update([...path, "label"], value),
                  })}
                  ${NumberField({
                    label: "初期値",
                    value: variable.fallbackValue,
                    step: "0.5",
                    min: "0.5",
                    max: "500",
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
                  ${NumberField({
                    label: "e1RM係数",
                    value: variable.e1rmFactor,
                    nullable: true,
                    step: "0.01",
                    min: "0",
                    max: "2",
                    focusKey: `${pathKey(path)}.e1rmFactor`,
                    onInput: value => this.update([...path, "e1rmFactor"], value),
                  })}
                  ${SelectField({
                    label: "対応する種目枠",
                    value: variable.slotId || "",
                    focusKey: `${pathKey(path)}.slotId`,
                    onInput: value => this.update([...path, "slotId"], value || null),
                    children: [
                      html`<option value="">指定なし</option>`,
                      ...(program.slots || []).map(
                        slot => html`<option value=${slot.id}>${slot.label || slot.id}</option>`,
                      ),
                    ],
                  })}
                </div>
                ${this.structureActions(variablesPath, index, "基準重量")}
              </div>
            `;
          })}
          ${(program.variables || []).length ? null : EmptyHint({ children: "基準重量がありません。" })}
        </div>
      </section>
    `;
  }

  renderSlots(program) {
    const slotsPath = ["program", "slots"];
    return html`
      <section class="editor-card" data-model-path="program.slots">
        <div class="section-heading">
          <div>
            <span class="eyebrow">SLOTS</span>
            <h2>種目枠</h2>
            <p>具体的な種目、またはアプリ採用時に選ぶ条件枠です。</p>
          </div>
          ${Button({
            children: "＋ 種目枠",
            className: "small primary",
            onClick: () =>
              this.mutate(envelope => ui.insertItem(envelope, slotsPath, ui.createSlot(envelope))),
          })}
        </div>
        <div class="compact-list">
          ${(program.slots || []).map((slot, index) => {
            const path = [...slotsPath, index];
            return html`
              <div class="resource-row" data-model-path=${pathKey(path)}>
                <div class="resource-main slots-grid">
                  ${TextField({
                    label: "ID",
                    value: slot.id,
                    className: "id-field",
                    focusKey: `${pathKey(path)}.id`,
                    onInput: value =>
                      this.rename(path, value, ["slotId", "slotIds"]),
                  })}
                  ${TextField({
                    label: "表示名",
                    value: slot.label,
                    focusKey: `${pathKey(path)}.label`,
                    onInput: value => this.update([...path, "label"], value),
                  })}
                  ${TextField({
                    label: "種目名",
                    value: slot.exerciseName,
                    nullable: true,
                    placeholder: "未指定なら採用時に選択",
                    focusKey: `${pathKey(path)}.exerciseName`,
                    onInput: value => this.update([...path, "exerciseName"], value),
                  })}
                  ${TextField({
                    label: "種目UUID",
                    value: slot.exerciseUuid,
                    nullable: true,
                    placeholder: "任意",
                    focusKey: `${pathKey(path)}.exerciseUuid`,
                    onInput: value => this.update([...path, "exerciseUuid"], value),
                  })}
                  ${TextField({
                    label: "筋肉キー（カンマ区切り）",
                    value: (slot.muscleKeys || []).join(", "),
                    focusKey: `${pathKey(path)}.muscleKeys`,
                    onInput: value =>
                      this.update(
                        [...path, "muscleKeys"],
                        value
                          .split(",")
                          .map(item => item.trim())
                          .filter(Boolean),
                      ),
                  })}
                  ${TextField({
                    label: "選択条件",
                    value: slot.conditionText,
                    placeholder: "例: 脚のコンパウンド種目",
                    focusKey: `${pathKey(path)}.conditionText`,
                    onInput: value => this.update([...path, "conditionText"], value),
                  })}
                </div>
                ${this.structureActions(slotsPath, index, "種目枠")}
              </div>
            `;
          })}
          ${(program.slots || []).length ? null : EmptyHint({ children: "種目枠がありません。" })}
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
        label: "形式",
        value: currentCase || Object.keys(labels)[0],
        focusKey: `${pathKey(path)}.case`,
        onInput: changeCase,
        children: optionsFrom(labels),
      }),
    );
    if (!payload) return fields;

    if (currentCase === "fixed") {
      fields.push(
        NumberField({
          label: kind === "load" ? "kg" : kind === "count" ? "セット" : "回",
          value: payload._0,
          step: kind === "load" ? "0.5" : "1",
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
          focusKey: `${pathKey(path)}.${currentCase}.lo`,
          onInput: next => this.update([...path, currentCase, "lo"], next),
        }),
        NumberField({
          label: "上限",
          value: payload.hi,
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
          value: payload.percent,
          step: "0.5",
          focusKey: `${pathKey(path)}.percentOfVar.percent`,
          onInput: next => this.update([...path, "percentOfVar", "percent"], next),
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
          label: "stageKey",
          value: payload.stageKey,
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

  renderEntries(program, group, groupPath) {
    return html`
      <div class="entries-panel">
        <div class="subheading">
          <strong>種目行</strong>
          ${Button({
            children: "＋ 種目行",
            className: "small",
            onClick: () => this.mutate(envelope => ui.addEntry(envelope, groupPath)),
          })}
        </div>
        ${(group.entries || []).map((entry, entryIndex) => {
          const path = [...groupPath, "entries", entryIndex];
          return html`
            <div class="entry-row" data-model-path=${pathKey(path)}>
              <span class="drag-index">${entryIndex + 1}</span>
              <label class="field grow">
                <span>種目枠（ローテーション順、カンマ区切り）</span>
                <input
                  type="text"
                  value=${(entry.slotIds || (entry.slotId ? [entry.slotId] : [])).join(", ")}
                  list="slot-id-list"
                  data-focus=${`${pathKey(path)}.slotIds`}
                  onInput=${event =>
                    this.update(
                      [...path, "slotIds"],
                      event.currentTarget.value
                        .split(",")
                        .map(value => value.trim())
                        .filter(Boolean),
                    )}
                />
              </label>
              ${TextField({
                label: "methodologyId",
                value: entry.methodologyId,
                nullable: true,
                className: "method-field",
                placeholder: "任意",
                focusKey: `${pathKey(path)}.methodologyId`,
                onInput: value => this.update([...path, "methodologyId"], value),
              })}
              <div class="row-actions">
                ${IconButton({
                  icon: "↑",
                  label: "種目行を上へ",
                  disabled: entryIndex === 0,
                  onClick: () =>
                    this.mutate(envelope => ui.moveEntry(envelope, groupPath, entryIndex, -1)),
                })}
                ${IconButton({
                  icon: "↓",
                  label: "種目行を下へ",
                  disabled: entryIndex === group.entries.length - 1,
                  onClick: () =>
                    this.mutate(envelope => ui.moveEntry(envelope, groupPath, entryIndex, 1)),
                })}
                ${IconButton({
                  icon: "⧉",
                  label: "種目行を複製",
                  onClick: () =>
                    this.mutate(envelope => ui.duplicateEntry(envelope, groupPath, entryIndex)),
                })}
                ${IconButton({
                  icon: "×",
                  label: "種目行を削除",
                  danger: true,
                  onClick: () =>
                    this.confirmDelete("種目行", () =>
                      this.mutate(envelope => ui.removeEntry(envelope, groupPath, entryIndex)),
                    ),
                })}
              </div>
            </div>
          `;
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
    const slotIds = entry?.slotIds || (entry?.slotId ? [entry.slotId] : []);
    const slotNames = slotIds.map(
      id => (program.slots || []).find(slot => slot.id === id)?.label || id,
    );
    const preview = `${safeCall(() => countText(setGroup.count))} × ${safeCall(() =>
      repsText(target.reps),
    )} ・ ${safeCall(() => loadText(target.load, program.variables || []))}`;
    const measureFallback = `measure_${location.map(value => value + 1).join("_")}`;
    const extrasPath = [...path, "extras"];

    return html`
      <div class="target-row" data-model-path=${pathKey(path)}>
        <div class="target-title">
          <div>
            <span class="entry-name">${slotNames.join(" / ") || target.entryId}</span>
            <code>${target.entryId}</code>
          </div>
          <div class="prescription" dangerouslySetInnerHTML=${{ __html: previewHTML(preview) }}></div>
        </div>
        <div class="enum-line">
          <div class="enum-group">
            <span class="mini-label">回数</span>
            ${this.renderEnumFields("reps", target.reps, [...path, "reps"], program)}
          </div>
          <div class="enum-group">
            <span class="mini-label">重量</span>
            ${this.renderEnumFields("load", target.load, [...path, "load"], program)}
          </div>
        </div>
        <div class="measure-line">
          ${Toggle({
            label: "この行を実測する",
            checked: Boolean(target.measureId),
            className: target.measureId ? "measured" : "",
            onInput: enabled => this.toggleMeasure(path, enabled, measureFallback),
          })}
          ${target.measureId
            ? [
                TextField({
                  label: "measureId",
                  value: target.measureId,
                  className: "measure-field",
                  focusKey: `${pathKey(path)}.measureId`,
                  onInput: value => this.update([...path, "measureId"], value),
                }),
                TextField({
                  label: "実測フィールド",
                  value: target.measureFieldKey,
                  nullable: true,
                  className: "measure-field",
                  placeholder: "既定値",
                  focusKey: `${pathKey(path)}.measureFieldKey`,
                  onInput: value => this.update([...path, "measureFieldKey"], value),
                }),
              ]
            : null}
        </div>
        <div class="extras">
          ${(target.extras || []).map((extra, extraIndex) =>
            this.renderExtra(extra, extraIndex, extrasPath),
          )}
          ${Button({
            children: "＋ 追加指標",
            className: "text-button",
            onClick: () => this.mutate(envelope => ui.addExtra(envelope, path)),
          })}
          ${(target.extras || []).length
            ? html`<span class="extra-preview">${target.extras.map(extraText).join(" / ")}</span>`
            : null}
        </div>
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
            <span class="set-number">SET ${setGroupIndex + 1}</span>
            <code>${setGroup.id}</code>
          </div>
          <div class="count-editor">
            <span class="mini-label">セット数</span>
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

  renderGroup(program, group, groupIndex, dayPath, location) {
    const groupsPath = [...dayPath, "groups"];
    const path = [...groupsPath, groupIndex];
    return html`
      <article class="block-card" data-model-path=${pathKey(path)}>
        <div class="block-heading">
          <div>
            <span class="eyebrow">BLOCK ${groupIndex + 1}</span>
            <h4>${(group.entries || []).length > 1 ? "スーパーセット" : "通常ブロック"}</h4>
            <code>${group.id}</code>
          </div>
          ${this.structureActions(groupsPath, groupIndex, "ブロック", {
            clearMeasures: true,
          })}
        </div>
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
          children: "＋ セット群を追加",
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
          <span class="day-number">DAY ${dayIndex + 1}</span>
          <div class="day-fields">
            ${TextField({
              label: "日名",
              value: day.label,
              focusKey: `${pathKey(path)}.label`,
              onInput: value => this.update([...path, "label"], value),
            })}
            ${TextField({
              label: "ピル",
              value: day.pill,
              className: "short-field",
              focusKey: `${pathKey(path)}.pill`,
              onInput: value => this.update([...path, "pill"], value),
            })}
          </div>
          ${this.structureActions(daysPath, dayIndex, "日")}
        </div>
        ${(day.groups || []).map((group, groupIndex) =>
          this.renderGroup(program, group, groupIndex, path, [...location, dayIndex]),
        )}
        ${Button({
          children: "＋ ブロックを追加",
          className: "wide-button dashed",
          onClick: () =>
            this.mutate(envelope =>
              ui.insertItem(envelope, [...path, "groups"], ui.createGroup(envelope)),
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
        label: "ルールID",
        value: payload.id,
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
        label: "参照する実測",
        value: payload.measureId,
        focusKey: `${pathKey(payloadPath)}.measureId`,
        onInput: value => this.update([...payloadPath, "measureId"], value),
        children: measures.length
          ? measures.map(measure => html`<option value=${measure}>${measure}</option>`)
          : html`<option value="">先に実測マークを追加</option>`,
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
          label: "stageKey",
          value: payload.stageKey,
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
            <strong>進行ルール</strong>
            <span>フェーズ終了時に評価</span>
          </div>
          <div class="rule-add-menu">
            ${Object.entries(RULE_LABELS).map(([ruleCase, label]) =>
              Button({
                children: `＋ ${label}`,
                className: "small",
                onClick: () =>
                  this.mutate(envelope =>
                    ui.insertItem(envelope, rulesPath, ui.ruleDefault(ruleCase, envelope)),
                  ),
              }),
            )}
          </div>
        </div>
        ${(phase.endRules || []).map((rule, ruleIndex) => {
          const path = [...rulesPath, ruleIndex];
          const ruleCase = enumCase(rule);
          const preview = safeCall(() => ruleText(rule, program.variables || []));
          return html`
            <div class="rule-card" data-model-path=${pathKey(path)}>
              <div class="rule-card-heading">
                ${SelectField({
                  label: "ルール形式",
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
              </div>
            </div>
          `;
        })}
        ${(phase.endRules || []).length
          ? null
          : EmptyHint({ children: "進行ルールなし（このフェーズでは重量を変更しません）。" })}
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
              label: "フェーズ名",
              value: phase.label,
              focusKey: `${pathKey(path)}.label`,
              onInput: value => this.update([...path, "label"], value),
            })}
            ${NumberField({
              label: "サイクル日数",
              value: phase.windowDays,
              nullable: true,
              focusKey: `${pathKey(path)}.windowDays`,
              onInput: value => this.update([...path, "windowDays"], value),
            })}
            ${SelectField({
              label: "次フェーズ",
              value: phase.nextPhaseId || "",
              focusKey: `${pathKey(path)}.nextPhaseId`,
              onInput: value => this.update([...path, "nextPhaseId"], value || null),
              children: [
                html`<option value="">並び順どおり</option>`,
                ...(program.phases || []).map(
                  item => html`<option value=${item.id}>${item.label || item.id}</option>`,
                ),
              ],
            })}
          </div>
          ${this.structureActions(phasesPath, phaseIndex, "フェーズ")}
        </div>
        ${(phase.days || []).map((day, dayIndex) =>
          this.renderDay(program, day, dayIndex, path, [phaseIndex]),
        )}
        ${Button({
          children: "＋ 日を追加",
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

  renderValidation(errors) {
    return html`
      <aside class="validation-pane">
        <div class="pane-title">
          <span>
            検証
            <small class="validation-engine">
              ${this.state.validationEngine === "wasm" ? "wasm ⚙︎"
                : this.state.validationEngine === "error" ? "コア読込失敗"
                : "コア読み込み中…"}
            </small>
          </span>
          <span class=${`validation-count ${errors.length ? "has-errors" : ""}`}>
            ${coreLoading ? "…" : errors.length ? `${errors.length}件` : "OK"}
          </span>
        </div>
        <div class="validation-scroll">
          ${coreLoading
            ? html`<p class="validation-summary">Swiftコア(wasm)を読み込み中…</p>`
            : null}
          ${errors.length
            ? html`
                <p class="validation-summary">項目をクリックすると編集箇所へ移動します。</p>
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
                  <strong>検証OK</strong>
                  <p>traininglogger.program v1 として有効です。</p>
                </div>
              `}
        </div>
        ${Button({
          children: "{ } JSONを開く",
          className: "wide-button",
          onClick: () => this.openJSON(),
        })}
        <p class="autosave-note">変更はこのブラウザへ自動保存されます。</p>
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
              <span class="eyebrow">RAW DATA</span>
              <h2>JSONを直接編集</h2>
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
            貼り付けインポートにも使えます。問題がある場合は一覧を確認し、この画面で修正してください。
          </p>
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
      <div class="app-shell">
        ${this.renderHeader(program)}
        ${this.state.status
          ? html`<div class=${`toast ${this.state.status.kind}`}>${this.state.status.text}</div>`
          : null}
        ${program
          ? html`
              <div class="workspace">
                ${this.renderTree(phases)}
                <main class="editor-pane">
                  ${this.renderOverview(program)}
                  ${this.renderVariables(program)}
                  ${this.renderSlots(program)}
                  <datalist id="slot-id-list">
                    ${(program.slots || []).map(slot => html`<option value=${slot.id}></option>`)}
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
                </main>
                ${this.renderValidation(errors)}
              </div>
            `
          : html`
              <main class="invalid-envelope">
                <h1>program を表示できません</h1>
                <p>JSONエディタで traininglogger.program v1 を貼り付けてください。</p>
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
      </div>
    `;
  }
}

render(h(ProgramBuilder, null), document.getElementById("app"));
