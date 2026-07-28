import Foundation

// MARK: - Typed quantities

public enum QuantityDimension: String, Codable, CaseIterable, Sendable {
    case load
    case distance
    case duration
    case pace
    case speed
    case count
    case ratio
    case effort
    case scalar
}

public enum QuantityUnit: String, Codable, CaseIterable, Sendable {
    case kilograms
    case pounds
    case meters
    case kilometers
    case miles
    case seconds
    case minutes
    case hours
    case secondsPerKilometer
    case minutesPerKilometer
    case secondsPerMile
    case metersPerSecond
    case kilometersPerHour
    case count
    case ratio
    case rpe
    case scalar

    public var dimension: QuantityDimension {
        switch self {
        case .kilograms, .pounds: .load
        case .meters, .kilometers, .miles: .distance
        case .seconds, .minutes, .hours: .duration
        case .secondsPerKilometer, .minutesPerKilometer, .secondsPerMile: .pace
        case .metersPerSecond, .kilometersPerHour: .speed
        case .count: .count
        case .ratio: .ratio
        case .rpe: .effort
        case .scalar: .scalar
        }
    }

    fileprivate func valueInBaseUnit(_ value: Double) -> Double {
        switch self {
        case .kilograms, .meters, .seconds, .metersPerSecond, .count, .ratio, .rpe, .scalar:
            value
        case .pounds:
            value * 0.453_592_37
        case .kilometers:
            value * 1_000
        case .miles:
            value * 1_609.344
        case .minutes:
            value * 60
        case .hours:
            value * 3_600
        case .secondsPerKilometer:
            value / 1_000
        case .minutesPerKilometer:
            value * 60 / 1_000
        case .secondsPerMile:
            value / 1_609.344
        case .kilometersPerHour:
            value / 3.6
        }
    }

    fileprivate func valueFromBaseUnit(_ value: Double) -> Double {
        switch self {
        case .kilograms, .meters, .seconds, .metersPerSecond, .count, .ratio, .rpe, .scalar:
            value
        case .pounds:
            value / 0.453_592_37
        case .kilometers:
            value / 1_000
        case .miles:
            value / 1_609.344
        case .minutes:
            value / 60
        case .hours:
            value / 3_600
        case .secondsPerKilometer:
            value * 1_000
        case .minutesPerKilometer:
            value * 1_000 / 60
        case .secondsPerMile:
            value * 1_609.344
        case .kilometersPerHour:
            value * 3.6
        }
    }
}

public struct TypedQuantity: Codable, Equatable, Sendable {
    public var value: Double
    public var unit: QuantityUnit

    public init(_ value: Double, unit: QuantityUnit) {
        self.value = value
        self.unit = unit
    }

    public var dimension: QuantityDimension { unit.dimension }
    public var baseValue: Double { unit.valueInBaseUnit(value) }

    public func converted(to target: QuantityUnit) -> TypedQuantity? {
        guard target.dimension == dimension else { return nil }
        return TypedQuantity(target.valueFromBaseUnit(baseValue), unit: target)
    }
}

public enum QuantityTarget: Codable, Equatable, Sendable {
    case exact(TypedQuantity)
    case range(lower: TypedQuantity, upper: TypedQuantity)
    case open

    public var representativeValue: TypedQuantity? {
        switch self {
        case .exact(let value):
            return value
        case .range(let lower, let upper):
            guard lower.dimension == upper.dimension else { return nil }
            return TypedQuantity(
                (lower.baseValue + upper.baseValue) / 2,
                unit: Self.baseUnit(for: lower.dimension)
            )
        case .open:
            return nil
        }
    }

    private static func baseUnit(for dimension: QuantityDimension) -> QuantityUnit {
        switch dimension {
        case .load: .kilograms
        case .distance: .meters
        case .duration: .seconds
        case .pace: .secondsPerKilometer
        case .speed: .metersPerSecond
        case .count: .count
        case .ratio: .ratio
        case .effort: .rpe
        case .scalar: .scalar
        }
    }
}

// MARK: - Activity definitions

public enum ActivityKind: String, Codable, CaseIterable, Sendable {
    case strength
    case running
    case cycling
}

public struct CustomMetricDefinition: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var label: String
    public var dimension: QuantityDimension
    public var unit: QuantityUnit

    public init(id: String, label: String, dimension: QuantityDimension, unit: QuantityUnit) {
        self.id = id
        self.label = label
        self.dimension = dimension
        self.unit = unit
    }
}

public struct StrengthDefinition: Codable, Equatable, Sendable {
    public var bodyweightFraction: Double
    public var defaultSetDurationSeconds: Double?
    public var customMetrics: [CustomMetricDefinition]

    public init(
        bodyweightFraction: Double = 0,
        defaultSetDurationSeconds: Double? = nil,
        customMetrics: [CustomMetricDefinition] = []
    ) {
        self.bodyweightFraction = bodyweightFraction
        self.defaultSetDurationSeconds = defaultSetDurationSeconds
        self.customMetrics = customMetrics
    }
}

public struct RunningDefinition: Codable, Equatable, Sendable {
    public var defaultPace: TypedQuantity?
    public var customMetrics: [CustomMetricDefinition]

    public init(
        defaultPace: TypedQuantity? = nil,
        customMetrics: [CustomMetricDefinition] = []
    ) {
        self.defaultPace = defaultPace
        self.customMetrics = customMetrics
    }
}

public struct CyclingDefinition: Codable, Equatable, Sendable {
    public var defaultSpeed: TypedQuantity?
    public var customMetrics: [CustomMetricDefinition]

    public init(
        defaultSpeed: TypedQuantity? = nil,
        customMetrics: [CustomMetricDefinition] = []
    ) {
        self.defaultSpeed = defaultSpeed
        self.customMetrics = customMetrics
    }
}

public enum ActivityDefinitionPayload: Codable, Equatable, Sendable {
    case strength(StrengthDefinition)
    case running(RunningDefinition)
    case cycling(CyclingDefinition)

    public var kind: ActivityKind {
        switch self {
        case .strength: .strength
        case .running: .running
        case .cycling: .cycling
        }
    }
}

public struct BundledActivityDefinition: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var definition: ActivityDefinitionPayload

    public init(id: String, name: String, definition: ActivityDefinitionPayload) {
        self.id = id
        self.name = name
        self.definition = definition
    }
}

// MARK: - Explicit requirement tree

public struct ActivityFacts: Equatable, Sendable {
    public var kind: ActivityKind
    public var tagIDs: Set<String>
    public var textProperties: [String: String]
    public var numericProperties: [String: Double]

    public init(
        kind: ActivityKind,
        tagIDs: Set<String> = [],
        textProperties: [String: String] = [:],
        numericProperties: [String: Double] = [:]
    ) {
        self.kind = kind
        self.tagIDs = tagIDs
        self.textProperties = textProperties
        self.numericProperties = numericProperties
    }
}

public enum NumericComparison: String, Codable, Sendable {
    case equal
    case lessThan
    case lessThanOrEqual
    case greaterThan
    case greaterThanOrEqual

    fileprivate func matches(_ lhs: Double, _ rhs: Double) -> Bool {
        switch self {
        case .equal: lhs == rhs
        case .lessThan: lhs < rhs
        case .lessThanOrEqual: lhs <= rhs
        case .greaterThan: lhs > rhs
        case .greaterThanOrEqual: lhs >= rhs
        }
    }
}

public enum ActivityRequirementFact: Codable, Equatable, Sendable {
    case kind(ActivityKind)
    case tagID(String)
    case textProperty(key: String, value: String)
    case numericProperty(key: String, comparison: NumericComparison, value: Double)

    public func matches(_ facts: ActivityFacts) -> Bool {
        switch self {
        case .kind(let expected):
            facts.kind == expected
        case .tagID(let id):
            facts.tagIDs.contains(id)
        case .textProperty(let key, let value):
            facts.textProperties[key] == value
        case .numericProperty(let key, let comparison, let value):
            facts.numericProperties[key].map { comparison.matches($0, value) } ?? false
        }
    }
}

public indirect enum ActivityRequirement: Codable, Equatable, Sendable {
    case all([ActivityRequirement])
    case any([ActivityRequirement])
    case not(ActivityRequirement)
    case fact(ActivityRequirementFact)

    public func matches(_ facts: ActivityFacts) -> Bool {
        switch self {
        case .all(let children):
            children.allSatisfy { $0.matches(facts) }
        case .any(let children):
            children.contains { $0.matches(facts) }
        case .not(let child):
            !child.matches(facts)
        case .fact(let fact):
            fact.matches(facts)
        }
    }

    /// 条件木が一意に要求する種目タイプ。複数タイプを許すanyやnotではnil。
    public var requiredKind: ActivityKind? {
        switch self {
        case .fact(.kind(let kind)):
            return kind
        case .fact:
            return nil
        case .not:
            return nil
        case .all(let children):
            let kinds = Set(children.compactMap(\.requiredKind))
            return kinds.count == 1 ? kinds.first : nil
        case .any(let children):
            let kinds = children.map(\.requiredKind)
            guard !kinds.isEmpty, kinds.allSatisfy({ $0 == kinds.first! }) else {
                return nil
            }
            return kinds.first!
        }
    }
}

public enum ActivityReference: Codable, Equatable, Sendable {
    case fixed(activityID: String)
    case requirement(slotID: String, requirement: ActivityRequirement, distinctGroup: String?)
}

// MARK: - Activity-specific prescriptions and results

public struct StrengthPrescription: Codable, Equatable, Sendable {
    public var load: QuantityTarget
    public var repetitions: QuantityTarget
    public var targetRPE: QuantityTarget?

    public init(
        load: QuantityTarget = .open,
        repetitions: QuantityTarget = .open,
        targetRPE: QuantityTarget? = nil
    ) {
        self.load = load
        self.repetitions = repetitions
        self.targetRPE = targetRPE
    }
}

public enum PacePrescription: Codable, Equatable, Sendable {
    case absolute(QuantityTarget)
    /// `speedMultiplier` is applied to baseline speed. A value of 1.05 means 105%.
    case relativeToBaseline(key: String, speedMultiplier: QuantityTarget)
    case zone(key: String)
    case open
}

public struct RunningPrescription: Codable, Equatable, Sendable {
    public var distance: QuantityTarget?
    public var duration: QuantityTarget?
    public var pace: PacePrescription
    public var targetRPE: QuantityTarget?
    public var workoutLabel: String?

    public init(
        distance: QuantityTarget? = nil,
        duration: QuantityTarget? = nil,
        pace: PacePrescription = .open,
        targetRPE: QuantityTarget? = nil,
        workoutLabel: String? = nil
    ) {
        self.distance = distance
        self.duration = duration
        self.pace = pace
        self.targetRPE = targetRPE
        self.workoutLabel = workoutLabel
    }
}

public struct CyclingPrescription: Codable, Equatable, Sendable {
    public var distance: QuantityTarget?
    public var duration: QuantityTarget?
    public var speed: QuantityTarget?
    public var targetRPE: QuantityTarget?

    public init(
        distance: QuantityTarget? = nil,
        duration: QuantityTarget? = nil,
        speed: QuantityTarget? = nil,
        targetRPE: QuantityTarget? = nil
    ) {
        self.distance = distance
        self.duration = duration
        self.speed = speed
        self.targetRPE = targetRPE
    }
}

public enum ActivityPrescriptionPayload: Codable, Equatable, Sendable {
    case strength(StrengthPrescription)
    case running(RunningPrescription)
    case cycling(CyclingPrescription)

    public var kind: ActivityKind {
        switch self {
        case .strength: .strength
        case .running: .running
        case .cycling: .cycling
        }
    }
}

public struct CustomMetricValue: Codable, Equatable, Sendable {
    public var metricID: String
    public var value: TypedQuantity

    public init(metricID: String, value: TypedQuantity) {
        self.metricID = metricID
        self.value = value
    }
}

public struct StrengthResult: Codable, Equatable, Sendable {
    public var enteredLoad: TypedQuantity?
    public var repetitions: Int?
    public var rpe: Double?
    public var customMetrics: [CustomMetricValue]

    public init(
        enteredLoad: TypedQuantity? = nil,
        repetitions: Int? = nil,
        rpe: Double? = nil,
        customMetrics: [CustomMetricValue] = []
    ) {
        self.enteredLoad = enteredLoad
        self.repetitions = repetitions
        self.rpe = rpe
        self.customMetrics = customMetrics
    }
}

public enum RunningDerivedField: String, Codable, Sendable {
    case distance
    case duration
    case pace
}

public struct RunningResult: Codable, Equatable, Sendable {
    public var distance: TypedQuantity?
    public var duration: TypedQuantity?
    public var pace: TypedQuantity?
    public var derivedField: RunningDerivedField?
    public var rpe: Double?
    public var customMetrics: [CustomMetricValue]

    public init(
        distance: TypedQuantity? = nil,
        duration: TypedQuantity? = nil,
        pace: TypedQuantity? = nil,
        derivedField: RunningDerivedField? = nil,
        rpe: Double? = nil,
        customMetrics: [CustomMetricValue] = []
    ) {
        self.distance = distance
        self.duration = duration
        self.pace = pace
        self.derivedField = derivedField
        self.rpe = rpe
        self.customMetrics = customMetrics
    }
}

public struct CyclingResult: Codable, Equatable, Sendable {
    public var distance: TypedQuantity?
    public var duration: TypedQuantity?
    public var speed: TypedQuantity?
    public var rpe: Double?
    public var customMetrics: [CustomMetricValue]

    public init(
        distance: TypedQuantity? = nil,
        duration: TypedQuantity? = nil,
        speed: TypedQuantity? = nil,
        rpe: Double? = nil,
        customMetrics: [CustomMetricValue] = []
    ) {
        self.distance = distance
        self.duration = duration
        self.speed = speed
        self.rpe = rpe
        self.customMetrics = customMetrics
    }
}

public enum ActivityResultPayload: Codable, Equatable, Sendable {
    case strength(StrengthResult)
    case running(RunningResult)
    case cycling(CyclingResult)
}

// MARK: - Common execution grammar

public struct PerformNode: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var activity: ActivityReference
    public var prescription: ActivityPrescriptionPayload
    public var note: String?

    public init(
        id: String,
        activity: ActivityReference,
        prescription: ActivityPrescriptionPayload,
        note: String? = nil
    ) {
        self.id = id
        self.activity = activity
        self.prescription = prescription
        self.note = note
    }
}

public struct RestNode: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var duration: QuantityTarget?
    public var distance: QuantityTarget?

    public init(id: String, duration: QuantityTarget? = nil, distance: QuantityTarget? = nil) {
        self.id = id
        self.duration = duration
        self.distance = distance
    }
}

public indirect enum ExecutionNode: Codable, Equatable, Sendable {
    case perform(PerformNode)
    case rest(RestNode)
    case sequence(id: String, nodes: [ExecutionNode])
    case repeatNode(id: String, count: Int, node: ExecutionNode)
}

// MARK: - Estimation and progression

public struct EstimationPolicy: Codable, Equatable, Sendable {
    public var strengthSetSeconds: Double
    public var blockTransitionSeconds: Double
    public var defaultRestSeconds: Double
    public var runningDefaultPace: TypedQuantity?
    public var cyclingDefaultSpeed: TypedQuantity?

    public init(
        strengthSetSeconds: Double = 60,
        blockTransitionSeconds: Double = 300,
        defaultRestSeconds: Double = 120,
        runningDefaultPace: TypedQuantity? = nil,
        cyclingDefaultSpeed: TypedQuantity? = nil
    ) {
        self.strengthSetSeconds = strengthSetSeconds
        self.blockTransitionSeconds = blockTransitionSeconds
        self.defaultRestSeconds = defaultRestSeconds
        self.runningDefaultPace = runningDefaultPace
        self.cyclingDefaultSpeed = cyclingDefaultSpeed
    }
}

public enum EstimateProvenance: Codable, Equatable, Sendable {
    case prescribedDuration
    case prescribedDistanceAndPace
    case activityDefaultPace
    case typeDefaultPace
    case activityDefaultSpeed
    case typeDefaultSpeed
    case strengthSetDefault
    case unavailable(reason: String)
}

public struct DurationEstimate: Codable, Equatable, Sendable {
    public var seconds: Double?
    public var provenance: EstimateProvenance

    public init(seconds: Double?, provenance: EstimateProvenance) {
        self.seconds = seconds
        self.provenance = provenance
    }
}

public enum ActivityMath {
    public static func runningDuration(
        prescription: RunningPrescription,
        definition: RunningDefinition,
        policy: EstimationPolicy,
        baselines: [String: TypedQuantity] = [:]
    ) -> DurationEstimate {
        if let duration = prescription.duration?.representativeValue,
           duration.dimension == .duration {
            return DurationEstimate(
                seconds: duration.baseValue,
                provenance: .prescribedDuration
            )
        }

        guard let distance = prescription.distance?.representativeValue,
              distance.dimension == .distance else {
            return DurationEstimate(
                seconds: nil,
                provenance: .unavailable(reason: "距離または時間がありません")
            )
        }

        if let pace = resolvePace(prescription.pace, baselines: baselines) {
            return DurationEstimate(
                seconds: distance.baseValue * pace.baseValue,
                provenance: .prescribedDistanceAndPace
            )
        }
        if let pace = definition.defaultPace, pace.dimension == .pace {
            return DurationEstimate(
                seconds: distance.baseValue * pace.baseValue,
                provenance: .activityDefaultPace
            )
        }
        if let pace = policy.runningDefaultPace, pace.dimension == .pace {
            return DurationEstimate(
                seconds: distance.baseValue * pace.baseValue,
                provenance: .typeDefaultPace
            )
        }
        return DurationEstimate(
            seconds: nil,
            provenance: .unavailable(reason: "推定ペースがありません")
        )
    }

    public static func effectiveLoad(
        enteredLoadKilograms: Double,
        bodyweightKilograms: Double?,
        bodyweightFraction: Double
    ) -> Double? {
        guard bodyweightFraction == 0 || bodyweightKilograms != nil else { return nil }
        return enteredLoadKilograms + (bodyweightKilograms ?? 0) * bodyweightFraction
    }

    private static func resolvePace(
        _ target: PacePrescription,
        baselines: [String: TypedQuantity]
    ) -> TypedQuantity? {
        switch target {
        case .absolute(let value):
            guard let pace = value.representativeValue, pace.dimension == .pace else { return nil }
            return pace
        case .relativeToBaseline(let key, let multiplierTarget):
            guard let baseline = baselines[key],
                  baseline.dimension == .pace,
                  let multiplier = multiplierTarget.representativeValue,
                  multiplier.dimension == .ratio,
                  multiplier.baseValue > 0 else { return nil }
            guard let secondsPerKilometer = baseline.converted(to: .secondsPerKilometer) else {
                return nil
            }
            return TypedQuantity(
                secondsPerKilometer.value / multiplier.baseValue,
                unit: .secondsPerKilometer
            )
        case .zone(let key):
            guard let pace = baselines[key], pace.dimension == .pace else { return nil }
            return pace
        case .open:
            return nil
        }
    }
}

public enum ProgressionOutcome: String, Codable, CaseIterable, Sendable {
    case success
    case maintain
    case failure
    case pending
}

public enum MissingMetricBehavior: String, Codable, CaseIterable, Sendable {
    case maintain
    case failure
    case pending
}
