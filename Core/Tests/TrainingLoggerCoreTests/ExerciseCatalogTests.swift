import XCTest
@testable import TrainingLoggerCore

/// ADR-0080: 種目カタログの形と、既知種目の判定規則
final class ExerciseCatalogTests: XCTestCase {

    func testCatalogEnvelopeRoundTrips() throws {
        let envelope = ExerciseCatalogEnvelope(
            exportedAt: "2026-08-14T10:00:00Z",
            exercises: [
                ExerciseCatalogEntry(name: "ベンチプレス", uuid: "u-bench", kind: "strength"),
                ExerciseCatalogEntry(name: "ジョグ", kind: "running"),
            ],
            muscles: [MuscleCatalogEntry(key: "pecs", name: "大胸筋")]
        )

        let data = try JSONEncoder().encode(envelope)
        let decoded = try JSONDecoder().decode(ExerciseCatalogEnvelope.self, from: data)

        XCTAssertEqual(decoded, envelope)
        XCTAssertEqual(decoded.format, "traininglogger.catalog")
        XCTAssertEqual(decoded.version, 1)
        XCTAssertNil(decoded.exercises[1].uuid)
    }

    /// Swift が生成した実物を JS 側（test-catalog.mjs）も読めることを固定する。
    /// 片側だけ形を変えると、生成できるのに Web で読めない JSON ができる。
    ///
    /// 更新は `WRITE_CATALOG_FIXTURE=1 swift test` で行う。
    func testFixtureMatchesEncoderOutput() throws {
        let envelope = ExerciseCatalogEnvelope(
            exportedAt: "2026-08-14T10:00:00Z",
            exercises: [
                ExerciseCatalogEntry(name: "インクラインベンチプレス", uuid: "u-incline", kind: "strength"),
                ExerciseCatalogEntry(name: "ジョグ", uuid: "u-jog", kind: "running"),
                ExerciseCatalogEntry(name: "旧・レッグプレス", uuid: "u-legpress", kind: "strength",
                                     archived: true),
                ExerciseCatalogEntry(name: "自転車通勤", kind: "cycling"),
            ],
            muscles: [
                MuscleCatalogEntry(key: "pecs", name: "大胸筋"),
                MuscleCatalogEntry(key: "quads", name: "大腿四頭筋"),
            ]
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let json = try XCTUnwrap(String(data: try encoder.encode(envelope), encoding: .utf8))

        if ProcessInfo.processInfo.environment["WRITE_CATALOG_FIXTURE"] != nil {
            try (json + "\n").write(to: Self.fixtureURL, atomically: true, encoding: .utf8)
        }

        let stored = try String(contentsOf: Self.fixtureURL, encoding: .utf8)
        XCTAssertEqual(
            stored.trimmingCharacters(in: .whitespacesAndNewlines),
            json.trimmingCharacters(in: .whitespacesAndNewlines),
            "fixtures-exercise-catalog.json が古い。WRITE_CATALOG_FIXTURE=1 swift test で更新する"
        )
    }

    /// web/ 直下の fixture（JS のテストが同じファイルを読む）
    private static let fixtureURL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()   // TrainingLoggerCoreTests
        .deletingLastPathComponent()   // Tests
        .deletingLastPathComponent()   // Core
        .deletingLastPathComponent()   // web
        .appendingPathComponent("fixtures-exercise-catalog.json")

    func testMissingExerciseNamesReportsUnknownName() {
        let def = makeDef(slots: [
            BuilderSlot(id: "s1", label: "枠", exerciseName: "存在しない種目"),
        ])

        XCTAssertEqual(
            CoreValidation.missingExerciseNames(def, knownNames: ["ベンチプレス"]),
            ["存在しない種目"]
        )
    }

    /// アプリのインポート（ProgramTransfer.importJSON）は uuid 一致を優先する。
    /// 同じ規則にしていないと、改名した種目が Web だけエラーになる
    func testKnownUuidAllowsRenamedExercise() {
        let def = makeDef(slots: [
            BuilderSlot(
                id: "s1",
                label: "枠",
                exerciseUuid: "u-bench",
                exerciseName: "旧ベンチプレス"
            ),
        ])

        XCTAssertEqual(
            CoreValidation.missingExerciseNames(
                def,
                knownNames: ["ベンチプレス"],
                knownUuids: ["u-bench"]
            ),
            []
        )
        XCTAssertEqual(
            CoreValidation.missingExerciseNames(def, knownNames: ["ベンチプレス"]),
            ["旧ベンチプレス"],
            "uuid を渡さない呼び出しは従来どおり名前だけで判定する"
        )
    }

    func testUnknownUuidFallsBackToName() {
        let def = makeDef(slots: [
            BuilderSlot(
                id: "s1",
                label: "枠",
                exerciseUuid: "u-deleted",
                exerciseName: "ベンチプレス"
            ),
        ])

        XCTAssertEqual(
            CoreValidation.missingExerciseNames(
                def,
                knownNames: ["ベンチプレス"],
                knownUuids: ["u-bench"]
            ),
            []
        )
    }

    /// exerciseName = nil の条件枠は採用時に選ぶので対象外
    func testConditionSlotIsNotMissing() {
        let def = makeDef(slots: [
            BuilderSlot(id: "s1", label: "枠", muscleKeys: ["pecs"]),
        ])

        XCTAssertEqual(
            CoreValidation.missingExerciseNames(def, knownNames: [], knownUuids: []),
            []
        )
    }

    private func makeDef(slots: [BuilderSlot]) -> BuilderDef {
        var def = BuilderDef(name: "カタログ検証")
        def.slots = slots
        return def
    }
}
