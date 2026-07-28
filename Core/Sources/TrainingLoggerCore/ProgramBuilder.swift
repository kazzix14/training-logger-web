import Foundation

// プログラムビルダーの中間表現(ADR-0031)。ユーザー操作の正であり、
// ProgramBuilderCompiler が ProgramHSMDef + スロット仕様へ決定論的にコンパイルする。
// 語彙はプリセット5本の表現に閉じる(全て選択式。数式・変数名はユーザーに見せない)。
// ProgramDef.builderData に JSON で保存する。

public struct BuilderDef: Codable, Equatable {
    public var name: String = ""
    public var note: String = ""
    public var variables: [BuilderVariable] = []
    public var slots: [BuilderSlot] = []
    /// 順に循環するフェーズ列(= leaf 列)。1つなら自己遷移
    public var phases: [BuilderPhase] = []

    public init(
        name: String = "",
        note: String = "",
        variables: [BuilderVariable] = [],
        slots: [BuilderSlot] = [],
        phases: [BuilderPhase] = []
    ) {
        self.name = name
        self.note = note
        self.variables = variables
        self.slots = slots
        self.phases = phases
    }
}

/// 基準重量(TM・開始重量)。ステージカウンタはルールから自動生成され、ここには現れない
public struct BuilderVariable: Codable, Equatable, Identifiable {
    public var id: String              // HSM 変数名を兼ねる内部キー(自動採番)
    public var label: String           // 「スクワット TM」
    public var unit: String = "kg"
    /// 直近 e1RM からの既定値係数。nil = 開始重量を直接入力(SS 型)
    public var e1rmFactor: Double?
    public var fallbackValue: Double = 40
    /// 既定値算出・表示に使う種目枠
    public var slotId: String?

    public init(
        id: String,
        label: String,
        unit: String = "kg",
        e1rmFactor: Double? = nil,
        fallbackValue: Double = 40,
        slotId: String? = nil
    ) {
        self.id = id
        self.label = label
        self.unit = unit
        self.e1rmFactor = e1rmFactor
        self.fallbackValue = fallbackValue
        self.slotId = slotId
    }
}

/// 種目枠。種目固定(自作の基本)か、主働筋条件(採用時に候補から選択)
public struct BuilderSlot: Codable, Equatable, Identifiable {
    public var id: String
    public var label: String           // 役割名(「主要スクワット」)
    public var exerciseUuid: String?   // 固定種目。nil = 条件で選ぶ
    public var exerciseName: String?   // 表示・seed 照合用(uuid 優先)
    public var muscleKeys: [String] = []
    public var conditionText: String = ""
    /// v2の型付き条件木。nilの間だけlegacy muscleKeysを使う。
    public var activityRequirement: ActivityRequirement?
    public var distinctGroup: String?

    public init(
        id: String,
        label: String,
        exerciseUuid: String? = nil,
        exerciseName: String? = nil,
        muscleKeys: [String] = [],
        conditionText: String = "",
        activityRequirement: ActivityRequirement? = nil,
        distinctGroup: String? = nil
    ) {
        self.id = id
        self.label = label
        self.exerciseUuid = exerciseUuid
        self.exerciseName = exerciseName
        self.muscleKeys = muscleKeys
        self.conditionText = conditionText
        self.activityRequirement = activityRequirement
        self.distinctGroup = distinctGroup
    }
}

public struct BuilderPhase: Codable, Equatable, Identifiable {
    public var id: String
    public var label: String
    /// 期間目安(日)。due バッジの導出に使われる
    public var windowDays: Int?
    public var days: [BuilderDay] = []
    /// フェーズを終えるときの進行ルール(→ 遷移 actions)
    public var endRules: [BuilderRule] = []
    /// nil = フェーズ列の次(末尾は先頭へ)
    public var nextPhaseId: String?

    public init(
        id: String,
        label: String,
        windowDays: Int? = nil,
        days: [BuilderDay] = [],
        endRules: [BuilderRule] = [],
        nextPhaseId: String? = nil
    ) {
        self.id = id
        self.label = label
        self.windowDays = windowDays
        self.days = days
        self.endRules = endRules
        self.nextPhaseId = nextPhaseId
    }
}

public struct BuilderDay: Codable, Equatable, Identifiable {
    public var id: String
    public var label: String
    public var pill: String = ""
    public var groups: [BuilderGroup] = []

    public init(id: String, label: String, pill: String = "", groups: [BuilderGroup] = []) {
        self.id = id
        self.label = label
        self.pill = pill
        self.groups = groups
    }
}

/// 1ブロック(カード)。仕様の木(Block → Set → Record)と同じ向き(ADR-0033):
/// 種目メンバー列(entries)と、組全体の周のまとまり(setGroups)を持つ。
/// entries が2つ以上ならスーパーセット(1周に全種目)
public struct BuilderGroup: Equatable, Identifiable {
    public var id: String
    /// 種目メンバー(セットは持たない)。枠ローテーション・体系チップの担体
    public var entries: [BuilderEntry] = []
    /// 組全体の「周のまとまり」。各周のなかみは targets(種目ごとの目標)
    public var setGroups: [BuilderSetGroup] = []

    public init(
        id: String,
        entries: [BuilderEntry] = [],
        setGroups: [BuilderSetGroup] = []
    ) {
        self.id = id
        self.entries = entries
        self.setGroups = setGroups
    }
}

/// 種目メンバー。何で組むか(枠のローテーション列)だけを持つ(ADR-0033)
public struct BuilderEntry: Equatable, Identifiable {
    public var id: String
    /// 種目枠のローテーション列(ADR-0032)。1つ = 固定、2つ以上 = サイクル一周ごとに次へ
    public var slotIds: [String]
    /// 処方バナーの体系チップ("percent1rm" / "rpe" / "vbt" …)。nil = 基本
    public var methodologyId: String?

    /// 先頭の枠。ローテーション未使用時の従来参照(コンパイルは展開後に単数化される)
    public var slotId: String { slotIds.first ?? "" }

    public init(id: String, slotIds: [String], methodologyId: String? = nil) {
        self.id = id
        self.slotIds = slotIds
        self.methodologyId = methodologyId
    }

    public init(id: String, slotId: String, methodologyId: String? = nil) {
        self.init(id: id, slotIds: [slotId], methodologyId: methodologyId)
    }
}

extension BuilderEntry: Codable {
    private enum CodingKeys: String, CodingKey {
        case id, slotId, slotIds, methodologyId
    }

    /// 旧形式(slotId 単数)の builderData をそのまま読める(ADR-0032)。エンコードは常に slotIds
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let ids = try container.decodeIfPresent([String].self, forKey: .slotIds)
            ?? [try container.decode(String.self, forKey: .slotId)]
        self.init(
            id: try container.decode(String.self, forKey: .id),
            slotIds: ids,
            methodologyId: try container.decodeIfPresent(String.self, forKey: .methodologyId))
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(slotIds, forKey: .slotIds)
        try container.encodeIfPresent(methodologyId, forKey: .methodologyId)
    }
}

/// 組全体の「N 周 × 各種目の目標」のまとまり。→ SetPlanTpl 列(ADR-0033)
public struct BuilderSetGroup: Codable, Equatable, Identifiable {
    public var id: String
    /// 周回数(固定/ステージ表)。組全体で1つ
    public var count: BuilderCount = .fixed(3)
    /// 種目メンバーごとの目標。組の entries と1:1対応(entryId で結ぶ)
    public var targets: [BuilderTargetLine] = []

    public init(
        id: String,
        count: BuilderCount = .fixed(3),
        targets: [BuilderTargetLine] = []
    ) {
        self.id = id
        self.count = count
        self.targets = targets
    }
}

/// 1周のなかで、1種目が何をやるか(回数・重量・追加目標・実測)
public struct BuilderTargetLine: Codable, Equatable, Identifiable {
    public var entryId: String
    public var reps: BuilderReps = .fixed(5)
    public var load: BuilderLoad?
    /// 体系フィールドの追加指定(RPE 目標・速度帯など。canonical key)
    public var extras: [BuilderExtra] = []
    /// 実測を進行に使う(最終周のこの種目に bind)。ルールが measureId で参照する
    public var measureId: String?
    /// 実測が読むフィールド。nil = 既定則(最初の Floor → scheme 先頭)。速度等は明示
    public var measureFieldKey: String?
    /// 指示メモ(ADR-0072 追補4)。テンポ指定など、構造で表現できない指示を
    /// 処方バナーに出す。Optional のため旧データ互換
    public var note: String?
    /// 側性の指定(ADR-0072 追補5)。"left" / "right" / nil(両側)。
    /// ユニラテラル種目の「左のみ」等を構造で表現する
    public var side: String?

    public var id: String { entryId }

    public init(
        entryId: String,
        reps: BuilderReps = .fixed(5),
        load: BuilderLoad? = nil,
        extras: [BuilderExtra] = [],
        measureId: String? = nil,
        measureFieldKey: String? = nil,
        note: String? = nil,
        side: String? = nil
    ) {
        self.entryId = entryId
        self.reps = reps
        self.load = load
        self.extras = extras
        self.measureId = measureId
        self.measureFieldKey = measureFieldKey
        self.note = note
        self.side = side
    }
}

public extension BuilderSetGroup {
    /// 1種目ブロック向けの便宜 init(target 1本)。プリセット定義とテストが使う
    init(id: String, count: BuilderCount, entryId: String, reps: BuilderReps,
         load: BuilderLoad? = nil, extras: [BuilderExtra] = [],
         measureId: String? = nil, measureFieldKey: String? = nil) {
        self.init(id: id, count: count, targets: [BuilderTargetLine(
            entryId: entryId, reps: reps, load: load, extras: extras,
            measureId: measureId, measureFieldKey: measureFieldKey)])
    }
}

// MARK: - 旧形式(ADR-0031/0032: 種目がセット群を所有)の decode 互換

extension BuilderGroup: Codable {
    private enum CodingKeys: String, CodingKey {
        case id, entries, setGroups
    }

    /// 旧エントリの生の形(setGroups を抱えている)。移行専用
    private struct LegacyEntryPayload: Decodable {
        struct LegacySetGroup: Decodable {
            var id: String
            var count: BuilderCount
            var reps: BuilderReps
            var load: BuilderLoad?
            var extras: [BuilderExtra]?
            var measureId: String?
            var measureFieldKey: String?
        }

        var id: String
        var slotId: String?
        var slotIds: [String]?
        var setGroups: [LegacySetGroup]?
        var methodologyId: String?
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        let entries = try container.decodeIfPresent([BuilderEntry].self, forKey: .entries) ?? []
        if let setGroups = try container.decodeIfPresent([BuilderSetGroup].self, forKey: .setGroups) {
            // 新形式
            self.init(id: id, entries: entries, setGroups: setGroups)
            return
        }
        // 旧形式: entries の中の setGroups を持ち上げる(無損失変換)
        let payloads = try container.decodeIfPresent([LegacyEntryPayload].self, forKey: .entries) ?? []
        self.init(id: id, entries: entries, setGroups: Self.migrated(payloads))
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(entries, forKey: .entries)
        try container.encode(setGroups, forKey: .setGroups)
    }

    private static func migrated(_ payloads: [LegacyEntryPayload]) -> [BuilderSetGroup] {
        func line(_ entryId: String, _ sg: LegacyEntryPayload.LegacySetGroup) -> BuilderTargetLine {
            BuilderTargetLine(entryId: entryId, reps: sg.reps, load: sg.load,
                              extras: sg.extras ?? [], measureId: sg.measureId,
                              measureFieldKey: sg.measureFieldKey)
        }
        // 旧スーパーセット(旧制約: 各種目1セット群・固定・同数・実測なし)は1つの周に畳む
        let legacy = payloads.map { ($0.id, $0.setGroups ?? []) }
        if legacy.count > 1 {
            let counts = legacy.compactMap { _, sgs -> Int? in
                guard sgs.count == 1, case .fixed(let n) = sgs[0].count else { return nil }
                return n
            }
            if counts.count == legacy.count, Set(counts).count == 1,
               let first = legacy.first?.1.first {
                return [BuilderSetGroup(
                    id: first.id, count: first.count,
                    targets: legacy.compactMap { entryId, sgs in
                        sgs.first.map { line(entryId, $0) }
                    })]
            }
        }
        // 単種目(または防御フォールバック): セット群ごとに target 1本で持ち上げ
        return legacy.flatMap { entryId, sgs in
            sgs.map { BuilderSetGroup(id: $0.id, count: $0.count, targets: [line(entryId, $0)]) }
        }
    }
}

public enum BuilderCount: Codable, Equatable {
    case fixed(Int)
    /// ステージ表(GZCLP: 5→6→10)。値は「実測セットを含む総数」
    case byStage(stageKey: String, values: [Int])
}

public enum BuilderReps: Codable, Equatable {
    case fixed(Int)
    /// n 回以上・限界まで(Floor)
    case amrap(min: Int)
    case range(lo: Int, hi: Int)
    case byStage(stageKey: String, values: [Int])
    /// ステージ表 + 限界まで(GZCLP top: 3+ → 2+ → 1+)
    case amrapByStage(stageKey: String, values: [Int])
}

public enum BuilderLoad: Codable, Equatable {
    /// kg 直値
    case fixed(Double)
    /// 基準重量の %。annotate = 処方バナーに %注釈を出す(0.5kg 丸め)
    case percentOfVar(varId: String, percent: Double, annotate: Bool)
    /// 基準重量そのまま(SS 型。0.5kg 丸め)
    case variable(varId: String)
}

public struct BuilderExtra: Codable, Equatable {
    public var fieldKey: String        // "rpe.rpe" / "vbt.velocity" 等
    public var kind: Kind

    public enum Kind: Codable, Equatable {
        case exact(Double)
        case range(lo: Double, hi: Double)
    }

    public init(fieldKey: String, kind: Kind) {
        self.fieldKey = fieldKey
        self.kind = kind
    }
}

/// 進行ルール(フェーズの終わりに評価)。プリセット5本の全パターン
public enum BuilderRule: Codable, Equatable, Identifiable {
    /// 実測が目標以上なら 変数 += increment(SS / 5/3/1 / GZCLP T3)
    case progressIfReached(id: String, varId: String, measureId: String,
                           target: BuilderTarget, increment: Double)
    /// 実測の閾値テーブルで増分が変わる(nSuns)。steps は atLeast 降順で評価
    case progressByTable(id: String, varId: String, measureId: String,
                         steps: [BuilderTableStep])
    /// 帯超え +delta / 帯割れ(かつ >0)で −delta(VBT)
    case adjustByBand(id: String, varId: String, measureId: String,
                      lower: Double, upper: Double, delta: Double)
    /// 未達でステージ+1、最終段の失敗で 重量×resetFactor & ステージ0へ(GZCLP)。
    /// stageTargets = ステージごとの目標(セット群のステージ表と同じ長さ)
    case stageDemotion(id: String, stageKey: String, measureId: String,
                       stageTargets: [Double], weightVarId: String,
                       resetFactor: Double, resetThreshold: Double)
    /// 無条件に 変数 += increment
    case always(id: String, varId: String, increment: Double)

    public var id: String {
        switch self {
        case .progressIfReached(let id, _, _, _, _),
             .progressByTable(let id, _, _, _),
             .adjustByBand(let id, _, _, _, _, _),
             .stageDemotion(let id, _, _, _, _, _, _),
             .always(let id, _, _):
            return id
        }
    }
}

public enum BuilderTarget: Codable, Equatable {
    case fixed(Double)
    /// ステージ表の現在値を目標にする(GZCLP: t1Reps(s))
    case stageReps(stageKey: String, values: [Double])
}

public struct BuilderTableStep: Codable, Equatable {
    public var atLeast: Double
    public var increment: Double

    public init(atLeast: Double, increment: Double) {
        self.atLeast = atLeast
        self.increment = increment
    }
}

// MARK: - 検証(保存時のインラインエラー)

public enum BuilderIssue: Equatable, CustomStringConvertible {
    case emptyPhases
    case emptyDay(phase: String, day: String)
    case unknownSlot(entryId: String, slotId: String)
    case unknownVariable(ruleId: String, varId: String)
    case unknownMeasure(ruleId: String, measureId: String)
    case duplicateMeasure(measureId: String)
    case targetMismatch(groupId: String)
    case stageLengthMismatch(stageKey: String)
    case invalidSide(entryId: String, value: String)
    case emptyRotation(entryId: String)
    case rotationTooLong(period: Int)

    public var description: String {
        switch self {
        case .emptyPhases: return "フェーズ(週)がありません"
        case .emptyDay(let phase, let day): return "\(phase) の \(day) に種目がありません"
        case .unknownSlot(_, let slotId): return "種目枠が未解決です: \(slotId)"
        case .unknownVariable(_, let varId): return "基準重量が見つかりません: \(varId)"
        case .unknownMeasure(_, let measureId): return "参照する実測がありません: \(measureId)"
        case .duplicateMeasure(let id): return "実測マークが重複しています: \(id)"
        case .targetMismatch(let id): return "組のセット群と種目の対応が壊れています(組を編集し直してください): \(id)"
        case .stageLengthMismatch(let key): return "ステージ表の長さが揃っていません: \(key)"
        case .invalidSide(_, let value):
            return "側性の指定が不正です(left / right のみ): \(value)"
        case .emptyRotation(let id): return "種目のない行があります: \(id)"
        case .rotationTooLong(let period):
            return "交互種目の組み合わせが長すぎます(周期\(period)。上限は12)"
        }
    }
}
