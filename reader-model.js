// TrainingLogger 閲覧モードの表示モデル。
// ブラウザでは TrainingLoggerReaderModel、Node では module.exports として公開する。
(function exposeReaderModel(root, factory) {
  "use strict";

  const logic =
    typeof module !== "undefined" && module.exports
      ? require("./logic.js")
      : root;
  const api = factory(logic);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.TrainingLoggerReaderModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createReaderModel(logic) {
  "use strict";

  const {
    countText,
    enumCase,
    enumPayload,
    extraText,
    loadText,
    repsText,
    ruleText,
    sideText,
  } = logic;

  function safeText(callback, fallback) {
    try {
      return callback();
    } catch {
      return fallback;
    }
  }

  function stripHTML(value) {
    return String(value).replace(/<[^>]*>/g, "");
  }

  function slotIdsForEntry(entry) {
    if (Array.isArray(entry?.slotIds)) return entry.slotIds;
    return entry?.slotId ? [entry.slotId] : [];
  }

  function slotDisplayName(slot) {
    return slot?.exerciseName || slot?.label || slot?.id || "種目未設定";
  }

  function entryDisplayName(program, entry) {
    const slots = program?.slots || [];
    const names = slotIdsForEntry(entry).map(id => {
      const slot = slots.find(item => item.id === id);
      return slotDisplayName(slot) || id;
    });
    return names.length ? names.join(" ⇄ ") : entry?.id || "種目未設定";
  }

  function typedQuantity(target) {
    if (!target || typeof target !== "object") return null;
    if (target.exact?._0) return target.exact._0;
    if (target.range?.lower && target.range?.upper) {
      return { range: [target.range.lower, target.range.upper] };
    }
    return null;
  }

  function convertQuantity(quantity, dimension) {
    if (!quantity || quantity.range) return null;
    const value = Number(quantity.value);
    if (!Number.isFinite(value)) return null;
    switch (dimension) {
      case "distance":
        if (quantity.unit === "meters") return value / 1000;
        if (quantity.unit === "miles") return value * 1.609344;
        return value;
      case "duration":
        if (quantity.unit === "seconds") return value / 60;
        if (quantity.unit === "hours") return value * 60;
        return value;
      case "pace":
        if (quantity.unit === "minutesPerKilometer") return value * 60;
        if (quantity.unit === "secondsPerMile") return value / 1.609344;
        return value;
      case "speed":
        if (quantity.unit === "metersPerSecond") return value * 3.6;
        return value;
      default:
        return value;
    }
  }

  function clockText(seconds) {
    const rounded = Math.max(0, Math.round(seconds));
    return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
  }

  function activityPrescriptionText(activity) {
    if (!activity || typeof activity !== "object") return "";
    const kind = Object.keys(activity)[0];
    const value = activity[kind]?._0;
    if (!value) return "";
    const parts = [];
    if (kind === "running" && value.workoutLabel) parts.push(value.workoutLabel);
    const distance = convertQuantity(typedQuantity(value.distance), "distance");
    const duration = convertQuantity(typedQuantity(value.duration), "duration");
    if (distance != null) parts.push(`${Number(distance.toFixed(2))}km`);
    if (duration != null) parts.push(`${Number(duration.toFixed(1))}分`);
    if (kind === "running") {
      const paceTarget = value.pace?.absolute?._0;
      const pace = convertQuantity(typedQuantity(paceTarget), "pace");
      if (pace != null) parts.push(`${clockText(pace)}/km`);
    } else if (kind === "cycling") {
      const speed = convertQuantity(typedQuantity(value.speed), "speed");
      if (speed != null) parts.push(`${Number(speed.toFixed(1))}km/h`);
    }
    const rpe = convertQuantity(typedQuantity(value.targetRPE), "effort");
    if (rpe != null) parts.push(`RPE ${rpe}`);
    return parts.join(" · ");
  }

  function formatPrescription(program, group, setGroup, target) {
    const entry = (group?.entries || []).find(item => item.id === target?.entryId);
    const exercise = `${entryDisplayName(program, entry)}${sideText(target?.side)}`;
    const count = safeText(() => countText(setGroup?.count), "?セット");
    const typed = activityPrescriptionText(target?.activityPrescription);
    if (typed) {
      const html = `${exercise} — ${count} × ${typed}`;
      return {
        exercise,
        count,
        reps: typed,
        load: "",
        extras: "",
        note: "",
        measured: false,
        measureId: null,
        html,
        text: stripHTML(html),
      };
    }
    const reps = safeText(() => repsText(target?.reps), "?回");
    const load =
      target?.load == null
        ? ""
        : safeText(
            () => loadText(target.load, program?.variables || []),
            "?",
          );
    const extras = (target?.extras || []).map(extraText).join(" · ");
    const note = typeof target?.note === "string" ? target.note.trim() : "";
    const measured = Boolean(target?.measureId);
    const html = `${exercise} — ${count} × ${reps}${load ? ` @ ${load}` : ""}${
      extras ? ` 〔${extras}〕` : ""
    }${measured ? "〔実測〕" : ""}${note ? ` ✎ ${note}` : ""}`;
    return {
      exercise,
      count,
      reps,
      load,
      extras,
      note,
      measured,
      measureId: target?.measureId || null,
      html,
      text: stripHTML(html),
    };
  }

  function countEstimate(count) {
    const countCase = enumCase(count);
    const payload = enumPayload(count) || {};
    if (countCase === "fixed") return Number(payload._0) || 0;
    if (countCase === "byStage" && Array.isArray(payload.values) && payload.values.length) {
      return payload.values.reduce((sum, value) => sum + (Number(value) || 0), 0)
        / payload.values.length;
    }
    return 0;
  }

  function rounded(value) {
    return Number(value.toFixed(1));
  }

  function collectStatistics(program) {
    const phases = program?.phases || [];
    const totalDays = phases.reduce((sum, phase) => sum + (phase.days || []).length, 0);
    const cycleDays = phases.reduce((sum, phase) => {
      const days = Number(phase.windowDays);
      return sum + (Number.isFinite(days) && days > 0 ? days : 0);
    }, 0);
    let estimatedSets = 0;
    for (const phase of phases) {
      for (const day of phase.days || []) {
        for (const group of day.groups || []) {
          for (const setGroup of group.setGroups || []) {
            estimatedSets +=
              countEstimate(setGroup.count) * (setGroup.targets || []).length;
          }
        }
      }
    }
    return {
      phaseCount: phases.length,
      weeklyDays: rounded(cycleDays ? (totalDays * 7) / cycleDays : totalDays),
      exerciseCount: (program?.slots || []).length,
      estimatedSets: rounded(estimatedSets),
      cycleDays,
    };
  }

  function summarizeResources(program) {
    const slots = (program?.slots || []).map(slot => ({
      id: slot.id,
      label: slot.label || slot.id || "種目枠",
      exerciseName: slot.exerciseName || "採用時に選択",
      muscles: (slot.muscleKeys || []).length
        ? slot.muscleKeys.join("・")
        : "筋肉指定なし",
      conditionText: slot.conditionText || "",
    }));
    const variables = (program?.variables || []).map(variable => {
      const slot = (program?.slots || []).find(item => item.id === variable.slotId);
      const unit = variable.unit || "";
      const factor = variable.e1rmFactor;
      return {
        id: variable.id,
        label: variable.label || variable.id || "基準重量",
        initialValue:
          variable.fallbackValue == null
            ? "未設定"
            : `${variable.fallbackValue}${unit}`,
        source:
          factor == null
            ? "手入力の初期値"
            : `${slotDisplayName(slot)}の e1RM × ${factor}`,
      };
    });
    return { slots, variables };
  }

  function collectMeasureReferences(program) {
    const references = {};
    for (const [phaseIndex, phase] of (program?.phases || []).entries()) {
      for (const [dayIndex, day] of (phase.days || []).entries()) {
        for (const [groupIndex, group] of (day.groups || []).entries()) {
          for (const [setGroupIndex, setGroup] of (group.setGroups || []).entries()) {
            for (const [targetIndex, target] of (setGroup.targets || []).entries()) {
              if (!target.measureId) continue;
              const prescription = formatPrescription(program, group, setGroup, target);
              const reference = {
                id: target.measureId,
                phaseIndex,
                dayIndex,
                groupIndex,
                setGroupIndex,
                targetIndex,
                description:
                  `「${phase.label || phase.id || `フェーズ ${phaseIndex + 1}`}」の` +
                  `「${day.label || day.id || `Day ${dayIndex + 1}`}」、` +
                  `ブロック${groupIndex + 1}・セット${setGroupIndex + 1}` +
                  `（${prescription.exercise}／${prescription.count} × ${prescription.reps}）`,
              };
              if (references[target.measureId]) {
                references[target.measureId].occurrences.push(reference);
              } else {
                references[target.measureId] = {
                  ...reference,
                  occurrences: [reference],
                };
              }
            }
          }
        }
      }
    }
    return references;
  }

  function formatReaderRule(rule, variables, measureReferences, phaseIndex = null) {
    const payload = enumPayload(rule) || {};
    const measureId = payload.measureId || null;
    const firstReference = measureId ? measureReferences[measureId] : null;
    const reference =
      firstReference?.occurrences?.find(item => item.phaseIndex === phaseIndex)
      || firstReference;
    const base = safeText(() => ruleText(rule, variables || []), "?");
    return {
      html: /[。！？]$/.test(stripHTML(base)) ? base : `${base}。`,
      measureId,
      measureReference: measureId
        ? reference
          ? `判定に使う実測: ${reference.description}`
          : `判定に使う実測: ${measureId}（参照先が見つかりません）`
        : null,
      missingReference: Boolean(measureId && !reference),
    };
  }

  function phaseFlow(program) {
    const phases = program?.phases || [];
    if (phases.length < 2) return [];
    const byId = new Map(phases.map(phase => [phase.id, phase]));
    const flow = [];
    const visited = new Set();
    let current = phases[0];
    while (current && !visited.has(current.id) && flow.length < phases.length) {
      visited.add(current.id);
      flow.push({
        id: current.id,
        label: current.label || current.id || `フェーズ ${flow.length + 1}`,
        repeated: false,
      });
      const index = phases.indexOf(current);
      current = current.nextPhaseId
        ? byId.get(current.nextPhaseId)
        : phases[(index + 1) % phases.length];
    }
    if (current) {
      flow.push({
        id: current.id,
        label: current.label || current.id || "先頭フェーズ",
        repeated: true,
      });
    }
    return flow;
  }

  function buildReaderModel(program) {
    const measureReferences = collectMeasureReferences(program);
    return {
      name: program?.name || "名称未設定",
      note: program?.note || "",
      stats: collectStatistics(program),
      resources: summarizeResources(program),
      flow: phaseFlow(program),
      phases: (program?.phases || []).map((phase, phaseIndex) => ({
        id: phase.id,
        label: phase.label || phase.id || `フェーズ ${phaseIndex + 1}`,
        windowDays: phase.windowDays,
        days: (phase.days || []).map((day, dayIndex) => ({
          id: day.id,
          label: day.label || day.id || `Day ${dayIndex + 1}`,
          pill: day.pill || "",
          groups: (day.groups || []).map((group, groupIndex) => ({
            id: group.id,
            number: groupIndex + 1,
            isSuperset: (group.entries || []).length > 1,
            setGroups: (group.setGroups || []).map((setGroup, setGroupIndex) => ({
              id: setGroup.id,
              number: setGroupIndex + 1,
              prescriptions: (setGroup.targets || []).map(target =>
                formatPrescription(program, group, setGroup, target),
              ),
            })),
          })),
        })),
        rules: (phase.endRules || []).map(rule =>
          formatReaderRule(
            rule,
            program?.variables || [],
            measureReferences,
            phaseIndex,
          ),
        ),
      })),
      measureReferences,
    };
  }

  return {
    buildReaderModel,
    collectMeasureReferences,
    collectStatistics,
    entryDisplayName,
    formatPrescription,
    formatReaderRule,
    phaseFlow,
    summarizeResources,
  };
});
