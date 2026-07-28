import Foundation

/// Alex Viada, The Ultimate Hybrid Athlete の表「STRENGTH + 5K」を
/// 共有Coreの型だけで表したfixture。iOSプリセットとWeb/Core検証の正にする。
public enum ProgramFixtureCatalog {
    public static let viadaStrength5KStandardKey = "viada-strength-5k"
    public static let viadaStrength5KTaperKey = "viada-strength-5k-taper"

    public static func fixture(key: String) -> BuilderDef? {
        switch key {
        case viadaStrength5KStandardKey:
            return viadaStrength5KStandard()
        case viadaStrength5KTaperKey:
            return viadaStrength5KTaper()
        default:
            return nil
        }
    }

    public static func viadaStrength5KStandard() -> BuilderDef {
        var def = baseDefinition(
            name: "Viada STRENGTH + 5K",
            note: """
            The Ultimate Hybrid Athlete「STRENGTH + 5K」標準版。
            ME/DE/HYPは同書のセット・回数・training 1RM比率範囲を保持する。
            下半身のprimary push / hingeは2週でMEとDEを交互にする。
            """)
        def.phases = [
            BuilderPhase(
                id: "standard",
                label: "Standard",
                windowDays: 7,
                days: [
                    BuilderDay(
                        id: "standard_d1",
                        label: "Day 1 · Upper ME + MLSS+",
                        pill: "D1",
                        groups: [
                            strengthGroup(
                                "s_d1_push",
                                entries: [.single("push", slot: "upper_primary_push")],
                                mode: .me),
                            strengthGroup(
                                "s_d1_pull",
                                entries: [.single("pull", slot: "upper_primary_pull")],
                                mode: .me,
                                qualifier: "accessory"),
                            strengthGroup(
                                "s_d1_secondary",
                                entries: [.single("secondary", slot: "upper_secondary_push")],
                                mode: .de,
                                qualifier: "accessory"),
                            strengthGroup(
                                "s_d1_focused",
                                entries: [
                                    .single("pull", slot: "upper_focused_pull"),
                                    .single("push", slot: "upper_focused_push"),
                                ],
                                mode: .hyp,
                                qualifier: "accessory"),
                            runningGroup(
                                "s_d1_mlss",
                                prescription: RunningPrescription(
                                    pace: .zone(key: "viada.mlss-plus.level2"),
                                    workoutLabel: "MLSS+ Level 2"),
                                note: """
                                例: 2セット×4ラウンド
                                15秒@130% + 45秒@105% + 1分@VT1。
                                セット間は2分walk/recovery jog。
                                """),
                        ]),
                    BuilderDay(
                        id: "standard_d2",
                        label: "Day 2 · Lower ME",
                        pill: "D2",
                        groups: [
                            strengthGroup(
                                "s_d2_main",
                                entries: [
                                    .rotation(
                                        "main",
                                        slots: [
                                            ("push", "lower_primary_push"),
                                            ("hinge", "lower_primary_hinge"),
                                        ]),
                                ],
                                mode: .me),
                            strengthGroup(
                                "s_d2_secondary",
                                entries: [.single("hinge", slot: "lower_secondary_hinge")],
                                mode: .de,
                                qualifier: "accessory"),
                            strengthGroup(
                                "s_d2_accessory",
                                entries: [.single("lower", slot: "lower_accessory")],
                                mode: .hyp,
                                qualifier: "accessory"),
                        ]),
                    BuilderDay(
                        id: "standard_d3",
                        label: "Day 3 · Plyo + NT",
                        pill: "D3",
                        groups: [
                            runningGroup(
                                "s_d3_nt",
                                count: 10,
                                prescription: RunningPrescription(
                                    distance: exact(1.2, .kilometers),
                                    pace: relativePace(0.90),
                                    workoutLabel: "NT Level 3 · 10×1200m"),
                                note: """
                                先にplyometric warm-up。
                                各1200mはthreshold speedの90%、回復は走時間の50%。
                                """),
                        ]),
                    BuilderDay(
                        id: "standard_d4",
                        label: "Day 4 · Upper DE + VT1",
                        pill: "D4",
                        groups: [
                            strengthGroup(
                                "s_d4_push",
                                entries: [.single("push", slot: "upper_primary_push")],
                                mode: .de),
                            strengthGroup(
                                "s_d4_pull",
                                entries: [.single("pull", slot: "upper_primary_pull")],
                                mode: .de,
                                qualifier: "accessory"),
                            strengthGroup(
                                "s_d4_secondary",
                                entries: [.single("secondary", slot: "upper_secondary_push")],
                                mode: .hyp,
                                qualifier: "accessory"),
                            strengthGroup(
                                "s_d4_focused",
                                entries: [
                                    .single("pull", slot: "upper_focused_pull"),
                                    .single("push", slot: "upper_focused_push"),
                                ],
                                mode: .hyp,
                                qualifier: "accessory"),
                            runningGroup(
                                "s_d4_vt1",
                                prescription: RunningPrescription(
                                    duration: range(25, 30, .minutes),
                                    pace: .zone(key: "VT1"),
                                    workoutLabel: "VT1 Level 1"),
                                note: "回復に余裕がある場合の25〜30分。talk testでVT1を確認。"),
                        ]),
                    BuilderDay(
                        id: "standard_d5",
                        label: "Day 5 · Lower DE",
                        pill: "D5",
                        groups: [
                            strengthGroup(
                                "s_d5_main",
                                entries: [
                                    .rotation(
                                        "main",
                                        slots: [
                                            ("hinge", "lower_primary_hinge"),
                                            ("push", "lower_primary_push"),
                                        ]),
                                ],
                                mode: .de),
                            strengthGroup(
                                "s_d5_secondary",
                                entries: [.single("secondary", slot: "lower_secondary_push")],
                                mode: .hyp,
                                qualifier: "accessory"),
                            strengthGroup(
                                "s_d5_focused",
                                entries: [.single("focused", slot: "lower_focused_push")],
                                mode: .hyp,
                                qualifier: "accessory"),
                        ]),
                    BuilderDay(
                        id: "standard_d6",
                        label: "Day 6 · LSD",
                        pill: "D6",
                        groups: [
                            runningGroup(
                                "s_d6_lsd",
                                prescription: RunningPrescription(
                                    duration: exact(60, .minutes),
                                    pace: .zone(key: "VT1-or-below"),
                                    workoutLabel: "LSD Level 2"),
                                note: "mixed terrain。1時間VT1 runを採用したLevel 2例。"),
                        ]),
                ])
        ]
        return def
    }

    public static func viadaStrength5KTaper() -> BuilderDef {
        var def = baseDefinition(
            name: "Viada STRENGTH + 5K · Taper/Deload",
            note: """
            The Ultimate Hybrid Athlete「STRENGTH + 5K」taper/deload版。
            競技2週前から切り替える想定。5K前はtempo dayをrace pace repeatsにする。
            """)
        def.phases = [
            BuilderPhase(
                id: "taper",
                label: "Taper / Deload",
                windowDays: 7,
                days: [
                    BuilderDay(
                        id: "taper_d1",
                        label: "Day 1 · Upper + MLSS+",
                        pill: "D1",
                        groups: [
                            strengthGroup(
                                "t_d1_push",
                                entries: [.single("push", slot: "upper_primary_push")],
                                mode: .me),
                            strengthGroup(
                                "t_d1_pull",
                                entries: [.single("pull", slot: "upper_primary_pull")],
                                mode: .de,
                                qualifier: "accessory"),
                            strengthGroup(
                                "t_d1_focused",
                                entries: [
                                    .single("pull", slot: "upper_focused_pull"),
                                    .single("push", slot: "upper_focused_push"),
                                ],
                                mode: .hyp,
                                qualifier: "accessory"),
                            runningGroup(
                                "t_d1_mlss",
                                count: 6,
                                prescription: RunningPrescription(
                                    duration: exact(2, .minutes),
                                    pace: .zone(key: "viada.mlss-plus.level1"),
                                    workoutLabel: "MLSS+ Level 1 · 6 rounds"),
                                note: "各round: 15秒@130% + 45秒@105% + 1分@VT1。"),
                        ]),
                    BuilderDay(
                        id: "taper_d2",
                        label: "Day 2 · Lower",
                        pill: "D2",
                        groups: [
                            strengthGroup(
                                "t_d2_me",
                                entries: [
                                    .rotation(
                                        "main",
                                        slots: [
                                            ("push", "lower_primary_push"),
                                            ("hinge", "lower_primary_hinge"),
                                        ]),
                                ],
                                mode: .me),
                            strengthGroup(
                                "t_d2_de",
                                entries: [
                                    .rotation(
                                        "counterpart",
                                        slots: [
                                            ("hinge", "lower_primary_hinge"),
                                            ("push", "lower_primary_push"),
                                        ]),
                                ],
                                mode: .de,
                                qualifier: "accessory"),
                            strengthGroup(
                                "t_d2_accessory",
                                entries: [.single("lower", slot: "lower_accessory")],
                                mode: .hyp,
                                qualifier: "accessory"),
                        ]),
                    BuilderDay(
                        id: "taper_d3",
                        label: "Day 3 · Plyo + NT race tempo",
                        pill: "D3",
                        groups: [
                            runningGroup(
                                "t_d3_nt",
                                count: 2,
                                prescription: RunningPrescription(
                                    duration: exact(5, .minutes),
                                    pace: relativePace(1.05),
                                    workoutLabel: "5K race-specific NT Level 1"),
                                note: "先にplyometric warm-up。2×5分@105%、回復3〜5分。"),
                        ]),
                    BuilderDay(
                        id: "taper_d4",
                        label: "Day 4 · Upper DE",
                        pill: "D4",
                        groups: [
                            strengthGroup(
                                "t_d4_push",
                                entries: [.single("push", slot: "upper_primary_push")],
                                mode: .de),
                            strengthGroup(
                                "t_d4_pull",
                                entries: [.single("pull", slot: "upper_primary_pull")],
                                mode: .de,
                                qualifier: "accessory"),
                            strengthGroup(
                                "t_d4_focused",
                                entries: [
                                    .single("pull", slot: "upper_focused_pull"),
                                    .single("push", slot: "upper_focused_push"),
                                ],
                                mode: .hyp,
                                qualifier: "accessory"),
                        ]),
                    BuilderDay(
                        id: "taper_d5",
                        label: "Day 5 · Lower DE",
                        pill: "D5",
                        groups: [
                            strengthGroup(
                                "t_d5_main",
                                entries: [
                                    .rotation(
                                        "main",
                                        slots: [
                                            ("hinge", "lower_primary_hinge"),
                                            ("push", "lower_primary_push"),
                                        ]),
                                ],
                                mode: .de),
                            strengthGroup(
                                "t_d5_accessory",
                                entries: [.single("lower", slot: "lower_accessory")],
                                mode: .hyp,
                                qualifier: "accessory"),
                        ]),
                    BuilderDay(
                        id: "taper_d6",
                        label: "Day 6 · VT1",
                        pill: "D6",
                        groups: [
                            runningGroup(
                                "t_d6_vt1",
                                prescription: RunningPrescription(
                                    duration: range(25, 30, .minutes),
                                    pace: .zone(key: "VT1"),
                                    workoutLabel: "VT1 Level 1"),
                                note: "25〜30分。talk testでVT1を確認。"),
                        ]),
                ])
        ]
        return def
    }

    // MARK: - Shared structure

    private struct FixtureEntry {
        let id: String
        let variants: [(id: String, slotId: String)]

        static func single(_ id: String, slot: String) -> FixtureEntry {
            FixtureEntry(id: id, variants: [(id, slot)])
        }

        static func rotation(
            _ id: String,
            slots: [(id: String, slotId: String)]
        ) -> FixtureEntry {
            FixtureEntry(id: id, variants: slots)
        }
    }

    private struct StrengthMode: Equatable {
        let label: String
        let sets: ClosedRange<Int>
        let reps: ClosedRange<Int>
        let trainingMaxRatio: ClosedRange<Double>
        let rir: ClosedRange<Double>?

        static let me = StrengthMode(
            label: "ME",
            sets: 1...3,
            reps: 1...5,
            trainingMaxRatio: 0.90...1.00,
            rir: nil)
        static let de = StrengthMode(
            label: "DE",
            sets: 4...6,
            reps: 2...4,
            trainingMaxRatio: 0.70...0.80,
            rir: 3...4)
        static let hyp = StrengthMode(
            label: "HYP",
            sets: 3...4,
            reps: 6...12,
            trainingMaxRatio: 0...1,
            rir: 0...2)
    }

    private static func baseDefinition(name: String, note: String) -> BuilderDef {
        BuilderDef(
            name: name,
            note: note,
            variables: [],
            slots: [
                strengthSlot("upper_primary_push", "Upper · primary push"),
                strengthSlot("upper_primary_pull", "Upper · primary pull"),
                strengthSlot("upper_secondary_push", "Upper · secondary push"),
                strengthSlot("upper_focused_pull", "Upper · focused pull"),
                strengthSlot("upper_focused_push", "Upper · focused push"),
                strengthSlot("lower_primary_push", "Lower · primary push"),
                strengthSlot("lower_primary_hinge", "Lower · primary hinge"),
                strengthSlot("lower_secondary_hinge", "Lower · secondary hinge"),
                strengthSlot("lower_secondary_push", "Lower · secondary push"),
                strengthSlot("lower_accessory", "Lower · accessory"),
                strengthSlot("lower_focused_push", "Lower · focused push"),
                BuilderSlot(
                    id: "running",
                    label: "Running",
                    activityRequirement: .fact(.kind(.running))),
            ],
            phases: [])
    }

    private static func strengthSlot(_ id: String, _ label: String) -> BuilderSlot {
        BuilderSlot(
            id: id,
            label: label,
            activityRequirement: .fact(.kind(.strength)))
    }

    private static func strengthGroup(
        _ id: String,
        entries specs: [FixtureEntry],
        mode: StrengthMode,
        qualifier: String? = nil
    ) -> BuilderGroup {
        let entries = specs.map { spec in
            BuilderEntry(
                id: "\(id)_\(spec.id)",
                variants: spec.variants.map { variant in
                    BuilderEntryVariant(
                        id: "\(id)_\(spec.id)_\(variant.id)",
                        slotId: variant.slotId)
                },
                methodologyId: mode.rir == nil ? "percent1rm" : "rir")
        }
        let targets = entries.map { entry in
            BuilderTargetLine(
                entryId: entry.id,
                reps: .range(lo: mode.reps.lowerBound, hi: mode.reps.upperBound),
                extras: mode.rir.map {
                    [BuilderExtra(
                        fieldKey: "rir.rir",
                        kind: .range(lo: $0.lowerBound, hi: $0.upperBound))]
                } ?? [],
                note: [
                    mode.label,
                    qualifier,
                    "\(mode.sets.lowerBound)–\(mode.sets.upperBound)set",
                    mode == .hyp
                        ? "medium load"
                        : "\(Int(mode.trainingMaxRatio.lowerBound * 100))–\(Int(mode.trainingMaxRatio.upperBound * 100))% training 1RM",
                    "生成時は範囲下限。範囲内でセット追加可。",
                ]
                .compactMap { $0 }
                .joined(separator: " · "),
                activityPrescription: .strength(StrengthPrescription(
                    sets: range(
                        Double(mode.sets.lowerBound),
                        Double(mode.sets.upperBound),
                        .count),
                    relativeLoad: mode == .hyp
                        ? nil
                        : StrengthRelativeLoadPrescription(
                            baselineKey: "strength.training1RM",
                            multiplier: range(
                                mode.trainingMaxRatio.lowerBound,
                                mode.trainingMaxRatio.upperBound,
                                .ratio)),
                    repetitions: range(
                        Double(mode.reps.lowerBound),
                        Double(mode.reps.upperBound),
                        .count))))
        }
        return BuilderGroup(
            id: id,
            entries: entries,
            setGroups: [
                BuilderSetGroup(
                    id: "\(id)_sets",
                    count: .fixed(mode.sets.lowerBound),
                    targets: targets),
            ])
    }

    private static func runningGroup(
        _ id: String,
        count: Int = 1,
        prescription: RunningPrescription,
        note: String
    ) -> BuilderGroup {
        let entry = BuilderEntry(
            id: "\(id)_run",
            slotId: "running")
        return BuilderGroup(
            id: id,
            entries: [entry],
            setGroups: [
                BuilderSetGroup(
                    id: "\(id)_sets",
                    count: .fixed(count),
                    targets: [
                        BuilderTargetLine(
                            entryId: entry.id,
                            reps: .fixed(1),
                            note: note,
                            activityPrescription: .running(prescription)),
                    ]),
            ])
    }

    private static func exact(
        _ value: Double,
        _ unit: QuantityUnit
    ) -> QuantityTarget {
        .exact(TypedQuantity(value, unit: unit))
    }

    private static func range(
        _ lower: Double,
        _ upper: Double,
        _ unit: QuantityUnit
    ) -> QuantityTarget {
        .range(
            lower: TypedQuantity(lower, unit: unit),
            upper: TypedQuantity(upper, unit: unit))
    }

    private static func relativePace(_ multiplier: Double) -> PacePrescription {
        .relativeToBaseline(
            key: "running.thresholdSpeed",
            speedMultiplier: exact(multiplier, .ratio))
    }
}
