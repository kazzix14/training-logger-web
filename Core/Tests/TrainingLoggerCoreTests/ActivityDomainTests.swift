import XCTest
@testable import TrainingLoggerCore

final class ActivityDomainTests: XCTestCase {
    func testQuantityConversionPreservesDimension() {
        let fiveKilometers = TypedQuantity(5, unit: .kilometers)

        XCTAssertEqual(fiveKilometers.converted(to: .meters)?.value, 5_000)
        XCTAssertNil(fiveKilometers.converted(to: .kilograms))
    }

    func testRunningDurationUsesDistanceAndAbsolutePace() {
        let prescription = RunningPrescription(
            distance: .exact(TypedQuantity(5, unit: .kilometers)),
            pace: .absolute(.exact(TypedQuantity(5, unit: .minutesPerKilometer)))
        )

        let estimate = ActivityMath.runningDuration(
            prescription: prescription,
            definition: RunningDefinition(),
            policy: EstimationPolicy()
        )

        XCTAssertEqual(estimate.seconds, 1_500)
        XCTAssertEqual(estimate.provenance, .prescribedDistanceAndPace)
    }

    func testRunningDurationFallsBackToActivityThenTypeDefault() {
        let prescription = RunningPrescription(
            distance: .exact(TypedQuantity(10, unit: .kilometers))
        )
        let activityEstimate = ActivityMath.runningDuration(
            prescription: prescription,
            definition: RunningDefinition(
                defaultPace: TypedQuantity(6, unit: .minutesPerKilometer)
            ),
            policy: EstimationPolicy(
                runningDefaultPace: TypedQuantity(7, unit: .minutesPerKilometer)
            )
        )
        XCTAssertEqual(activityEstimate.seconds, 3_600)
        XCTAssertEqual(activityEstimate.provenance, .activityDefaultPace)

        let typeEstimate = ActivityMath.runningDuration(
            prescription: prescription,
            definition: RunningDefinition(),
            policy: EstimationPolicy(
                runningDefaultPace: TypedQuantity(7, unit: .minutesPerKilometer)
            )
        )
        XCTAssertEqual(typeEstimate.seconds, 4_200)
        XCTAssertEqual(typeEstimate.provenance, .typeDefaultPace)
    }

    func testRelativePaceUsesBaselineSpeedMultiplier() {
        let prescription = RunningPrescription(
            distance: .exact(TypedQuantity(1, unit: .kilometers)),
            pace: .relativeToBaseline(
                key: "threshold",
                speedMultiplier: .exact(TypedQuantity(1.2, unit: .ratio))
            )
        )

        let estimate = ActivityMath.runningDuration(
            prescription: prescription,
            definition: RunningDefinition(),
            policy: EstimationPolicy(),
            baselines: [
                "threshold": TypedQuantity(6, unit: .minutesPerKilometer),
            ]
        )

        XCTAssertEqual(estimate.seconds ?? 0, 300, accuracy: 0.0001)
    }

    func testRequirementTreeHasNoFallback() {
        let requirement = ActivityRequirement.all([
            .fact(.kind(.running)),
            .not(.fact(.tagID("indoor"))),
        ])

        XCTAssertTrue(requirement.matches(ActivityFacts(kind: .running)))
        XCTAssertFalse(requirement.matches(ActivityFacts(
            kind: .running,
            tagIDs: ["indoor"]
        )))
        XCTAssertFalse(requirement.matches(ActivityFacts(kind: .strength)))
        XCTAssertEqual(requirement.requiredKind, .running)
    }

    func testEffectiveLoadSupportsAssistance() {
        XCTAssertEqual(
            ActivityMath.effectiveLoad(
                enteredLoadKilograms: -20,
                bodyweightKilograms: 80,
                bodyweightFraction: 1
            ),
            60
        )
    }

    func testVersionTwoEnvelopeRoundTripsBundledActivities() throws {
        let envelope = ProgramTransferEnvelope(
            program: BuilderDef(name: "test"),
            bundledActivities: [
                BundledActivityDefinition(
                    id: "running",
                    name: "ランニング",
                    definition: .running(RunningDefinition())
                ),
            ]
        )

        let data = try JSONEncoder().encode(envelope)
        let decoded = try JSONDecoder().decode(ProgramTransferEnvelope.self, from: data)

        XCTAssertEqual(decoded.version, 2)
        XCTAssertEqual(decoded.bundledActivities?.first?.name, "ランニング")
    }
}
