#if canImport(FoundationEssentials) && !canImport(Darwin)
import FoundationEssentials
#else
import Foundation
#endif

// v4 プログラム定義: データのみ（HSM + DayTemplate + Expr、ADR-0017、仕様 §5）。
// ProgramDef.hsmData に JSON で保存する Codable 構造。JS script を置き換える。
//
// cycle の意味論（ProgramEngine が実装、ADR-0022）:
// 1. emitCycle: 現在 leaf の全 days を一括で処方の木として emit
// 2. advanceCycle: 現サイクルの適用済み plan から completed Record だけを bind
// 3. 遷移: 現在 leaf → 祖先の順に guard 評価。最初に真になった遷移の actions を実行して
//    target phase の最初の leaf へ移動。発火しなければ次サイクルも同じ leaf
// 時間は leaf.windowDays + runState.cycleStartedAt から導出し、機械の入力にはしない。

public struct ProgramHSMDef: Codable, Equatable, Sendable {
    public var inputs: [ProgramInputDef]
    public var initActions: [VarAssign]
    public var root: PhaseDef
    public var previewBindings: [ProgramPreviewBindingDef]?

    public init(
        inputs: [ProgramInputDef],
        initActions: [VarAssign],
        root: PhaseDef,
        previewBindings: [ProgramPreviewBindingDef]? = nil
    ) {
        self.inputs = inputs
        self.initActions = initActions
        self.root = root
        self.previewBindings = previewBindings
    }
}

/// 採用前scenario previewで使う構造化bind。成功/失敗の値は現在varsから
/// Expr評価し、維持はbind欠測として扱う。
public struct ProgramPreviewBindingDef: Codable, Equatable, Sendable, Identifiable {
    public var phaseId: String
    public var ruleId: String
    public var label: String
    public var measureId: String
    public var successExpr: Expr
    public var failureExpr: Expr
    /// 実測を含む環境で 1=success / 0=maintain / -1=failure を返す。
    public var outcomeExpr: Expr
    public var trackedVariableIds: [String]
    public var missingMetricBehavior: MissingMetricBehavior

    public var id: String { "\(phaseId):\(ruleId):\(measureId)" }

    public init(
        phaseId: String,
        ruleId: String,
        label: String,
        measureId: String,
        successExpr: Expr,
        failureExpr: Expr,
        outcomeExpr: Expr,
        trackedVariableIds: [String],
        missingMetricBehavior: MissingMetricBehavior = .maintain
    ) {
        self.phaseId = phaseId
        self.ruleId = ruleId
        self.label = label
        self.measureId = measureId
        self.successExpr = successExpr
        self.failureExpr = failureExpr
        self.outcomeExpr = outcomeExpr
        self.trackedVariableIds = trackedVariableIds
        self.missingMetricBehavior = missingMetricBehavior
    }
}

/// 採用時にユーザーが入力する初期値（TM 等）
public struct ProgramInputDef: Codable, Equatable, Sendable {
    public var key: String
    public var label: String
    /// 値の次元。unit は表示専用であり、型はここからのみ決める。
    public var dimension: QuantityDimension
    public var unit: String
    /// 直近 e1RM からの既定値算出係数（例 0.9 = e1RM の 90%）。対象 slot の種目の実績から引く
    public var defaultFromE1RMFactor: Double?
    /// 実績がないときの既定値
    public var fallbackValue: Double
    /// 既定値算出に使う slot
    public var slotId: String?

    public init(
        key: String,
        label: String,
        dimension: QuantityDimension = .load,
        unit: String,
        defaultFromE1RMFactor: Double? = nil,
        fallbackValue: Double,
        slotId: String? = nil
    ) {
        self.key = key
        self.label = label
        self.dimension = dimension
        self.unit = unit
        self.defaultFromE1RMFactor = defaultFromE1RMFactor
        self.fallbackValue = fallbackValue
        self.slotId = slotId
    }
}

public struct VarAssign: Codable, Equatable, Sendable {
    public var name: String
    public var expr: Expr

    public init(name: String, expr: Expr) {
        self.name = name
        self.expr = expr
    }
}

public indirect enum PhaseDef: Codable, Equatable, Sendable {
    case leaf(LeafPhaseDef)
    case composite(CompositePhaseDef)

    public var id: String {
        switch self {
        case .leaf(let l): return l.id
        case .composite(let c): return c.id
        }
    }

    public var transitions: [TransitionDef] {
        switch self {
        case .leaf(let l): return l.transitions
        case .composite(let c): return c.transitions
        }
    }

    /// この部分木の最初の leaf（composite は initial を辿る）
    public var firstLeaf: LeafPhaseDef? {
        switch self {
        case .leaf(let l):
            return l
        case .composite(let c):
            let initial = c.children.first { $0.id == c.initial } ?? c.children.first
            return initial?.firstLeaf
        }
    }

    /// id → phase の全探索
    public func find(_ phaseId: String) -> PhaseDef? {
        if id == phaseId { return self }
        if case .composite(let c) = self {
            for child in c.children {
                if let found = child.find(phaseId) { return found }
            }
        }
        return nil
    }

    /// 部分木の全 leaf（表示順 = 定義順）
    public var leaves: [LeafPhaseDef] {
        switch self {
        case .leaf(let l): return [l]
        case .composite(let c): return c.children.flatMap(\.leaves)
        }
    }

    /// leaf の祖先列（近い順）。leaf が見つからなければ nil
    public func ancestors(of phaseId: String, path: [PhaseDef] = []) -> [PhaseDef]? {
        if id == phaseId { return path.reversed() }
        if case .composite(let c) = self {
            for child in c.children {
                if let found = child.ancestors(of: phaseId, path: path + [self]) { return found }
            }
        }
        return nil
    }
}

public struct LeafPhaseDef: Codable, Equatable, Sendable {
    public var id: String
    public var windowDays: Int? = nil
    public var days: [DayTemplateDef]
    public var transitions: [TransitionDef]

    public init(
        id: String,
        windowDays: Int? = nil,
        days: [DayTemplateDef],
        transitions: [TransitionDef]
    ) {
        self.id = id
        self.windowDays = windowDays
        self.days = days
        self.transitions = transitions
    }
}

public struct CompositePhaseDef: Codable, Equatable, Sendable {
    public var id: String
    public var children: [PhaseDef]
    public var initial: String
    public var transitions: [TransitionDef]

    public init(
        id: String,
        children: [PhaseDef],
        initial: String,
        transitions: [TransitionDef]
    ) {
        self.id = id
        self.children = children
        self.initial = initial
        self.transitions = transitions
    }
}

public struct TransitionDef: Codable, Equatable, Sendable {
    public var guardExpr: Expr
    public var target: String
    public var actions: [VarAssign]

    public init(guardExpr: Expr, target: String, actions: [VarAssign]) {
        self.guardExpr = guardExpr
        self.target = target
        self.actions = actions
    }
}

public struct DayTemplateDef: Codable, Equatable, Sendable {
    public var label: String          // セッション名（"Push A" / "Week 3 · ベンチ"）
    public var dayPill: String        // 進行中タブの右ピル（"ベンチ日"）
    public var blocks: [BlockPlanTpl]
    /// 1日の中に複数セッションがある場合の明示構造。nilなら従来の単一セッション。
    public var sessions: [SessionTemplateDef]?
    /// 単一セッション形式で使う実行木。blocksとの併用も可能。
    public var execution: ExecutionNode?

    public init(
        label: String,
        dayPill: String,
        blocks: [BlockPlanTpl],
        sessions: [SessionTemplateDef]? = nil,
        execution: ExecutionNode? = nil
    ) {
        self.label = label
        self.dayPill = dayPill
        self.blocks = blocks
        self.sessions = sessions
        self.execution = execution
    }

    public var resolvedSessions: [SessionTemplateDef] {
        if let sessions, !sessions.isEmpty {
            return sessions
        }
        return [
            SessionTemplateDef(
                id: "session",
                label: label,
                dayPill: dayPill,
                blocks: blocks,
                execution: execution
            )
        ]
    }
}

public struct SessionTemplateDef: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var label: String
    public var dayPill: String
    public var blocks: [BlockPlanTpl]
    public var execution: ExecutionNode?

    public init(
        id: String,
        label: String,
        dayPill: String,
        blocks: [BlockPlanTpl] = [],
        execution: ExecutionNode? = nil
    ) {
        self.id = id
        self.label = label
        self.dayPill = dayPill
        self.blocks = blocks
        self.execution = execution
    }
}

public struct BlockPlanTpl: Codable, Equatable, Sendable {
    public var sets: [SetPlanTpl]

    public init(sets: [SetPlanTpl]) {
        self.sets = sets
    }
}

public struct SetPlanTpl: Codable, Equatable, Sendable {
    public var records: [RecordPlanTpl]
    /// セット数の穴も Expr（設計拡張、ADR-0017 追記）。
    /// emit 時に評価して n 回複製する（GZCLP の rep-scheme 降格のように
    /// セット数が state 依存のプログラムに必要）。nil = 1回、欠測 = 1回
    public var repeatExpr: Expr?

    public init(records: [RecordPlanTpl], repeatExpr: Expr? = nil) {
        self.records = records
        self.repeatExpr = repeatExpr
    }
}

/// template 期の RecordPlan。exercise は SlotId、scheme のキーは FieldKey（採用時に解決）
public struct RecordPlanTpl: Codable, Equatable, Sendable {
    public var slotId: String
    public var side: String?
    public var scheme: [SchemeTpl]
    public var bind: String?
    /// bind が読む field の明示指定（設計拡張、ADR-0017 追記）。
    /// nil = 既定規則（最初の Floor、なければ scheme 先頭）。
    /// VBT の velocity bind のように「Floor でも先頭でもない field」を読むのに必要
    public var bindFieldKey: String?
    /// 表示用: この処方行の体系（体系チップ・カタログ可視性の分類 fact）
    public var methodologyId: String?
    /// 指示メモ(ADR-0072 追補4)。処方バナーに表示する自由文
    public var noteText: String?
    /// 種目タイプ固有の処方。nilならschemeが正規表現。
    public var activityPrescription: ActivityPrescriptionPayload?

    public init(slotId: String, side: String?, scheme: [SchemeTpl], bind: String?,
                bindFieldKey: String? = nil, methodologyId: String?,
                noteText: String? = nil,
                activityPrescription: ActivityPrescriptionPayload? = nil) {
        self.slotId = slotId
        self.side = side
        self.scheme = scheme
        self.bind = bind
        self.bindFieldKey = bindFieldKey
        self.methodologyId = methodologyId
        self.noteText = noteText
        self.activityPrescription = activityPrescription
    }
}

public struct SchemeTpl: Codable, Equatable, Sendable {
    public var fieldKey: String
    public var kind: SpecKind
    public var expr: Expr
    /// Range の上限（kind == .range のときのみ）
    public var upperExpr: Expr?
    /// バナー注釈の Expr（例 %表示: "0.75" → "75%"）。評価値を % 表記で添える
    public var percentExpr: Expr?

    public enum SpecKind: String, Codable, Sendable {
        case exact
        case floor
        case range
    }

    public init(
        fieldKey: String,
        kind: SpecKind,
        expr: Expr,
        upperExpr: Expr? = nil,
        percentExpr: Expr? = nil
    ) {
        self.fieldKey = fieldKey
        self.kind = kind
        self.expr = expr
        self.upperExpr = upperExpr
        self.percentExpr = percentExpr
    }
}

// MARK: - ライブラリ表示メタ（プログラム詳細画面の表示コピー。ロジックは読まない）

public struct ProgramLibraryInfo: Codable, Equatable, Sendable {
    public var origin: String            // "Jim Wendler · %1RM法ベース"
    public var tagline: String
    public var meta: String              // "週4 · 約50分"
    public var isPopular: Bool
    public var kindLabel: String         // "Composite" / "Leaf"
    public var kindNote: String          // "メゾ = W1→W2→W3→Deload の入れ子"
    public var statGrid: [StatEntry]     // 2×2 統計グリッド
    public var timeline: [TimelineEntry]
    public var loopNote: String
    public var bindNote: String

    public init(
        origin: String,
        tagline: String,
        meta: String,
        isPopular: Bool,
        kindLabel: String,
        kindNote: String,
        statGrid: [StatEntry],
        timeline: [TimelineEntry],
        loopNote: String,
        bindNote: String
    ) {
        self.origin = origin
        self.tagline = tagline
        self.meta = meta
        self.isPopular = isPopular
        self.kindLabel = kindLabel
        self.kindNote = kindNote
        self.statGrid = statGrid
        self.timeline = timeline
        self.loopNote = loopNote
        self.bindNote = bindNote
    }

    public struct StatEntry: Codable, Equatable, Sendable {
        public var label: String
        public var value: String

        public init(label: String, value: String) {
            self.label = label
            self.value = value
        }
    }

    public struct TimelineEntry: Codable, Equatable, Sendable {
        public var label: String         // "Week 1"
        public var sub: String           // "漸増"
        public var scheme: String        // "5 · 5 · 5+"
        public var percents: String      // "65% · 75% · 85%"
        public var amrap: Bool
        public var tone: String          // "up" / "peak" / "deload"

        public init(
            label: String,
            sub: String,
            scheme: String,
            percents: String,
            amrap: Bool,
            tone: String
        ) {
            self.label = label
            self.sub = sub
            self.scheme = scheme
            self.percents = percents
            self.amrap = amrap
            self.tone = tone
        }
    }
}
