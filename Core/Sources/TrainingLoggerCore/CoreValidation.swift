import Foundation

public enum ProgramSchemaVersion {
    public static let current = 2
}

/// プログラムJSONのエンベロープ（ADR-0072。アプリとWebで共有、ADR-0074）
public struct ProgramTransferEnvelope: Codable {
    public var format: String
    public var version: Int
    public var program: BuilderDef
    public var bundledActivities: [BundledActivityDefinition]?

    public init(format: String = "traininglogger.program",
                version: Int = ProgramSchemaVersion.current,
                program: BuilderDef,
                bundledActivities: [BundledActivityDefinition]? = nil) {
        self.format = format
        self.version = version
        self.program = program
        self.bundledActivities = bundledActivities
    }
}

/// アプリ・wasm 共通の検証（ADR-0074）。副作用なし・Foundation のみ。
/// 返り値は日本語の指摘文字列（空 = 妥当）
public enum CoreValidation {

    /// JSON バイト列 → 指摘一覧。デコード・形式・種目存在・コンパイル・数値妥当性を
    /// アプリのインポートと同じ順で検査する
    public static func validate(envelopeJSON: Data,
                                knownExerciseNames: [String]) -> [String] {
        let envelope: ProgramTransferEnvelope
        do {
            envelope = try JSONDecoder().decode(ProgramTransferEnvelope.self, from: envelopeJSON)
        } catch let error as DecodingError {
            return [describe(error)]
        } catch {
            return ["JSONとして読めません: \(error.localizedDescription)"]
        }
        guard envelope.format == "traininglogger.program" else {
            return ["format が \(envelope.format)（traininglogger.program を期待）"]
        }
        guard envelope.version == ProgramSchemaVersion.current else {
            return ["未対応のバージョンです（version \(envelope.version)。\(ProgramSchemaVersion.current) に対応）"]
        }
        var issues: [String] = []
        let bundled = envelope.bundledActivities ?? []
        let bundledNames = Set(bundled.map(\.name))
        issues.append(contentsOf: missingExerciseNames(
            envelope.program, knownNames: Set(knownExerciseNames).union(bundledNames))
            .map { "存在しない種目があります: \($0)" })
        issues.append(contentsOf: bundledActivityFindings(bundled))
        issues.append(contentsOf: ProgramBuilderCompiler.compile(envelope.program)
            .issues.map(\.description))
        issues.append(contentsOf: plausibilityFindings(envelope.program))
        return issues
    }

    /// 名前指定なのに既知の種目に無い枠（exerciseName = nil の条件枠は対象外）
    public static func missingExerciseNames(_ def: BuilderDef,
                                            knownNames: Set<String>) -> [String] {
        def.slots.compactMap { slot in
            guard let name = slot.exerciseName, !name.isEmpty else { return nil }
            return knownNames.contains(name) ? nil : name
        }
    }

    /// 数値の妥当性（ADR-0072 追補3/6）: 基準重量 0超〜500kg、
    /// 固定load -500〜500kg、percent 0超〜1、増分 0超〜50kg、
    /// resetFactor (0,1]
    public static func bundledActivityFindings(
        _ definitions: [BundledActivityDefinition]
    ) -> [String] {
        var findings: [String] = []
        var ids = Set<String>()
        for definition in definitions {
            if definition.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                findings.append("同梱種目のIDが空です: \(definition.name)")
            } else if !ids.insert(definition.id).inserted {
                findings.append("同梱種目のIDが重複しています: \(definition.id)")
            }
            if definition.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                findings.append("同梱種目の名前が空です: \(definition.id)")
            }
            switch definition.definition {
            case .strength(let strength):
                if !strength.bodyweightFraction.isFinite {
                    findings.append("\(definition.name) の bodyweightFraction が有限値ではありません")
                }
            case .running(let running):
                if let pace = running.defaultPace, pace.dimension != .pace {
                    findings.append("\(definition.name) の defaultPace はペース単位が必要です")
                }
            case .cycling(let cycling):
                if let speed = cycling.defaultSpeed, speed.dimension != .speed {
                    findings.append("\(definition.name) の defaultSpeed は速度単位が必要です")
                }
            }
        }
        return findings
    }

    public static func plausibilityFindings(_ def: BuilderDef) -> [String] {
        var findings: [String] = []
        var slotKinds: [String: ActivityKind] = [:]
        for slot in def.slots {
            if let kind = slot.activityRequirement?.requiredKind {
                slotKinds[slot.id] = kind
            }
        }
        func checkBaselineWeight(_ value: Double, _ label: String) {
            if !(value > 0 && value <= 500) {
                findings.append("\(label): \(value)kg（0超〜500kgの範囲外）")
            }
        }
        func checkEnteredLoad(_ value: Double, _ label: String) {
            if !value.isFinite || !(-500...500).contains(value) {
                findings.append("\(label): \(value)kg（-500〜500kgの範囲外）")
            }
        }
        func checkIncrement(_ value: Double, _ label: String) {
            if !(value > 0 && value <= 50) {
                findings.append("\(label): \(value)kg（0超〜50kgの範囲外）")
            }
        }
        func checkRule(_ rule: BuilderRule, _ label: String) {
            switch rule {
            case .progressIfReached(_, _, _, _, let increment):
                checkIncrement(increment, "\(label)の increment")
            case .always(_, _, let increment):
                checkIncrement(increment, "\(label)の increment")
            case .progressByTable(_, _, _, let steps):
                for step in steps {
                    checkIncrement(step.increment, "\(label)の increment")
                }
            case .adjustByBand(_, _, _, _, _, let delta):
                checkIncrement(delta, "\(label)の delta")
            case .stageDemotion(_, _, _, _, _, let resetFactor, _):
                if !(resetFactor > 0 && resetFactor <= 1) {
                    findings.append(
                        "\(label)の resetFactor: \(resetFactor)（0超〜1の範囲外）")
                }
            }
        }
        for variable in def.variables {
            checkBaselineWeight(
                variable.fallbackValue,
                "基準重量「\(variable.label)」の fallbackValue")
        }
        for phase in def.phases {
            for day in phase.days {
                for group in day.groups {
                    for setGroup in group.setGroups {
                        for target in setGroup.targets {
                        switch target.load {
                        case .fixed(let kg):
                            checkEnteredLoad(kg, "\(day.label) の固定重量")
                        case .percentOfVar(_, let percent, _):
                            if !(percent > 0 && percent <= 1) {
                                findings.append(
                                    "\(day.label) の percent: \(percent)（0超〜1の範囲外。75% は 0.75 と書く）")
                                }
                            case .variable, .none:
                                break
                            }
                            if let prescription = target.activityPrescription {
                                findings.append(contentsOf: prescriptionFindings(
                                    prescription,
                                    label: "\(day.label) の型付き処方"
                                ))
                                if let entry = group.entries.first(
                                    where: { $0.id == target.entryId }
                                ) {
                                    let expected = Set(
                                        entry.slotIds.compactMap { slotKinds[$0] }
                                    )
                                    if expected.count == 1,
                                       expected.first != prescription.kind {
                                        findings.append(
                                            "\(day.label) の処方タイプが種目枠と一致しません"
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
            for day in phase.days {
                for group in day.groups {
                    for entry in group.entries {
                        for variant in entry.variants {
                            let variantLabel = variant.label ?? variant.slotId
                            for override in variant.targetOverrides {
                                if case .value(let load) = override.load {
                                    switch load {
                                    case .fixed(let kg):
                                        checkEnteredLoad(
                                            kg,
                                            "\(day.label)・\(variantLabel) の固定重量")
                                    case .percentOfVar(_, let percent, _):
                                        if !(percent > 0 && percent <= 1) {
                                            findings.append(
                                                "\(day.label)・\(variantLabel) の percent: \(percent)（0超〜1の範囲外。75% は 0.75 と書く）")
                                        }
                                    case .variable:
                                        break
                                    }
                                }
                                if case .value(let prescription) = override.activityPrescription {
                                    findings.append(contentsOf: prescriptionFindings(
                                        prescription,
                                        label: "\(day.label)・\(variantLabel) の型付き処方"))
                                }
                            }
                            if case .value(let rules) = variant.progressionRules {
                                for rule in rules {
                                    checkRule(
                                        rule,
                                        "進行ルール(\(rule.id))・\(variantLabel)")
                                }
                            }
                        }
                    }
                }
            }
            for rule in phase.endRules {
                checkRule(rule, "進行ルール(\(rule.id))")
            }
        }
        return findings
    }

    private static func prescriptionFindings(
        _ prescription: ActivityPrescriptionPayload,
        label: String
    ) -> [String] {
        var findings: [String] = []
        func require(
            _ target: QuantityTarget?,
            _ dimension: QuantityDimension,
            _ field: String
        ) {
            guard let target else { return }
            let dimensions: [QuantityDimension]
            switch target {
            case .exact(let value):
                dimensions = [value.dimension]
            case .range(let lower, let upper):
                dimensions = [lower.dimension, upper.dimension]
            case .open:
                dimensions = []
            }
            if dimensions.contains(where: { $0 != dimension }) {
                findings.append("\(label)の\(field)は\(dimension.rawValue)単位が必要です")
            }
            if case .range(let lower, let upper) = target,
               lower.dimension == upper.dimension,
               lower.baseValue > upper.baseValue {
                findings.append("\(label)の\(field)は下限を上限以下にしてください")
            }
        }

        switch prescription {
        case .strength(let value):
            require(value.sets, .count, "セット数")
            require(value.load, .load, "重量")
            require(value.relativeLoad?.multiplier, .ratio, "相対重量")
            if let relativeLoad = value.relativeLoad,
               relativeLoad.baselineKey.trimmingCharacters(in: .whitespacesAndNewlines)
                .isEmpty {
                findings.append("\(label)の相対重量には基準キーが必要です")
            }
            require(value.repetitions, .count, "回数")
            require(value.targetRPE, .effort, "RPE")
        case .running(let value):
            require(value.distance, .distance, "距離")
            require(value.duration, .duration, "時間")
            switch value.pace {
            case .absolute(let pace):
                require(pace, .pace, "ペース")
            case .relativeToBaseline(let key, let speedMultiplier):
                require(speedMultiplier, .ratio, "相対ペース")
                if key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    findings.append("\(label)の相対ペースには基準キーが必要です")
                }
            case .zone(let key):
                if key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    findings.append("\(label)のペースゾーンにはキーが必要です")
                }
            case .open:
                break
            }
            require(value.targetRPE, .effort, "RPE")
        case .cycling(let value):
            require(value.distance, .distance, "距離")
            require(value.duration, .duration, "時間")
            require(value.speed, .speed, "速度")
            require(value.targetRPE, .effort, "RPE")
        }
        return findings
    }

    /// DecodingError をキーパス付きの日本語へ（AI・Web との往復デバッグ用）
    public static func describe(_ error: DecodingError) -> String {
        func path(_ context: DecodingError.Context) -> String {
            let keys = context.codingPath.map(\.stringValue).joined(separator: ".")
            return keys.isEmpty ? "(root)" : keys
        }
        switch error {
        case .keyNotFound(let key, let context):
            return "キーがありません: \(path(context)).\(key.stringValue) — 既定値があるキーも省略できません"
        case .typeMismatch(_, let context):
            return "型が違います: \(path(context)) — \(context.debugDescription)"
        case .valueNotFound(_, let context):
            return "値がありません: \(path(context))"
        case .dataCorrupted(let context):
            return "JSONとして読めません: \(context.debugDescription)"
        @unknown default:
            return "\(error)"
        }
    }
}
