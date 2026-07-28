import XCTest
@testable import TrainingLoggerCore

final class ProgramExpressionValidatorTests: XCTestCase {
    func testRejectsDistanceVariableUsedAsLoad() {
        let program = makeProgram(
            inputDimension: .distance,
            fieldKey: "core.weight"
        )

        let issues = ProgramExpressionValidator.validate(program)

        XCTAssertTrue(
            issues.contains {
                $0.message.contains("load が必要ですが distance")
            }
        )
    }

    func testAcceptsContextuallyTypedLiteralAddedToLoad() {
        var program = makeProgram(
            inputDimension: .load,
            fieldKey: "core.weight"
        )
        if case .leaf(var leaf) = program.root {
            leaf.days[0].blocks[0].sets[0].records[0].scheme[0].expr = .binary(
                .add,
                .variable("input"),
                .lit(2.5)
            )
            program.root = .leaf(leaf)
        }

        XCTAssertEqual(ProgramExpressionValidator.validate(program), [])
    }

    func testBuilderCompilationSurfacesDimensionalIssue() {
        var builder = BuilderDef(name: "型エラー")
        builder.variables = [
            BuilderVariable(
                id: "distance",
                label: "距離",
                dimension: .distance,
                unit: "km",
                fallbackValue: 5
            ),
        ]
        builder.slots = [
            BuilderSlot(
                id: "slot",
                label: "種目",
                exerciseName: "スクワット"
            ),
        ]
        builder.phases = [
            BuilderPhase(
                id: "phase",
                label: "Phase",
                days: [
                    BuilderDay(
                        id: "day",
                        label: "Day",
                        groups: [
                            BuilderGroup(
                                id: "group",
                                entries: [
                                    BuilderEntry(id: "entry", slotId: "slot"),
                                ],
                                setGroups: [
                                    BuilderSetGroup(
                                        id: "sets",
                                        targets: [
                                            BuilderTargetLine(
                                                entryId: "entry",
                                                load: .variable(varId: "distance")
                                            ),
                                        ]
                                    ),
                                ]
                            ),
                        ]
                    ),
                ]
            ),
        ]

        let output = ProgramBuilderCompiler.compile(builder)

        XCTAssertTrue(
            output.issues.contains {
                if case .invalidExpression = $0 { return true }
                return false
            }
        )
    }

    private func makeProgram(
        inputDimension: QuantityDimension,
        fieldKey: String
    ) -> ProgramHSMDef {
        ProgramHSMDef(
            inputs: [
                ProgramInputDef(
                    key: "input",
                    label: "入力",
                    dimension: inputDimension,
                    unit: "unit",
                    fallbackValue: 1
                ),
            ],
            initActions: [
                VarAssign(name: "input", expr: .variable("input")),
            ],
            root: .leaf(
                LeafPhaseDef(
                    id: "phase",
                    days: [
                        DayTemplateDef(
                            label: "Day",
                            dayPill: "",
                            blocks: [
                                BlockPlanTpl(
                                    sets: [
                                        SetPlanTpl(
                                            records: [
                                                RecordPlanTpl(
                                                    slotId: "slot",
                                                    side: nil,
                                                    scheme: [
                                                        SchemeTpl(
                                                            fieldKey: fieldKey,
                                                            kind: .exact,
                                                            expr: .variable("input")
                                                        ),
                                                    ],
                                                    bind: nil,
                                                    methodologyId: nil
                                                ),
                                            ]
                                        ),
                                    ]
                                ),
                            ]
                        ),
                    ],
                    transitions: []
                )
            )
        )
    }
}
