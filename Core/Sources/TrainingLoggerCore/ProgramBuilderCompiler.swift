import Foundation

// BuilderDef → ProgramHSMDef のコンパイラ(ADR-0031)。
// 生成する式はプリセット5本のイディオムと同形にする:
// 重量 = round(基準 × % × 2) / 2、ステージ表 = 入れ子 if、
// 遷移 guard は無条件(e("1"))で分岐は actions の if に寄せる。
// 受け入れ条件はプリセット5本の同等 emit(V4RegressionTests)。

public enum ProgramBuilderCompiler {

    public struct Output {
        public var hsm: ProgramHSMDef
        public var issues: [BuilderIssue]

        public init(hsm: ProgramHSMDef, issues: [BuilderIssue]) {
            self.hsm = hsm
            self.issues = issues
        }
    }

    /// ローテーション展開の周期上限。現実の交互は2〜3種(2×3混在=6)で、それ以上は誤操作
    public static let maxRotationPeriod = 12

    public static func compile(_ def: BuilderDef) -> Output {
        var issues: [BuilderIssue] = []
        validate(def, into: &issues)

        // 種目ローテーション(ADR-0032): 全ローテ長の LCM 周期でフェーズ列を展開し、
        // k 周目のコピーでは各エントリが slotIds[k % len] を使う。エンジンは無変更
        let period = rotationPeriod(def)
        if period > maxRotationPeriod {
            issues.append(.rotationTooLong(period: period))
        }
        let expanded = (period > 1 && period <= maxRotationPeriod)
            ? expandRotations(def, period: period)
            : def

        let inputs = expanded.variables.map { variable in
            ProgramInputDef(key: variable.id, label: variable.label, unit: variable.unit,
                            defaultFromE1RMFactor: variable.e1rmFactor,
                            fallbackValue: variable.fallbackValue,
                            slotId: variable.slotId)
        }
        // プリセットと同じく変数は恒等 init、ステージカウンタは 0 始まり
        var initActions = expanded.variables.map { VarAssign(name: $0.id, expr: e($0.id)) }
        initActions += collectStageKeys(expanded).sorted().map {
            VarAssign(name: $0, expr: e("0"))
        }

        let leaves = expanded.phases.enumerated().map { index, phase in
            compileLeaf(phase,
                        nextId: nextPhaseId(at: index, def: expanded),
                        issues: &issues)
        }
        let root: PhaseDef
        if leaves.count == 1, let only = leaves.first {
            root = .leaf(only)
        } else {
            root = .composite(CompositePhaseDef(
                id: "main",
                children: leaves.map { .leaf($0) },
                initial: leaves.first?.id ?? "",
                transitions: []))
        }
        // 展開でコピーごとに重複した issue(superset 制約等)は1つに畳む
        let deduped = issues.reduce(into: [BuilderIssue]()) { result, issue in
            if !result.contains(issue) { result.append(issue) }
        }
        return Output(hsm: ProgramHSMDef(
            inputs: inputs,
            initActions: initActions,
            root: root,
            previewBindings: compilePreviewBindings(expanded)),
                      issues: deduped)
    }

    // MARK: - ローテーション展開(ADR-0032)

    private static func rotationPeriod(_ def: BuilderDef) -> Int {
        var period = 1
        forEachEntry(def) { entry in
            period = lcm(period, max(entry.slotIds.count, 1))
        }
        return period
    }

    /// BuilderDef → 展開済み BuilderDef の純変換。leaf id は "{id}@k"。
    /// 明示 nextPhaseId は同一コピー内へ remap するが、後方参照(ループの巻き戻し)は
    /// 次コピーの該当フェーズへ向ける — でないとローテーションが一生進まない
    private static func expandRotations(_ def: BuilderDef, period: Int) -> BuilderDef {
        let indexById = Dictionary(uniqueKeysWithValues:
            def.phases.enumerated().map { ($0.element.id, $0.offset) })
        var out = def
        var variableClones: [String: BuilderVariable] = [:]
        var namespacedVariableIds = Set<String>()
        out.phases = (0..<period).flatMap { k -> [BuilderPhase] in
            def.phases.enumerated().map { phaseIndex, phase in
                var copy = phase
                copy.id = "\(phase.id)@\(k)"
                if let next = phase.nextPhaseId, let nextIndex = indexById[next] {
                    let wrapsBack = nextIndex <= phaseIndex
                    let targetCopy = wrapsBack ? (k + 1) % period : k
                    copy.nextPhaseId = "\(next)@\(targetCopy)"
                }
                copy.days = phase.days.map { day in
                var day = day
                day.groups = day.groups.map { group in
                    var group = group
                    let selectedVariants = group.entries.reduce(
                        into: [String: BuilderEntryVariant]()
                    ) { result, entry in
                        guard !entry.variants.isEmpty else { return }
                        result[entry.id] = entry.variants[k % entry.variants.count]
                    }
                    group.entries = group.entries.map { entry in
                        var entry = entry
                        if let variant = selectedVariants[entry.id] {
                            entry.methodologyId = entry.methodologyId(for: variant)
                            entry.variants = [variant]
                        }
                        return entry
                    }
                    group.setGroups = group.setGroups.map { setGroup in
                        var setGroup = setGroup
                        setGroup.targets = setGroup.targets.map { target in
                            guard let variant = selectedVariants[target.entryId],
                                  let override = variant.targetOverride(
                                    setGroupId: setGroup.id
                                  ) else { return target }
                            return override.resolve(target)
                        }
                        return setGroup
                    }
                    return group
                }
                    return day
                }
                namespaceVariantProgression(
                    original: phase,
                    expanded: &copy,
                    rotationIndex: k,
                    variables: def.variables,
                    variableClones: &variableClones,
                    namespacedVariableIds: &namespacedVariableIds)
                return copy
            }
        }
        out.variables.append(contentsOf: variableClones.values.sorted { $0.id < $1.id })
        let referencedVariables = referencedVariableIds(in: out)
        out.variables.removeAll {
            namespacedVariableIds.contains($0.id)
                && !referencedVariables.contains($0.id)
        }
        return out
    }

    /// variantのbind・進行変数・stageを名前空間化する。ローテーション順は未実施でも進むが、
    /// 選ばれていないvariantのactionsはそのleafに存在しないため状態は据え置かれる。
    private static func namespaceVariantProgression(
        original: BuilderPhase,
        expanded: inout BuilderPhase,
        rotationIndex: Int,
        variables: [BuilderVariable],
        variableClones: inout [String: BuilderVariable],
        namespacedVariableIds: inout Set<String>
    ) {
        var replacedCommonRuleIds = Set<String>()
        var variantRules: [BuilderRule] = []
        var variantRuleIds = Set<String>()

        for dayIndex in original.days.indices {
            for groupIndex in original.days[dayIndex].groups.indices {
                let originalGroup = original.days[dayIndex].groups[groupIndex]
                for entry in originalGroup.entries where entry.variants.count > 1 {
                    let variant = entry.variants[rotationIndex % entry.variants.count]
                    let suffix = stateSuffix(entryId: entry.id, variantId: variant.id)

                    var baseTargets: [(setGroupIndex: Int, targetIndex: Int,
                                      base: BuilderTargetLine,
                                      resolved: BuilderTargetLine)] = []
                    for setGroupIndex in originalGroup.setGroups.indices {
                        let setGroup = originalGroup.setGroups[setGroupIndex]
                        for targetIndex in setGroup.targets.indices
                        where setGroup.targets[targetIndex].entryId == entry.id {
                            let base = setGroup.targets[targetIndex]
                            let resolved = variant.targetOverride(setGroupId: setGroup.id)?
                                .resolve(base) ?? base
                            baseTargets.append((setGroupIndex, targetIndex, base, resolved))
                        }
                    }

                    let baseMeasureIds = Set(baseTargets.compactMap(\.base.measureId))
                    let commonRules = original.endRules.filter {
                        if let measureId = ruleMeasureId($0) {
                            return baseMeasureIds.contains(measureId)
                        }
                        let baseVariableIds = Set(baseTargets.compactMap {
                            loadVariableId($0.base.load)
                        })
                        return !ruleVariableIds($0).isDisjoint(with: baseVariableIds)
                    }
                    replacedCommonRuleIds.formUnion(commonRules.map(\.id))
                    let availableBaseMeasureIds = Set(baseTargets.compactMap {
                        $0.resolved.measureId == nil ? nil : $0.base.measureId
                    })

                    let selectedRules: [BuilderRule]
                    switch variant.progressionRules {
                    case .inherit:
                        selectedRules = commonRules.filter {
                            ruleMeasureId($0).map(availableBaseMeasureIds.contains) ?? false
                        }
                    case .value(let rules):
                        selectedRules = rules
                    case .none:
                        selectedRules = []
                    }

                    var measureMap: [String: String] = [:]
                    for target in baseTargets {
                        guard let resolvedMeasure = target.resolved.measureId else { continue }
                        let namespaced = stateKey(resolvedMeasure, suffix: suffix)
                        if let baseMeasure = target.base.measureId {
                            measureMap[baseMeasure] = namespaced
                        }
                        measureMap[resolvedMeasure] = namespaced
                    }
                    for rule in selectedRules {
                        if let measureId = ruleMeasureId(rule), measureMap[measureId] == nil {
                            measureMap[measureId] = stateKey(measureId, suffix: suffix)
                        }
                    }

                    var variableMap: [String: String] = [:]
                    var variableSources: [String: String] = [:]
                    for target in baseTargets {
                        guard let resolvedVariable = loadVariableId(target.resolved.load)
                        else { continue }
                        let namespaced = stateKey(resolvedVariable, suffix: suffix)
                        if let baseVariable = loadVariableId(target.base.load) {
                            variableMap[baseVariable] = namespaced
                        }
                        variableMap[resolvedVariable] = namespaced
                        variableSources[namespaced] = resolvedVariable
                    }
                    var stageMap: [String: String] = [:]
                    for target in baseTargets {
                        guard let resolvedStage = repsStageKey(target.resolved.reps)
                        else { continue }
                        let namespaced = stateKey(resolvedStage, suffix: suffix)
                        if let baseStage = repsStageKey(target.base.reps) {
                            stageMap[baseStage] = namespaced
                        }
                        stageMap[resolvedStage] = namespaced
                    }
                    for rule in selectedRules {
                        for variableId in ruleVariableIds(rule) {
                            if variableMap[variableId] == nil {
                                let namespaced = stateKey(variableId, suffix: suffix)
                                variableMap[variableId] = namespaced
                                variableSources[namespaced] = variableId
                            }
                        }
                        for stageKey in ruleStageKeys(rule) {
                            if stageMap[stageKey] == nil {
                                stageMap[stageKey] = stateKey(stageKey, suffix: suffix)
                            }
                        }
                    }

                    for (namespacedId, sourceId) in variableSources {
                        guard variableClones[namespacedId] == nil,
                              var clone = variables.first(where: { $0.id == sourceId })
                        else { continue }
                        clone.id = namespacedId
                        clone.label = "\(clone.label)（\(variant.label ?? variant.slotId)）"
                        clone.slotId = variant.slotId
                        variableClones[namespacedId] = clone
                        namespacedVariableIds.insert(sourceId)
                    }
                    namespacedVariableIds.formUnion(
                        variableMap.keys.filter { variableId in
                            variables.contains { $0.id == variableId }
                        })

                    for targetLocation in baseTargets {
                        var target = expanded.days[dayIndex]
                            .groups[groupIndex]
                            .setGroups[targetLocation.setGroupIndex]
                            .targets[targetLocation.targetIndex]
                        if let measureId = target.measureId {
                            target.measureId = measureMap[measureId]
                                ?? stateKey(measureId, suffix: suffix)
                        }
                        target.load = remap(target.load, variables: variableMap)
                        target.reps = remap(target.reps, stages: stageMap)
                        expanded.days[dayIndex]
                            .groups[groupIndex]
                            .setGroups[targetLocation.setGroupIndex]
                            .targets[targetLocation.targetIndex] = target

                        if !stageMap.isEmpty {
                            let count = expanded.days[dayIndex]
                                .groups[groupIndex]
                                .setGroups[targetLocation.setGroupIndex]
                                .count
                            expanded.days[dayIndex]
                                .groups[groupIndex]
                                .setGroups[targetLocation.setGroupIndex]
                                .count = remap(count, stages: stageMap)
                        }
                    }

                    for rule in selectedRules {
                        let namespacedRule = remap(
                            rule,
                            suffix: suffix,
                            measures: measureMap,
                            variables: variableMap,
                            stages: stageMap)
                        if variantRuleIds.insert(namespacedRule.id).inserted {
                            variantRules.append(namespacedRule)
                        }
                    }
                }
            }
        }

        expanded.endRules.removeAll { replacedCommonRuleIds.contains($0.id) }
        expanded.endRules.append(contentsOf: variantRules)
    }

    private static func stateSuffix(entryId: String, variantId: String) -> String {
        "\(entryId)_\(variantId)".map {
            $0.isLetter || $0.isNumber || $0 == "_" ? $0 : "_"
        }.reduce(into: "") { $0.append($1) }
    }

    private static func stateKey(_ source: String, suffix: String) -> String {
        "\(source)__\(suffix)"
    }

    private static func loadVariableId(_ load: BuilderLoad?) -> String? {
        switch load {
        case .percentOfVar(let varId, _, _), .variable(let varId):
            return varId
        case .fixed, .none:
            return nil
        }
    }

    private static func repsStageKey(_ reps: BuilderReps) -> String? {
        switch reps {
        case .byStage(let stageKey, _), .amrapByStage(let stageKey, _):
            return stageKey
        case .fixed, .amrap, .range:
            return nil
        }
    }

    private static func ruleMeasureId(_ rule: BuilderRule) -> String? {
        switch rule {
        case .progressIfReached(_, _, let measureId, _, _),
             .progressByTable(_, _, let measureId, _),
             .adjustByBand(_, _, let measureId, _, _, _),
             .stageDemotion(_, _, let measureId, _, _, _, _):
            return measureId
        case .always:
            return nil
        }
    }

    private static func ruleVariableIds(_ rule: BuilderRule) -> Set<String> {
        switch rule {
        case .progressIfReached(_, let varId, _, _, _),
             .progressByTable(_, let varId, _, _),
             .adjustByBand(_, let varId, _, _, _, _),
             .always(_, let varId, _):
            return [varId]
        case .stageDemotion(_, _, _, _, let weightVarId, _, _):
            return [weightVarId]
        }
    }

    private static func ruleStageKeys(_ rule: BuilderRule) -> Set<String> {
        switch rule {
        case .progressIfReached(_, _, _, .stageReps(let stageKey, _), _):
            return [stageKey]
        case .stageDemotion(_, let stageKey, _, _, _, _, _):
            return [stageKey]
        default:
            return []
        }
    }

    private static func remap(
        _ rule: BuilderRule,
        suffix: String,
        measures: [String: String],
        variables: [String: String],
        stages: [String: String]
    ) -> BuilderRule {
        let id = stateKey(rule.id, suffix: suffix)
        switch rule {
        case .progressIfReached(_, let varId, let measureId, let target, let increment):
            return .progressIfReached(
                id: id,
                varId: variables[varId] ?? varId,
                measureId: measures[measureId] ?? measureId,
                target: remap(target, stages: stages),
                increment: increment)
        case .progressByTable(_, let varId, let measureId, let steps):
            return .progressByTable(
                id: id,
                varId: variables[varId] ?? varId,
                measureId: measures[measureId] ?? measureId,
                steps: steps)
        case .adjustByBand(
            _, let varId, let measureId, let lower, let upper, let delta
        ):
            return .adjustByBand(
                id: id,
                varId: variables[varId] ?? varId,
                measureId: measures[measureId] ?? measureId,
                lower: lower,
                upper: upper,
                delta: delta)
        case .stageDemotion(
            _, let stageKey, let measureId, let stageTargets,
            let weightVarId, let resetFactor, let resetThreshold
        ):
            return .stageDemotion(
                id: id,
                stageKey: stages[stageKey] ?? stageKey,
                measureId: measures[measureId] ?? measureId,
                stageTargets: stageTargets,
                weightVarId: variables[weightVarId] ?? weightVarId,
                resetFactor: resetFactor,
                resetThreshold: resetThreshold)
        case .always(_, let varId, let increment):
            return .always(
                id: id,
                varId: variables[varId] ?? varId,
                increment: increment)
        }
    }

    private static func remap(
        _ target: BuilderTarget,
        stages: [String: String]
    ) -> BuilderTarget {
        switch target {
        case .fixed:
            return target
        case .stageReps(let stageKey, let values):
            return .stageReps(
                stageKey: stages[stageKey] ?? stageKey,
                values: values)
        }
    }

    private static func remap(
        _ load: BuilderLoad?,
        variables: [String: String]
    ) -> BuilderLoad? {
        guard let load else { return nil }
        switch load {
        case .fixed:
            return load
        case .percentOfVar(let varId, let percent, let annotate):
            return .percentOfVar(
                varId: variables[varId] ?? varId,
                percent: percent,
                annotate: annotate)
        case .variable(let varId):
            return .variable(varId: variables[varId] ?? varId)
        }
    }

    private static func remap(
        _ reps: BuilderReps,
        stages: [String: String]
    ) -> BuilderReps {
        switch reps {
        case .fixed, .amrap, .range:
            return reps
        case .byStage(let stageKey, let values):
            return .byStage(stageKey: stages[stageKey] ?? stageKey, values: values)
        case .amrapByStage(let stageKey, let values):
            return .amrapByStage(stageKey: stages[stageKey] ?? stageKey, values: values)
        }
    }

    private static func remap(
        _ count: BuilderCount,
        stages: [String: String]
    ) -> BuilderCount {
        switch count {
        case .fixed:
            return count
        case .byStage(let stageKey, let values):
            return .byStage(stageKey: stages[stageKey] ?? stageKey, values: values)
        }
    }

    private static func referencedVariableIds(in def: BuilderDef) -> Set<String> {
        var result = Set<String>()
        for phase in def.phases {
            for rule in phase.endRules {
                result.formUnion(ruleVariableIds(rule))
            }
            for day in phase.days {
                for group in day.groups {
                    for setGroup in group.setGroups {
                        for target in setGroup.targets {
                            switch target.load {
                            case .percentOfVar(let varId, _, _), .variable(let varId):
                                result.insert(varId)
                            default:
                                break
                            }
                        }
                    }
                }
            }
        }
        return result
    }

    private static func forEachEntry(_ def: BuilderDef, _ body: (BuilderEntry) -> Void) {
        for phase in def.phases {
            for day in phase.days {
                for group in day.groups {
                    for entry in group.entries {
                        body(entry)
                    }
                }
            }
        }
    }

    private static func lcm(_ a: Int, _ b: Int) -> Int {
        a / gcd(a, b) * b
    }

    private static func gcd(_ a: Int, _ b: Int) -> Int {
        var (a, b) = (a, b)
        while b != 0 { (a, b) = (b, a % b) }
        return a
    }

    // MARK: - フェーズ

    private static func nextPhaseId(at index: Int, def: BuilderDef) -> String {
        let phase = def.phases[index]
        if let next = phase.nextPhaseId { return next }
        let nextIndex = (index + 1) % max(def.phases.count, 1)
        return def.phases[nextIndex].id
    }

    private static func compileLeaf(_ phase: BuilderPhase,
                                    nextId: String,
                                    issues: inout [BuilderIssue]) -> LeafPhaseDef {
        LeafPhaseDef(
            id: phase.id,
            windowDays: phase.windowDays,
            days: phase.days.map { day in
                DayTemplateDef(label: day.label,
                               dayPill: day.pill,
                               blocks: day.groups.compactMap { compileGroup($0, issues: &issues) })
            },
            transitions: [TransitionDef(guardExpr: e("1"),
                                        target: nextId,
                                        actions: phase.endRules.flatMap(compileRule))])
    }

    // MARK: - ブロック(グループ)

    private static func compileGroup(_ group: BuilderGroup,
                                     issues: inout [BuilderIssue]) -> BlockPlanTpl? {
        guard !group.entries.isEmpty else { return nil }
        return BlockPlanTpl(sets: group.setGroups.flatMap { compileSetGroup($0, group: group) })
    }

    // MARK: - セット群(組全体の周、ADR-0033)

    /// 周のまとまり → SetPlanTpl 列。records = entries 順の targets 写像。
    /// いずれかの target に実測があれば最終周を分離し、該当 target にだけ bind を付ける
    /// (GZCLP の base/top 分割の一般化。単種目では従来と同一の出力)
    private static func compileSetGroup(_ setGroup: BuilderSetGroup,
                                        group: BuilderGroup) -> [SetPlanTpl] {
        // entries 順に並べた (メンバー, 目標) の組。対応の壊れは validate が拾う
        let pairs = group.entries.compactMap { entry -> (BuilderEntry, BuilderTargetLine)? in
            setGroup.targets.first { $0.entryId == entry.id }.map { (entry, $0) }
        }
        guard !pairs.isEmpty else { return [] }

        let hasMeasure = pairs.contains { $0.1.measureId != nil }
        // base 周: 実測付き target の「限界まで」は最終周だけ。base は exact に降格
        let baseRecords = pairs.map { entry, target in
            record(for: target, entry: entry, bind: nil, demoteAmrap: target.measureId != nil)
        }
        guard hasMeasure else {
            switch setGroup.count {
            case .fixed(let n) where n <= 1:
                return [SetPlanTpl(records: baseRecords)]
            case .fixed(let n):
                return [SetPlanTpl(records: baseRecords, repeatExpr: e("\(n)"))]
            case .byStage(let key, let values):
                return [SetPlanTpl(records: baseRecords,
                                   repeatExpr: e(stageTable(key, values.map(Double.init))))]
            }
        }
        // 実測あり: 最終周を分離(base ×(n−1) + top ×1)
        let top = SetPlanTpl(records: pairs.map { entry, target in
            record(for: target, entry: entry, bind: target.measureId)
        })
        let base = SetPlanTpl(records: baseRecords)
        switch setGroup.count {
        case .fixed(let n) where n <= 1:
            return [top]
        case .fixed(let n) where n == 2:
            return [base, top]
        case .fixed(let n):
            return [SetPlanTpl(records: baseRecords, repeatExpr: e("\(n - 1)")), top]
        case .byStage(let key, let values):
            let baseCounts = values.map { Double(max($0 - 1, 0)) }
            return [SetPlanTpl(records: baseRecords, repeatExpr: e(stageTable(key, baseCounts))), top]
        }
    }

    private static func normalizedNote(_ note: String?) -> String? {
        let trimmed = note?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (trimmed?.isEmpty ?? true) ? nil : trimmed
    }

    private static func record(for target: BuilderTargetLine,
                               entry: BuilderEntry,
                               bind: String?,
                               demoteAmrap: Bool = false) -> RecordPlanTpl {
        var reps = target.reps
        if demoteAmrap {
            switch reps {
            case .amrap(let min): reps = .fixed(min)
            case .amrapByStage(let key, let values): reps = .byStage(stageKey: key, values: values)
            default: break
            }
        }
        var scheme: [SchemeTpl] = [repsScheme(reps)]
        if let load = target.load {
            scheme.append(loadScheme(load))
        }
        for extra in target.extras {
            switch extra.kind {
            case .exact(let value):
                scheme.append(SchemeTpl(fieldKey: extra.fieldKey, kind: .exact,
                                        expr: e(num(value)), upperExpr: nil, percentExpr: nil))
            case .range(let lo, let hi):
                scheme.append(SchemeTpl(fieldKey: extra.fieldKey, kind: .range,
                                        expr: e(num(lo)), upperExpr: e(num(hi)), percentExpr: nil))
            }
        }
        return RecordPlanTpl(slotId: entry.slotId, side: target.side, scheme: scheme,
                             bind: bind,
                             bindFieldKey: bind != nil ? target.measureFieldKey : nil,
                             methodologyId: entry.methodologyId,
                             noteText: normalizedNote(target.note),
                             activityPrescription: target.activityPrescription)
    }

    private static func repsScheme(_ reps: BuilderReps) -> SchemeTpl {
        switch reps {
        case .fixed(let n):
            return SchemeTpl(fieldKey: "core.reps", kind: .exact, expr: e("\(n)"),
                             upperExpr: nil, percentExpr: nil)
        case .amrap(let min):
            return SchemeTpl(fieldKey: "core.reps", kind: .floor, expr: e("\(min)"),
                             upperExpr: nil, percentExpr: nil)
        case .range(let lo, let hi):
            return SchemeTpl(fieldKey: "core.reps", kind: .range, expr: e("\(lo)"),
                             upperExpr: e("\(hi)"), percentExpr: nil)
        case .byStage(let key, let values):
            return SchemeTpl(fieldKey: "core.reps", kind: .exact,
                             expr: e(stageTable(key, values.map(Double.init))),
                             upperExpr: nil, percentExpr: nil)
        case .amrapByStage(let key, let values):
            return SchemeTpl(fieldKey: "core.reps", kind: .floor,
                             expr: e(stageTable(key, values.map(Double.init))),
                             upperExpr: nil, percentExpr: nil)
        }
    }

    private static func loadScheme(_ load: BuilderLoad) -> SchemeTpl {
        switch load {
        case .fixed(let kg):
            return SchemeTpl(fieldKey: "core.weight", kind: .exact, expr: e(num(kg)),
                             upperExpr: nil, percentExpr: nil)
        case .percentOfVar(let varId, let percent, let annotate):
            return SchemeTpl(fieldKey: "core.weight", kind: .exact,
                             expr: e("round(\(varId) * \(num(percent)) * 2) / 2"),
                             upperExpr: nil,
                             percentExpr: annotate ? e(num(percent)) : nil)
        case .variable(let varId):
            return SchemeTpl(fieldKey: "core.weight", kind: .exact,
                             expr: e("round(\(varId) * 2) / 2"),
                             upperExpr: nil, percentExpr: nil)
        }
    }

    // MARK: - 進行ルール → actions

    private static func compileRule(_ rule: BuilderRule) -> [VarAssign] {
        switch rule {
        case .progressIfReached(_, let varId, let measureId, let target, let increment):
            let targetExpr: String
            switch target {
            case .fixed(let value): targetExpr = num(value)
            case .stageReps(let key, let values): targetExpr = stageTable(key, values)
            }
            return [VarAssign(name: varId,
                              expr: e("\(varId) + if(\(measureId) >= \(targetExpr), \(num(increment)), 0)"))]

        case .progressByTable(_, let varId, let measureId, let steps):
            let sorted = steps.sorted { $0.atLeast > $1.atLeast }
            var expr = "0"
            for step in sorted.reversed() {
                expr = "if(\(measureId) >= \(num(step.atLeast)), \(num(step.increment)), \(expr))"
            }
            return [VarAssign(name: varId, expr: e("\(varId) + \(expr)"))]

        case .adjustByBand(_, let varId, let measureId, let lower, let upper, let delta):
            return [VarAssign(name: varId, expr: e(
                "\(varId) + if(\(measureId) > \(num(upper)), \(num(delta)), " +
                "if(\(measureId) < \(num(lower)) && \(measureId) > 0, -\(num(delta)), 0))"))]

        case .stageDemotion(_, let stageKey, let measureId, let stageTargets,
                            let weightVarId, let resetFactor, let resetThreshold):
            let maxStage = max(stageTargets.count - 1, 0)
            let targetExpr = stageTable(stageKey, stageTargets)
            return [
                // 順序が意味を持つ: 重量リセットの判定はステージ更新より先(GZCLP と同形)
                VarAssign(name: weightVarId, expr: e(
                    "if(\(stageKey) == \(maxStage) && \(measureId) < \(num(resetThreshold)), " +
                    "round(\(weightVarId) * \(num(resetFactor)) * 2) / 2, \(weightVarId))")),
                VarAssign(name: stageKey, expr: e(
                    "if(\(measureId) < \(targetExpr), " +
                    "if(\(stageKey) == \(maxStage), 0, \(stageKey) + 1), \(stageKey))")),
            ]

        case .always(_, let varId, let increment):
            return [VarAssign(name: varId, expr: e("\(varId) + \(num(increment))"))]
        }
    }

    private static func compilePreviewBindings(
        _ def: BuilderDef
    ) -> [ProgramPreviewBindingDef] {
        let variableLabels = Dictionary(
            def.variables.map { ($0.id, $0.label) },
            uniquingKeysWith: { first, _ in first })
        var result: [ProgramPreviewBindingDef] = []

        for phase in def.phases {
            for rule in phase.endRules {
                let binding: ProgramPreviewBindingDef?
                switch rule {
                case .progressIfReached(
                    let id, let varId, let measureId, let target, _
                ):
                    let targetSource: String
                    switch target {
                    case .fixed(let value):
                        targetSource = num(value)
                    case .stageReps(let stageKey, let values):
                        targetSource = stageTable(stageKey, values)
                    }
                    binding = ProgramPreviewBindingDef(
                        phaseId: phase.id,
                        ruleId: id,
                        label: variableLabels[varId] ?? varId,
                        measureId: measureId,
                        successExpr: e(targetSource),
                        failureExpr: e("max(\(targetSource) - 1, 0)"))

                case .progressByTable(
                    let id, let varId, let measureId, let steps
                ):
                    binding = ProgramPreviewBindingDef(
                        phaseId: phase.id,
                        ruleId: id,
                        label: variableLabels[varId] ?? varId,
                        measureId: measureId,
                        successExpr: .lit(steps.map(\.atLeast).max() ?? 1),
                        failureExpr: .lit(0))

                case .adjustByBand(
                    let id, let varId, let measureId,
                    let lower, let upper, _
                ):
                    binding = ProgramPreviewBindingDef(
                        phaseId: phase.id,
                        ruleId: id,
                        label: variableLabels[varId] ?? varId,
                        measureId: measureId,
                        successExpr: .lit(upper.nextUp),
                        failureExpr: .lit(
                            max(lower.nextDown, Double.leastNonzeroMagnitude)))

                case .stageDemotion(
                    let id, let stageKey, let measureId,
                    let stageTargets, let weightVarId, _, let resetThreshold
                ):
                    let targetSource = stageTable(stageKey, stageTargets)
                    binding = ProgramPreviewBindingDef(
                        phaseId: phase.id,
                        ruleId: id,
                        label: variableLabels[weightVarId] ?? weightVarId,
                        measureId: measureId,
                        successExpr: e(targetSource),
                        failureExpr: e(
                            "max(min(\(targetSource), \(num(resetThreshold))) - 0.1, 0.1)"))

                case .always:
                    binding = nil
                }
                if let binding { result.append(binding) }
            }
        }
        return result
    }

    // MARK: - 検証

    private static func validate(_ def: BuilderDef, into issues: inout [BuilderIssue]) {
        if def.phases.isEmpty {
            issues.append(.emptyPhases)
        }
        let slotIds = Set(def.slots.map(\.id))
        var slotKindByID: [String: ActivityKind] = [:]
        for slot in def.slots {
            slotKindByID[slot.id] =
                slot.activityRequirement?.requiredKind ?? .strength
        }
        let varIds = Set(def.variables.map(\.id))
        var measureIds: Set<String> = []
        var stageLengths: [String: Set<Int>] = [:]

        for phase in def.phases {
            var rulesToValidate = phase.endRules
            for day in phase.days {
                if day.groups.allSatisfy({ $0.entries.isEmpty }) {
                    issues.append(.emptyDay(phase: phase.label, day: day.label))
                }
                // 同じ実測名を複数の「日」で使うのは正当(bind はサイクルごとにクリア。SS/GZCLP と同形)。
                // 重複が壊すのは同一日内(後の bind が先の値を上書き)だけ
                var dayMeasureIds: Set<String> = []
                for group in day.groups {
                    let entryIds = Set(group.entries.map(\.id))
                    for entry in group.entries {
                        if entry.slotIds.isEmpty {
                            issues.append(.emptyRotation(entryId: entry.id))
                        }
                        // ローテーションの全メンバーを検証(ADR-0032)
                        for slotId in entry.slotIds where !slotIds.contains(slotId) {
                            issues.append(.unknownSlot(entryId: entry.id, slotId: slotId))
                        }
                        for variant in entry.variants {
                            if variant.targetOverrides.contains(where: { targetOverride in
                                !group.setGroups.contains {
                                    $0.id == targetOverride.setGroupId
                                }
                            }) {
                                issues.append(.targetMismatch(groupId: group.id))
                            }
                            if case .value(let rules) = variant.progressionRules {
                                rulesToValidate.append(contentsOf: rules)
                            }
                        }
                    }
                    for setGroup in group.setGroups {
                        // target ↔ メンバーの対応(ADR-0033): 未知の参照・欠けを検出
                        if setGroup.targets.contains(where: { !entryIds.contains($0.entryId) })
                            || group.entries.contains(where: { entry in
                                !setGroup.targets.contains { $0.entryId == entry.id }
                            }) {
                            issues.append(.targetMismatch(groupId: group.id))
                        }
                        if case .byStage(let key, let values) = setGroup.count {
                            stageLengths[key, default: []].insert(values.count)
                        }
                        for target in setGroup.targets {
                            if let varId = loadVariableId(target.load),
                               !varIds.contains(varId) {
                                issues.append(.unknownVariable(
                                    ruleId: target.entryId,
                                    varId: varId))
                            }
                            if let entry = group.entries.first(
                                where: { $0.id == target.entryId }
                            ) {
                                let kinds = Set(
                                    entry.slotIds.compactMap { slotKindByID[$0] }
                                )
                                if kinds.count > 1 {
                                    issues.append(.mixedActivityKinds(entryId: entry.id))
                                } else {
                                    let expected = kinds.first ?? .strength
                                    if let actual = target.activityPrescription?.kind,
                                       actual != expected {
                                        issues.append(.activityPrescriptionMismatch(
                                            entryId: entry.id,
                                            expected: expected,
                                            actual: actual
                                        ))
                            } else if expected != .strength,
                                      target.activityPrescription == nil {
                                issues.append(.missingActivityPrescription(
                                    entryId: entry.id,
                                    expected: expected
                                ))
                            }
                            for variant in entry.variants {
                                let resolved = variant.targetOverride(
                                    setGroupId: setGroup.id
                                )?.resolve(target) ?? target
                                if let varId = loadVariableId(resolved.load),
                                   !varIds.contains(varId) {
                                    issues.append(.unknownVariable(
                                        ruleId: target.entryId,
                                        varId: varId))
                                }
                                if let actual = resolved.activityPrescription?.kind,
                                   actual != expected {
                                    issues.append(.activityPrescriptionMismatch(
                                        entryId: entry.id,
                                        expected: expected,
                                        actual: actual))
                                }
                                if expected != .strength,
                                   resolved.activityPrescription == nil {
                                    issues.append(.missingActivityPrescription(
                                        entryId: entry.id,
                                        expected: expected))
                                }
                                if let side = resolved.side,
                                   side != "left", side != "right" {
                                    issues.append(.invalidSide(
                                        entryId: entry.id,
                                        value: side))
                                }
                                if let measureId = resolved.measureId {
                                    measureIds.insert(measureId)
                                }
                                if case .byStage(let key, let values) = resolved.reps {
                                    stageLengths[key, default: []].insert(values.count)
                                }
                                if case .amrapByStage(let key, let values) = resolved.reps {
                                    stageLengths[key, default: []].insert(values.count)
                                }
                            }
                        }
                            }
                            if let side = target.side, side != "left", side != "right" {
                                issues.append(.invalidSide(entryId: target.entryId, value: side))
                            }
                            if let measureId = target.measureId {
                                measureIds.insert(measureId)
                                if !dayMeasureIds.insert(measureId).inserted {
                                    issues.append(.duplicateMeasure(measureId: measureId))
                                }
                            }
                            if case .byStage(let key, let values) = target.reps {
                                stageLengths[key, default: []].insert(values.count)
                            }
                            if case .amrapByStage(let key, let values) = target.reps {
                                stageLengths[key, default: []].insert(values.count)
                            }
                        }
                    }
                }
            }
            for rule in rulesToValidate {
                switch rule {
                case .progressIfReached(let id, let varId, let measureId, let target, _):
                    if !varIds.contains(varId) { issues.append(.unknownVariable(ruleId: id, varId: varId)) }
                    if !measureIds.contains(measureId) { issues.append(.unknownMeasure(ruleId: id, measureId: measureId)) }
                    if case .stageReps(let key, let values) = target {
                        stageLengths[key, default: []].insert(values.count)
                    }
                case .progressByTable(let id, let varId, let measureId, _),
                     .adjustByBand(let id, let varId, let measureId, _, _, _):
                    if !varIds.contains(varId) { issues.append(.unknownVariable(ruleId: id, varId: varId)) }
                    if !measureIds.contains(measureId) { issues.append(.unknownMeasure(ruleId: id, measureId: measureId)) }
                case .stageDemotion(let id, let stageKey, let measureId, let stageTargets, let weightVarId, _, _):
                    if !varIds.contains(weightVarId) { issues.append(.unknownVariable(ruleId: id, varId: weightVarId)) }
                    if !measureIds.contains(measureId) { issues.append(.unknownMeasure(ruleId: id, measureId: measureId)) }
                    stageLengths[stageKey, default: []].insert(stageTargets.count)
                case .always(let id, let varId, _):
                    if !varIds.contains(varId) { issues.append(.unknownVariable(ruleId: id, varId: varId)) }
                }
            }
        }
        for (key, lengths) in stageLengths where lengths.count > 1 {
            issues.append(.stageLengthMismatch(stageKey: key))
        }
    }

    /// ステージ変数: セット群のステージ表と降格ルールから収集(ユーザーは意識しない)
    private static func collectStageKeys(_ def: BuilderDef) -> Set<String> {
        var keys: Set<String> = []
        for phase in def.phases {
            for day in phase.days {
                for group in day.groups {
                    for setGroup in group.setGroups {
                        if case .byStage(let key, _) = setGroup.count { keys.insert(key) }
                        for target in setGroup.targets {
                            if case .byStage(let key, _) = target.reps { keys.insert(key) }
                            if case .amrapByStage(let key, _) = target.reps { keys.insert(key) }
                        }
                    }
                }
            }
            for rule in phase.endRules {
                if case .stageDemotion(_, let stageKey, _, _, _, _, _) = rule { keys.insert(stageKey) }
                if case .progressIfReached(_, _, _, .stageReps(let key, _), _) = rule { keys.insert(key) }
            }
        }
        return keys
    }

    // MARK: - 式の道具

    /// ステージ表 → 入れ子 if(GZCLP のイディオム): [a,b,c] = if(s==0, a, if(s==1, b, c))
    private static func stageTable(_ stageKey: String, _ values: [Double]) -> String {
        guard let last = values.last else { return "0" }
        guard values.count > 1 else { return num(last) }
        var expr = num(last)
        for (index, value) in values.enumerated().dropLast().reversed() {
            expr = "if(\(stageKey) == \(index), \(num(value)), \(expr))"
        }
        return expr
    }

    /// 数値の最小表記("5" / "2.5"。整数は小数点を出さない)
    private static func num(_ value: Double) -> String {
        if value == value.rounded(), abs(value) < 1e12 {
            return String(Int(value))
        }
        return "\(value)"
    }

    /// 静的文字列の Expr。パース失敗はコンパイラのバグ(テストで全式を検証)
    private static func e(_ source: String) -> Expr {
        do {
            return try ExprParser.parse(source)
        } catch {
            assertionFailure("ビルダー式のパース失敗: \(source) — \(error)")
            return .lit(0)
        }
    }
}
