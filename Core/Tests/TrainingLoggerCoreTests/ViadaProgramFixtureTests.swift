import XCTest
@testable import TrainingLoggerCore

final class ViadaProgramFixtureTests: XCTestCase {
    func testStandardAndTaperFixturesCompileAndRoundTrip() throws {
        for def in [
            ProgramFixtureCatalog.viadaStrength5KStandard(),
            ProgramFixtureCatalog.viadaStrength5KTaper(),
        ] {
            let output = ProgramBuilderCompiler.compile(def)
            XCTAssertTrue(output.issues.isEmpty, "\(def.name): \(output.issues)")
            XCTAssertEqual(output.hsm.root.leaves.count, 2)
            XCTAssertEqual(def.phases.first?.days.count, 6)
            XCTAssertTrue(CoreValidation.plausibilityFindings(def).isEmpty)

            let data = try JSONEncoder().encode(
                ProgramTransferEnvelope(program: def))
            XCTAssertTrue(
                CoreValidation.validate(
                    envelopeJSON: data,
                    knownExerciseNames: []).isEmpty)
            let decoded = try JSONDecoder().decode(
                ProgramTransferEnvelope.self,
                from: data)
            XCTAssertEqual(decoded.program, def)
        }
    }

    func testStandardFixtureKeepsTypedStrengthAndRunningRanges() throws {
        let def = ProgramFixtureCatalog.viadaStrength5KStandard()
        let phase = try XCTUnwrap(def.phases.first)
        let allTargets = phase.days.flatMap(\.groups)
            .flatMap(\.setGroups)
            .flatMap(\.targets)

        let strength = try XCTUnwrap(allTargets.compactMap { target -> StrengthPrescription? in
            guard case .strength(let prescription) = target.activityPrescription
            else { return nil }
            return prescription
        }.first)
        guard case .range(let setLower, let setUpper)? = strength.sets,
              case .range(let repLower, let repUpper) = strength.repetitions
        else {
            return XCTFail("ME/HYP/DEのセット・回数範囲がありません")
        }
        XCTAssertEqual(setLower.unit, .count)
        XCTAssertEqual(setUpper.unit, .count)
        XCTAssertEqual(repLower.unit, .count)
        XCTAssertEqual(repUpper.unit, .count)
        XCTAssertEqual(strength.relativeLoad?.multiplier.representativeValue?.unit, .ratio)

        let running = allTargets.compactMap { target -> RunningPrescription? in
            guard case .running(let prescription) = target.activityPrescription
            else { return nil }
            return prescription
        }
        let nt = try XCTUnwrap(running.first {
            $0.workoutLabel?.contains("10×1200m") == true
        })
        XCTAssertEqual(
            nt.distance?.representativeValue?.converted(to: .kilometers)?.value,
            1.2)
        guard case .relativeToBaseline(let key, let multiplier) = nt.pace else {
            return XCTFail("NTのthreshold相対ペースがありません")
        }
        XCTAssertEqual(key, "running.thresholdSpeed")
        XCTAssertEqual(multiplier.representativeValue?.value, 0.9)

        let lsd = try XCTUnwrap(running.first {
            $0.workoutLabel == "LSD Level 2"
        })
        XCTAssertEqual(
            lsd.duration?.representativeValue?.converted(to: .minutes)?.value,
            60)
    }

    func testLowerPrimaryPushAndHingeRotateEveryWeek() throws {
        let output = ProgramBuilderCompiler.compile(
            ProgramFixtureCatalog.viadaStrength5KStandard())
        let leaves = output.hsm.root.leaves
        XCTAssertEqual(leaves.map(\.id), ["standard@0", "standard@1"])

        func slots(in leaf: LeafPhaseDef, dayLabel: String) throws -> [String] {
            let day = try XCTUnwrap(
                leaf.days.first { $0.label.contains(dayLabel) })
            return day.blocks
                .flatMap(\.sets)
                .flatMap(\.records)
                .map(\.slotId)
        }

        let firstME = try slots(in: leaves[0], dayLabel: "Day 2")
        let secondME = try slots(in: leaves[1], dayLabel: "Day 2")
        let firstDE = try slots(in: leaves[0], dayLabel: "Day 5")
        let secondDE = try slots(in: leaves[1], dayLabel: "Day 5")

        XCTAssertTrue(firstME.contains("lower_primary_push"))
        XCTAssertTrue(secondME.contains("lower_primary_hinge"))
        XCTAssertTrue(firstDE.contains("lower_primary_hinge"))
        XCTAssertTrue(secondDE.contains("lower_primary_push"))
    }

    func testTypedPrescriptionRejectsMissingBaselineAndInvertedRange() throws {
        var def = ProgramFixtureCatalog.viadaStrength5KStandard()
        var target = def.phases[0].days[0].groups[0].setGroups[0].targets[0]
        target.activityPrescription = .strength(StrengthPrescription(
            sets: .range(
                lower: .init(3, unit: .count),
                upper: .init(1, unit: .count)),
            relativeLoad: StrengthRelativeLoadPrescription(
                baselineKey: " ",
                multiplier: .exact(.init(0.9, unit: .ratio))),
            repetitions: .exact(.init(5, unit: .count))))
        def.phases[0].days[0].groups[0].setGroups[0].targets[0] = target

        let data = try JSONEncoder().encode(
            ProgramTransferEnvelope(program: def))
        let findings = CoreValidation.validate(
            envelopeJSON: data,
            knownExerciseNames: [])
        XCTAssertTrue(findings.contains {
            $0.contains("セット数は下限を上限以下")
        })
        XCTAssertTrue(findings.contains {
            $0.contains("相対重量には基準キー")
        })
    }
}
