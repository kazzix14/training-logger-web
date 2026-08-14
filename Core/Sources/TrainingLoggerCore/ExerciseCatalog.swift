#if canImport(FoundationEssentials) && !canImport(Darwin)
import FoundationEssentials
#else
import Foundation
#endif

/// アプリ → Web ビルダーへ渡す種目カタログ（ADR-0080）。
///
/// Web は種目名の補完と既知種目の照合にこれを使う。アプリが唯一の生成元で、
/// 受け取り側は JS だが、形の正準はここに置いてテストで固定する。
public enum ExerciseCatalogSchemaVersion {
    public static let current = 1
    public static let format = "traininglogger.catalog"
}

/// カタログ1件。
///
/// `uuid` は Optional。`Exercise.uuid` の既定が空文字で、旧データには
/// 未採番のものが残るため（`SeedData.backfillUUIDs` が埋める）。
/// uuid が無い種目は名前だけで照合される。
///
/// アーカイブ済みも `archived: true` で載せる。アプリのインポートは
/// アーカイブ状態を問わず照合するので、除外すると Web だけがエラーになる。
/// 入力候補には出さない。
public struct ExerciseCatalogEntry: Codable, Equatable, Sendable {
    public var name: String
    public var uuid: String?
    /// `ActivityKind` の raw 値（strength / running / cycling …）
    public var kind: String
    public var archived: Bool

    public init(name: String, uuid: String? = nil, kind: String, archived: Bool = false) {
        self.name = name
        self.uuid = uuid
        self.kind = kind
        self.archived = archived
    }
}

/// 組み込みの筋肉。Web の筋肉キー入力の候補になる
public struct MuscleCatalogEntry: Codable, Equatable, Sendable {
    public var key: String
    public var name: String

    public init(key: String, name: String) {
        self.key = key
        self.name = name
    }
}

public struct ExerciseCatalogEnvelope: Codable, Equatable, Sendable {
    public var format: String
    public var version: Int
    /// ISO8601 の文字列。Date にすると共有コアが日付書式の API を必要とし、
    /// ADR-0079 で外した Foundation の国際化機能へ戻ってしまう
    public var exportedAt: String
    public var exercises: [ExerciseCatalogEntry]
    public var muscles: [MuscleCatalogEntry]

    public init(exportedAt: String,
                exercises: [ExerciseCatalogEntry],
                muscles: [MuscleCatalogEntry]) {
        self.format = ExerciseCatalogSchemaVersion.format
        self.version = ExerciseCatalogSchemaVersion.current
        self.exportedAt = exportedAt
        self.exercises = exercises
        self.muscles = muscles
    }
}
