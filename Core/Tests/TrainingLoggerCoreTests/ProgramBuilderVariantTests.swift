import XCTest
@testable import TrainingLoggerCore

final class ProgramBuilderVariantTests: XCTestCase {
    func testCompleteVariantOverridesAndIndependentState() throws {
        var def = BuilderDef(name: "vertical pull")
        def.variables = [
            BuilderVariable(
                id: "pull_load",
                label: "start load",
                fallbackValue: 10,
                slotId: "pullup"),
        ]
        def.slots = [
            BuilderSlot(id: "pullup", label: "pull-up"),
            BuilderSlot(id: "lat", label: "lat pulldown"),
        ]
        let entry = BuilderEntry(
            id: "vertical_pull",
            variants: [
                BuilderEntryVariant(id: "pullup", slotId: "pullup"),
                BuilderEntryVariant(
                    id: "lat",
                    slotId: "lat",
                    targetOverrides: [
                        BuilderVariantTargetOverride(
                            setGroupId: "work",
                            reps: .value(.fixed(10)),
                            load: .none,
                            measureId: .none),
                    ],
                    progressionRules: .none),
            ])
        def.phases = [
            BuilderPhase(
                id: "p",
                label: "week",
                days: [
                    BuilderDay(
                        id: "d",
                        label: "day",
                        groups: [
                            BuilderGroup(
                                id: "g",
                                entries: [entry],
                                setGroups: [
                                    BuilderSetGroup(
                                        id: "work",
                                        count: .fixed(3),
                                        targets: [
                                            BuilderTargetLine(
                                                entryId: entry.id,
                                                reps: .fixed(5),
                                                load: .variable(varId: "pull_load"),
                                                measureId: "pull_reps"),
                                        ]),
                                ]),
                        ]),
                ],
                endRules: [
                    .progressIfReached(
                        id: "progress",
                        varId: "pull_load",
                        measureId: "pull_reps",
                        target: .fixed(5),
                        increment: 2.5),
                ]),
        ]

        let output = ProgramBuilderCompiler.compile(def)
        XCTAssertTrue(output.issues.isEmpty, "\(output.issues)")
        XCTAssertEqual(output.hsm.inputs.count, 1)
        XCTAssertTrue(
            output.hsm.inputs[0].key.contains("pullup"),
            output.hsm.inputs[0].key)
        XCTAssertEqual(output.hsm.inputs[0].slotId, "pullup")

        let leaves = output.hsm.root.leaves
        let pullup = try XCTUnwrap(
            leaves[0].days.first?.blocks.first?.sets.last?.records.first)
        let lat = try XCTUnwrap(
            leaves[1].days.first?.blocks.first?.sets.last?.records.first)
        XCTAssertNotNil(pullup.bind)
        XCTAssertNotNil(pullup.scheme.first { $0.fieldKey == "core.weight" })
        XCTAssertNil(lat.bind)
        XCTAssertNil(lat.scheme.first { $0.fieldKey == "core.weight" })
        XCTAssertTrue(leaves[1].transitions.first?.actions.isEmpty ?? false)
        XCTAssertEqual(output.hsm.previewBindings?.map(\.phaseId), ["p@0"])
    }

    func testInheritedProgressionIsNamespacedPerVariant() throws {
        var def = BuilderDef(name: "rotation state")
        def.variables = [
            BuilderVariable(
                id: "load",
                label: "load",
                fallbackValue: 20,
                slotId: "a"),
            BuilderVariable(
                id: "load_b",
                label: "load B",
                fallbackValue: 30,
                slotId: "b"),
            BuilderVariable(
                id: "unrelated",
                label: "unrelated input",
                fallbackValue: 1),
        ]
        def.slots = [
            BuilderSlot(id: "a", label: "A"),
            BuilderSlot(id: "b", label: "B"),
        ]
        def.phases = [
            BuilderPhase(
                id: "p",
                label: "week",
                days: [
                    BuilderDay(
                        id: "d",
                        label: "day",
                        groups: [
                            BuilderGroup(
                                id: "g",
                                entries: [
                                    BuilderEntry(
                                        id: "e",
                                        variants: [
                                            BuilderEntryVariant(id: "a", slotId: "a"),
                                            BuilderEntryVariant(
                                                id: "b",
                                                slotId: "b",
                                                targetOverrides: [
                                                    BuilderVariantTargetOverride(
                                                        setGroupId: "work",
                                                        load: .value(.variable(
                                                            varId: "load_b"))),
                                                ]),
                                        ]),
                                ],
                                setGroups: [
                                    BuilderSetGroup(
                                        id: "work",
                                        targets: [
                                            BuilderTargetLine(
                                                entryId: "e",
                                                load: .variable(varId: "load"),
                                                measureId: "result"),
                                        ]),
                                ]),
                        ]),
                ],
                endRules: [
                    .progressIfReached(
                        id: "progress",
                        varId: "load",
                        measureId: "result",
                        target: .fixed(5),
                        increment: 2.5),
                ]),
        ]

        let output = ProgramBuilderCompiler.compile(def)
        XCTAssertTrue(output.issues.isEmpty, "\(output.issues)")
        XCTAssertEqual(output.hsm.inputs.count, 3)
        XCTAssertEqual(Set(output.hsm.inputs.compactMap(\.slotId)), ["a", "b"])
        XCTAssertEqual(Set(output.hsm.inputs.map(\.key)).count, 3)
        XCTAssertTrue(output.hsm.inputs.contains { $0.key == "unrelated" })
        let inputBySlot = Dictionary(
            uniqueKeysWithValues: output.hsm.inputs.compactMap { input in
                input.slotId.map { ($0, input.key) }
            })

        let leaves = output.hsm.root.leaves
        let firstBind = leaves[0].days.first?.blocks.first?
            .sets.last?.records.first?.bind
        let secondBind = leaves[1].days.first?.blocks.first?
            .sets.last?.records.first?.bind
        XCTAssertNotNil(firstBind)
        XCTAssertNotNil(secondBind)
        XCTAssertNotEqual(firstBind, secondBind)
        XCTAssertNotEqual(
            leaves[0].transitions.first?.actions.first?.name,
            leaves[1].transitions.first?.actions.first?.name)
        XCTAssertEqual(
            leaves[0].transitions.first?.actions.first?.name,
            inputBySlot["a"])
        XCTAssertEqual(
            leaves[1].transitions.first?.actions.first?.name,
            inputBySlot["b"])
        XCTAssertEqual(
            Set(output.hsm.previewBindings?.map(\.phaseId) ?? []),
            ["p@0", "p@1"])
    }

    func testPlausibilityValidationIncludesVariantOverrides() {
        var def = BuilderDef(name: "invalid variant")
        def.slots = [
            BuilderSlot(
                id: "run",
                label: "run",
                activityRequirement: .fact(.kind(.running))),
        ]
        def.phases = [
            BuilderPhase(
                id: "p",
                label: "week",
                days: [
                    BuilderDay(
                        id: "d",
                        label: "day",
                        groups: [
                            BuilderGroup(
                                id: "g",
                                entries: [
                                    BuilderEntry(
                                        id: "e",
                                        variants: [
                                            BuilderEntryVariant(
                                                id: "run",
                                                slotId: "run",
                                                targetOverrides: [
                                                    BuilderVariantTargetOverride(
                                                        setGroupId: "work",
                                                        load: .value(.fixed(999)),
                                                        activityPrescription: .value(.running(
                                                            RunningPrescription(
                                                                distance: .exact(.init(
                                                                    10,
                                                                    unit: .minutes)))))),
                                                ],
                                                progressionRules: .value([
                                                    .always(
                                                        id: "invalid-step",
                                                        varId: "load",
                                                        increment: 100),
                                                ])),
                                        ]),
                                ],
                                setGroups: [
                                    BuilderSetGroup(
                                        id: "work",
                                        targets: [
                                            BuilderTargetLine(
                                                entryId: "e",
                                                activityPrescription: .running(
                                                    RunningPrescription())),
                                        ]),
                                ]),
                        ]),
                ])
        ]

        let findings = CoreValidation.plausibilityFindings(def)

        XCTAssertTrue(findings.contains { $0.contains("999") })
        XCTAssertTrue(findings.contains { $0.contains("距離") })
        XCTAssertTrue(findings.contains { $0.contains("100") })
    }

    func testPlausibilityAllowsNegativeAssistanceLoad() {
        let def = BuilderDef(
            name: "assisted pull-up",
            slots: [
                BuilderSlot(id: "pull-up", label: "pull-up"),
            ],
            phases: [
                BuilderPhase(
                    id: "p",
                    label: "week",
                    days: [
                        BuilderDay(
                            id: "d",
                            label: "day",
                            groups: [
                                BuilderGroup(
                                    id: "g",
                                    entries: [
                                        BuilderEntry(id: "e", slotId: "pull-up"),
                                    ],
                                    setGroups: [
                                        BuilderSetGroup(
                                            id: "work",
                                            targets: [
                                                BuilderTargetLine(
                                                    entryId: "e",
                                                    load: .fixed(-20)),
                                            ]),
                                    ]),
                            ]),
                    ])
            ])

        XCTAssertTrue(CoreValidation.plausibilityFindings(def).isEmpty)
    }
}
