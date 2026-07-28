// TrainingLogger Web UI のモデル操作。
// ブラウザでは TrainingLoggerUIModel、Node では module.exports として公開する。
(function exposeUIModel(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.TrainingLoggerUIModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createUIModel() {
  "use strict";

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getAtPath(model, path) {
    return path.reduce((value, key) => value?.[key], model);
  }

  function edit(model, path, updater) {
    const next = clone(model);
    if (path.length === 0) return updater(next);
    const parent = getAtPath(next, path.slice(0, -1));
    const key = path[path.length - 1];
    parent[key] = updater(parent[key]);
    return next;
  }

  function setValue(model, path, value) {
    return edit(model, path, () => value);
  }

  function insertItem(model, arrayPath, item, index) {
    return edit(model, arrayPath, items => {
      const nextItems = items.slice();
      nextItems.splice(index == null ? nextItems.length : index, 0, clone(item));
      return nextItems;
    });
  }

  function removeItem(model, arrayPath, index) {
    return edit(model, arrayPath, items => items.filter((_, itemIndex) => itemIndex !== index));
  }

  function renameReferences(model, path, nextId, referenceKeys) {
    const next = clone(model);
    const target = getAtPath(next, path);
    const previousId = target.id;
    target.id = nextId;
    const keys = new Set(referenceKeys);

    function visit(value) {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (keys.has(key) && child === previousId) value[key] = nextId;
        if (keys.has(key) && Array.isArray(child)) {
          value[key] = child.map(item => (item === previousId ? nextId : item));
        }
        visit(value[key]);
      }
    }

    visit(next.program);
    return next;
  }

  function moveItem(model, arrayPath, index, offset) {
    return edit(model, arrayPath, items => {
      const destination = index + offset;
      if (destination < 0 || destination >= items.length) return items;
      const nextItems = items.slice();
      const [item] = nextItems.splice(index, 1);
      nextItems.splice(destination, 0, item);
      return nextItems;
    });
  }

  function collectIds(value, ids = new Set()) {
    if (Array.isArray(value)) {
      value.forEach(item => collectIds(item, ids));
    } else if (value && typeof value === "object") {
      if (typeof value.id === "string") ids.add(value.id);
      Object.values(value).forEach(item => collectIds(item, ids));
    }
    return ids;
  }

  function uniqueId(model, prefix) {
    const used = collectIds(model);
    let number = 1;
    let candidate = prefix;
    while (used.has(candidate)) {
      candidate = `${prefix}_${number}`;
      number += 1;
    }
    return candidate;
  }

  function duplicateStructure(model, arrayPath, index, options = {}) {
    const source = getAtPath(model, arrayPath)[index];
    const copied = clone(source);
    const used = collectIds(model);
    const replacements = new Map();

    function freshId(oldId) {
      const base = `${oldId}_copy`;
      let candidate = base;
      let number = 2;
      while (used.has(candidate)) {
        candidate = `${base}${number}`;
        number += 1;
      }
      used.add(candidate);
      replacements.set(oldId, candidate);
      return candidate;
    }

    function rekey(value) {
      if (Array.isArray(value)) return value.forEach(rekey);
      if (!value || typeof value !== "object") return;
      if (typeof value.id === "string") value.id = freshId(value.id);
      Object.values(value).forEach(rekey);
    }

    function repairReferences(value) {
      if (Array.isArray(value)) return value.forEach(repairReferences);
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if ((key === "entryId" || key === "nextPhaseId") && replacements.has(child)) {
          value[key] = replacements.get(child);
        }
        if (options.clearMeasures && key === "measureId") value[key] = null;
        repairReferences(value[key]);
      }
    }

    rekey(copied);
    repairReferences(copied);
    return insertItem(model, arrayPath, copied, index + 1);
  }

  function enumDefault(kind, enumCase, context = {}) {
    const varId = context.varId || context.variables?.[0]?.id || "weight";
    const stageKey = context.stageKey || "stage";
    const defaults = {
      reps: {
        fixed: { fixed: { _0: 5 } },
        amrap: { amrap: { min: 5 } },
        range: { range: { lo: 8, hi: 12 } },
        byStage: { byStage: { stageKey, values: [5, 3, 1] } },
        amrapByStage: { amrapByStage: { stageKey, values: [5, 3, 1] } },
      },
      load: {
        none: null,
        fixed: { fixed: { _0: 20 } },
    percentOfVar: { percentOfVar: { varId, percent: 0.75, annotate: true } },
        variable: { variable: { varId } },
      },
      count: {
        fixed: { fixed: { _0: 3 } },
        byStage: { byStage: { stageKey, values: [3, 3, 3] } },
      },
      extraKind: {
        exact: { exact: { _0: 8 } },
        range: { range: { lo: 8, hi: 10 } },
      },
      target: {
        fixed: { fixed: { _0: 5 } },
        stageReps: { stageReps: { stageKey, values: [5, 3, 1] } },
      },
    };
    if (!defaults[kind] || !(enumCase in defaults[kind])) {
      throw new Error(`未知の enum: ${kind}.${enumCase}`);
    }
    return clone(defaults[kind][enumCase]);
  }

  function switchEnum(model, path, kind, enumCase, context) {
    return setValue(model, path, enumDefault(kind, enumCase, context));
  }

  function createVariable(model) {
    const id = uniqueId(model, "weight");
    return {
      id,
      label: "基準重量",
      unit: "kg",
      e1rmFactor: null,
      fallbackValue: 60,
      slotId: null,
    };
  }

  function createSlot(model) {
    const id = uniqueId(model, "exercise");
    return {
      id,
      label: "種目枠",
      exerciseUuid: null,
      exerciseName: null,
      muscleKeys: [],
      conditionText: "",
      activityRequirement: null,
      distinctGroup: null,
    };
  }

  function createTarget(entryId, variables) {
    return {
      entryId,
      reps: enumDefault("reps", "fixed"),
      load: enumDefault("load", variables?.length ? "percentOfVar" : "fixed", { variables }),
      extras: [],
      measureId: null,
      measureFieldKey: null,
      activityPrescription: null,
    };
  }

function createEntry(model, slotId) {
  const id = uniqueId(model, "entry");
  return {
    id,
    variants: slotId
      ? [
          {
            id: `${id}_v1`,
            slotId,
            label: null,
            methodologyId: { inherit: {} },
            targetOverrides: [],
            progressionRules: { inherit: {} },
          },
        ]
      : [],
    methodologyId: null,
  };
}

  function createSetGroup(model, entries, variables) {
    return {
      id: uniqueId(model, "sets"),
      count: enumDefault("count", "fixed"),
      targets: entries.map(entry => createTarget(entry.id, variables)),
    };
  }

  function createGroup(model) {
    const slotId = model.program?.slots?.[0]?.id || null;
    const entry = createEntry(model, slotId);
    return {
      id: uniqueId(model, "block"),
      entries: [entry],
      setGroups: [createSetGroup(model, [entry], model.program?.variables || [])],
    };
  }

  function createDay(model) {
    const group = createGroup(model);
    return {
      id: uniqueId(model, "day"),
      label: "新しい日",
      pill: "",
      groups: [group],
    };
  }

  function createPhase(model) {
    const day = createDay(model);
    return {
      id: uniqueId(model, "phase"),
      label: "新しいフェーズ",
      windowDays: 7,
      days: [day],
      endRules: [],
      nextPhaseId: null,
    };
  }

  function addEntry(model, groupPath) {
    const next = clone(model);
    const group = getAtPath(next, groupPath);
    const slotId = next.program?.slots?.[0]?.id || null;
    const entry = createEntry(next, slotId);
    group.entries.push(entry);
    group.setGroups.forEach(setGroup => {
      setGroup.targets.push(createTarget(entry.id, next.program?.variables || []));
    });
    return next;
  }

  function duplicateEntry(model, groupPath, entryIndex) {
    const next = clone(model);
    const group = getAtPath(next, groupPath);
    const source = group.entries[entryIndex];
    const copied = clone(source);
    copied.id = uniqueId(next, `${source.id}_copy`);
    group.entries.splice(entryIndex + 1, 0, copied);
    group.setGroups.forEach(setGroup => {
      const targetIndex = setGroup.targets.findIndex(target => target.entryId === source.id);
      const copiedTarget = clone(setGroup.targets[targetIndex] || createTarget(source.id, next.program?.variables || []));
      copiedTarget.entryId = copied.id;
      copiedTarget.measureId = null;
      setGroup.targets.splice(targetIndex + 1, 0, copiedTarget);
    });
    return next;
  }

  function removeEntry(model, groupPath, entryIndex) {
    const next = clone(model);
    const group = getAtPath(next, groupPath);
    const [removed] = group.entries.splice(entryIndex, 1);
    group.setGroups.forEach(setGroup => {
      setGroup.targets = setGroup.targets.filter(target => target.entryId !== removed.id);
    });
    return next;
  }

  function moveEntry(model, groupPath, entryIndex, offset) {
    const next = clone(model);
    const group = getAtPath(next, groupPath);
    const destination = entryIndex + offset;
    if (destination < 0 || destination >= group.entries.length) return next;
    const [entry] = group.entries.splice(entryIndex, 1);
    group.entries.splice(destination, 0, entry);
    group.setGroups.forEach(setGroup => {
      setGroup.targets.sort(
        (left, right) =>
          group.entries.findIndex(item => item.id === left.entryId) -
          group.entries.findIndex(item => item.id === right.entryId),
      );
    });
    return next;
  }

  function addSetGroup(model, groupPath) {
    const next = clone(model);
    const group = getAtPath(next, groupPath);
    group.setGroups.push(createSetGroup(next, group.entries, next.program?.variables || []));
    return next;
  }

  function addExtra(model, targetPath) {
    const next = clone(model);
    getAtPath(next, targetPath).extras.push({
      fieldKey: "rpe.rpe",
      kind: enumDefault("extraKind", "exact"),
    });
    return next;
  }

  function ruleDefault(ruleCase, model) {
    const variable = model.program?.variables?.[0]?.id || "weight";
    const measure = collectMeasureIds(model)[0] || "measure";
    const id = uniqueId(model, "rule");
    const defaults = {
      progressIfReached: {
        progressIfReached: {
          id,
          varId: variable,
          measureId: measure,
          target: enumDefault("target", "fixed"),
          increment: 2.5,
        },
      },
      always: { always: { id, varId: variable, increment: 2.5 } },
      progressByTable: {
        progressByTable: {
          id,
          varId: variable,
          measureId: measure,
          steps: [
            { atLeast: 5, increment: 2.5 },
            { atLeast: 8, increment: 5 },
          ],
        },
      },
      adjustByBand: {
        adjustByBand: {
          id,
          varId: variable,
          measureId: measure,
          lower: 5,
          upper: 10,
          delta: 2.5,
        },
      },
      stageDemotion: {
        stageDemotion: {
          id,
          stageKey: "stage",
          measureId: measure,
          stageTargets: [5, 3, 1],
          weightVarId: variable,
          resetFactor: 0.9,
          resetThreshold: 2,
        },
      },
    };
    if (!defaults[ruleCase]) throw new Error(`未知の進行ルール: ${ruleCase}`);
    return defaults[ruleCase];
  }

  function switchRule(model, path, ruleCase) {
    return setValue(model, path, ruleDefault(ruleCase, model));
  }

  function collectMeasureIds(model) {
    const ids = [];
    const seen = new Set();
    for (const phase of model.program?.phases || []) {
      for (const day of phase.days || []) {
        for (const group of day.groups || []) {
          for (const setGroup of group.setGroups || []) {
            for (const target of setGroup.targets || []) {
              if (
                typeof target.measureId === "string" &&
                target.measureId &&
                !seen.has(target.measureId)
              ) {
                seen.add(target.measureId);
                ids.push(target.measureId);
              }
            }
          }
        }
      }
    }
    return ids;
  }

  function minimalTemplate() {
    const envelope = {
      format: "traininglogger.program",
      version: 2,
      program: {
        name: "新しいトレーニングプログラム",
        note: "",
        variables: [
          {
            id: "main_tm",
            label: "メイン種目 TM",
            unit: "kg",
            e1rmFactor: null,
            fallbackValue: 60,
            slotId: "main",
          },
        ],
        slots: [
          {
            id: "main",
            label: "メイン種目",
            exerciseUuid: null,
            exerciseName: null,
            muscleKeys: [],
            conditionText: "",
            activityRequirement: null,
            distinctGroup: null,
          },
        ],
        phases: [],
      },
    };
    const phase = createPhase(envelope);
    phase.id = "phase_1";
    phase.label = "フェーズ 1";
    phase.days[0].id = "day_1";
    phase.days[0].label = "Day 1";
    phase.days[0].pill = "A";
    phase.days[0].groups[0].id = "block_1";
    phase.days[0].groups[0].entries[0].id = "main_entry";
    phase.days[0].groups[0].setGroups[0].id = "main_sets";
    phase.days[0].groups[0].setGroups[0].targets[0].entryId = "main_entry";
    envelope.program.phases.push(phase);
    return envelope;
  }

  function fiveThreeOneTemplate() {
    const envelope = minimalTemplate();
    envelope.program.name = "5/3/1風 4週間";
    envelope.program.note = "3週間の漸増と1週間のデロード。最終セットは限界まで。";
    envelope.program.variables[0].label = "トレーニングマックス";
    const weeks = [
    { label: "Week 1 — 5回", reps: [5, 5, 5], percents: [0.65, 0.75, 0.85], min: 5 },
    { label: "Week 2 — 3回", reps: [3, 3, 3], percents: [0.7, 0.8, 0.9], min: 3 },
    { label: "Week 3 — 5/3/1", reps: [5, 3, 1], percents: [0.75, 0.85, 0.95], min: 1 },
    { label: "Week 4 — デロード", reps: [5, 5, 5], percents: [0.4, 0.5, 0.6], min: null },
    ];
    envelope.program.phases = weeks.map((week, phaseIndex) => {
      const phaseId = `week_${phaseIndex + 1}`;
      const entryId = `main_entry_w${phaseIndex + 1}`;
      const targets = week.reps.map((reps, setIndex) => ({
        id: `set_w${phaseIndex + 1}_${setIndex + 1}`,
        count: { fixed: { _0: 1 } },
        targets: [
          {
            entryId,
            reps:
              setIndex === 2 && week.min != null
                ? { amrap: { min: week.min } }
                : { fixed: { _0: reps } },
            load: {
              percentOfVar: {
                varId: "main_tm",
                percent: week.percents[setIndex],
                annotate: true,
              },
            },
            extras: [],
            measureId: setIndex === 2 && week.min != null ? "main_amrap" : null,
            measureFieldKey: null,
          },
        ],
      }));
      return {
        id: phaseId,
        label: week.label,
        windowDays: 7,
        days: [
          {
            id: `day_w${phaseIndex + 1}`,
            label: "メイン Day",
            pill: `${phaseIndex + 1}/4`,
            groups: [
              {
                id: `block_w${phaseIndex + 1}`,
          entries: [
            {
              id: entryId,
              variants: [
                {
                  id: `${entryId}_v1`,
                  slotId: "main",
                  label: null,
                  methodologyId: { inherit: {} },
                  targetOverrides: [],
                  progressionRules: { inherit: {} },
                },
              ],
              methodologyId: null,
            },
          ],
                setGroups: targets,
              },
            ],
          },
        ],
        endRules:
          phaseIndex === 3
            ? [{ always: { id: "cycle_progress", varId: "main_tm", increment: 2.5 } }]
            : [],
        nextPhaseId: `week_${((phaseIndex + 1) % weeks.length) + 1}`,
      };
    });
    return envelope;
  }

  function template(name) {
    if (name === "minimal") return minimalTemplate();
    if (name === "531") return fiveThreeOneTemplate();
    throw new Error(`未知のテンプレート: ${name}`);
  }

  return {
    addEntry,
    addExtra,
    addSetGroup,
    clone,
    collectMeasureIds,
    createDay,
    createGroup,
    createPhase,
    createSlot,
    createVariable,
    duplicateEntry,
    duplicateStructure,
    enumDefault,
    getAtPath,
    insertItem,
    moveEntry,
    moveItem,
    renameReferences,
    removeEntry,
    removeItem,
    ruleDefault,
    setValue,
    switchEnum,
    switchRule,
    template,
    uniqueId,
  };
});
