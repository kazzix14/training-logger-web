import XCTest
@testable import TrainingLoggerCore

final class MultiSessionBuilderTests: XCTestCase {
    func testCompilerSeparatesGroupsIntoExplicitSessions() throws {
        let firstEntry = BuilderEntry(id: "morning-entry", slotId: "lift")
        let secondEntry = BuilderEntry(id: "evening-entry", slotId: "run")
        let definition = BuilderDef(
            name: "two sessions",
            slots: [
                BuilderSlot(id: "lift", label: "lift"),
                BuilderSlot(
                    id: "run",
                    label: "run",
                    activityRequirement: .fact(.kind(.running))
                ),
            ],
            phases: [
                BuilderPhase(
                    id: "main",
                    label: "main",
                    days: [
                        BuilderDay(
                            id: "day",
                            label: "day",
                            groups: [
                                BuilderGroup(
                                    id: "morning-group",
                                    entries: [firstEntry],
                                    setGroups: [
                                        BuilderSetGroup(
                                            id: "morning-sets",
                                            count: .fixed(1),
                                            targets: [
                                                BuilderTargetLine(
                                                    entryId: firstEntry.id,
                                                    reps: .fixed(5),
                                                    load: .fixed(40)
                                                ),
                                            ]
                                        ),
                                    ],
                                    sessionID: "morning"
                                ),
                                BuilderGroup(
                                    id: "evening-group",
                                    entries: [secondEntry],
                                    setGroups: [
                                        BuilderSetGroup(
                                            id: "evening-sets",
                                            count: .fixed(1),
                                            targets: [
                                                BuilderTargetLine(
                                                    entryId: secondEntry.id,
                                                    activityPrescription: .running(
                                                        RunningPrescription(
                                                            distance: .exact(
                                                                .init(5, unit: .kilometers)
                                                            )
                                                        )
                                                    )
                                                ),
                                            ]
                                        ),
                                    ],
                                    sessionID: "evening"
                                ),
                            ],
                            sessions: [
                                BuilderSession(
                                    id: "morning",
                                    label: "Morning",
                                    pill: "Strength"
                                ),
                                BuilderSession(
                                    id: "evening",
                                    label: "Evening",
                                    pill: "Run",
                                    execution: .rest(
                                        RestNode(
                                            id: "cooldown",
                                            duration: .exact(.init(5, unit: .minutes))
                                        )
                                    )
                                ),
                            ]
                        ),
                    ]
                ),
            ]
        )

        let output = ProgramBuilderCompiler.compile(definition)

        XCTAssertTrue(output.issues.isEmpty, "\(output.issues)")
        let day = try XCTUnwrap(output.hsm.root.leaves.first?.days.first)
        let sessions = try XCTUnwrap(day.sessions)
        XCTAssertEqual(sessions.map(\.id), ["morning", "evening"])
        XCTAssertEqual(sessions.map(\.blocks.count), [1, 1])
        XCTAssertNil(day.execution)
        XCTAssertNotNil(sessions[1].execution)
    }

    func testCompilerRejectsUnknownAndDuplicateSessionIDs() {
        let entry = BuilderEntry(id: "entry", slotId: "lift")
        let definition = BuilderDef(
            name: "invalid sessions",
            slots: [BuilderSlot(id: "lift", label: "lift")],
            phases: [
                BuilderPhase(
                    id: "main",
                    label: "main",
                    days: [
                        BuilderDay(
                            id: "day",
                            label: "day",
                            groups: [
                                BuilderGroup(
                                    id: "group",
                                    entries: [entry],
                                    sessionID: "missing"
                                ),
                            ],
                            sessions: [
                                BuilderSession(id: "duplicate", label: "One"),
                                BuilderSession(id: "duplicate", label: "Two"),
                            ]
                        ),
                    ]
                ),
            ]
        )

        let issues = ProgramBuilderCompiler.compile(definition).issues
        let messages = issues.map(\.description).joined(separator: "\n")
        XCTAssertTrue(messages.contains("重複"), messages)
        XCTAssertTrue(messages.contains("missing"), messages)
    }
}
