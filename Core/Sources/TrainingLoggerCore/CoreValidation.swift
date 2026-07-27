import Foundation

/// プログラムJSONのエンベロープ（ADR-0072。アプリとWebで共有、ADR-0074）
public struct ProgramTransferEnvelope: Codable {
    public var format: String
    public var version: Int
    public var program: BuilderDef

    public init(format: String = "traininglogger.program", version: Int = 1,
                program: BuilderDef) {
        self.format = format
        self.version = version
        self.program = program
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
        guard envelope.version == 1 else {
            return ["未対応のバージョンです（version \(envelope.version)。1 に対応）"]
        }
        var issues: [String] = []
        issues.append(contentsOf: missingExerciseNames(
            envelope.program, knownNames: Set(knownExerciseNames))
            .map { "存在しない種目があります: \($0)" })
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

    /// 数値の妥当性（ADR-0072 追補3）: 重量 0超〜500kg、percent 0超〜200、
    /// 増分 0超〜50kg、resetFactor (0,1]
    public static func plausibilityFindings(_ def: BuilderDef) -> [String] {
        var findings: [String] = []
        func checkWeight(_ value: Double, _ label: String) {
            if !(value > 0 && value <= 500) {
                findings.append("\(label): \(value)kg（0超〜500kgの範囲外）")
            }
        }
        func checkIncrement(_ value: Double, _ label: String) {
            if !(value > 0 && value <= 50) {
                findings.append("\(label): \(value)kg（0超〜50kgの範囲外）")
            }
        }
        for variable in def.variables {
            checkWeight(variable.fallbackValue, "基準重量「\(variable.label)」の fallbackValue")
        }
        for phase in def.phases {
            for day in phase.days {
                for group in day.groups {
                    for setGroup in group.setGroups {
                        for target in setGroup.targets {
                            switch target.load {
                            case .fixed(let kg):
                                checkWeight(kg, "\(day.label) の固定重量")
                            case .percentOfVar(_, let percent, _):
                                if !(percent > 0 && percent <= 200) {
                                    findings.append(
                                        "\(day.label) の percent: \(percent)（0超〜200の範囲外。75% は 75 と書く）")
                                }
                            case .variable, .none:
                                break
                            }
                        }
                    }
                }
            }
            for rule in phase.endRules {
                switch rule {
                case .progressIfReached(_, _, _, _, let increment):
                    checkIncrement(increment, "進行ルール(\(rule.id))の increment")
                case .always(_, _, let increment):
                    checkIncrement(increment, "進行ルール(\(rule.id))の increment")
                case .progressByTable(_, _, _, let steps):
                    for step in steps {
                        checkIncrement(step.increment, "進行ルール(\(rule.id))の increment")
                    }
                case .adjustByBand(_, _, _, _, _, let delta):
                    checkIncrement(delta, "進行ルール(\(rule.id))の delta")
                case .stageDemotion(_, _, _, _, _, let resetFactor, _):
                    if !(resetFactor > 0 && resetFactor <= 1) {
                        findings.append("進行ルール(\(rule.id))の resetFactor: \(resetFactor)（0超〜1の範囲外）")
                    }
                }
            }
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
