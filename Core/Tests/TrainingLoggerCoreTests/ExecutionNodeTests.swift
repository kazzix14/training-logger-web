import XCTest
@testable import TrainingLoggerCore

final class ExecutionNodeTests: XCTestCase {
    func testRepeatMaterializationExpandsWithStableIDs() throws {
        let work = PerformNode(
            id: "work",
            activity: .requirement(
                slotID: "run",
                requirement: .fact(.kind(.running)),
                distinctGroup: nil
            ),
            prescription: .running(
                RunningPrescription(
                    distance: .exact(.init(400, unit: .meters))
                )
            )
        )
        let recovery = RestNode(
            id: "recovery",
            duration: .exact(.init(90, unit: .seconds))
        )
        let template = ExecutionNode.repeatNode(
            id: "intervals",
            count: 2,
            node: .sequence(
                id: "rep",
                nodes: [.perform(work), .rest(recovery)]
            )
        )

        let first = try template.materialized(
            activityIDsBySlotID: ["run": "activity-running"]
        )
        let second = try template.materialized(
            activityIDsBySlotID: ["run": "activity-running"]
        )

        XCTAssertEqual(first, second)
        XCTAssertEqual(first.flattened.count, 4)

        let ids = first.flattened.map { node -> String in
            switch node {
            case .perform(let perform):
                return perform.id
            case .rest(let rest):
                return rest.id
            case .sequence:
                return "unexpected-sequence"
            }
        }
        XCTAssertEqual(
            ids,
            [
                "intervals/1/rep/work",
                "intervals/1/rep/recovery",
                "intervals/2/rep/work",
                "intervals/2/rep/recovery",
            ]
        )

        guard case .perform(let firstPerform) = first.flattened[0] else {
            return XCTFail("最初の具体ノードがperformではありません")
        }
        XCTAssertEqual(firstPerform.activityID, "activity-running")
    }

    func testMaterializationRejectsMissingSlotChoice() {
        let template = ExecutionNode.perform(
            PerformNode(
                id: "work",
                activity: .requirement(
                    slotID: "run",
                    requirement: .fact(.kind(.running)),
                    distinctGroup: nil
                ),
                prescription: .running(RunningPrescription())
            )
        )

        XCTAssertThrowsError(
            try template.materialized(activityIDsBySlotID: [:])
        ) { error in
            XCTAssertEqual(
                error as? ExecutionMaterializationError,
                .missingSlotChoice("run")
            )
        }
    }

    func testMaterializationRejectsNegativeRepeatCount() {
        let template = ExecutionNode.repeatNode(
            id: "invalid",
            count: -1,
            node: .rest(RestNode(id: "rest"))
        )

        XCTAssertThrowsError(
            try template.materialized(activityIDsBySlotID: [:])
        ) { error in
            XCTAssertEqual(
                error as? ExecutionMaterializationError,
                .invalidRepeatCount(id: "invalid", count: -1)
            )
        }
    }
}
