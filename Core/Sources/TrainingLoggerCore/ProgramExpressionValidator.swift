#if canImport(FoundationEssentials) && !canImport(Darwin)
import FoundationEssentials
#else
import Foundation
#endif

/// Program V2 の数値式を、表示単位や変数名から推測せずに検証する。
///
/// 数値リテラルだけは通常の型推論と同じく文脈依存で、`load + 2.5` の
/// `2.5` は load として扱う。変数の型は必ず ProgramInputDef.dimension を正とする。
public enum ProgramExpressionValidator {
    public struct Issue: Equatable, Sendable, CustomStringConvertible {
        public var path: String
        public var message: String

        public init(path: String, message: String) {
            self.path = path
            self.message = message
        }

        public var description: String {
            "\(path): \(message)"
        }
    }

    public static func validate(_ program: ProgramHSMDef) -> [Issue] {
        var validator = Validator(program: program)
        validator.run()
        return validator.issues
    }
}

public enum ProgramFieldDimensions {
    public static func dimension(forCanonicalKey key: String) -> QuantityDimension? {
        switch key {
        case "core.weight": .load
        case "core.reps": .count
        case "core.rpe": .effort
        case "core.distance": .distance
        case "core.duration": .duration
        case "core.pace": .pace
        case "core.speed": .speed
        default: nil
        }
    }
}

private struct Validator {
    private enum ValueType: Equatable {
        case quantity(QuantityDimension)
        case boolean
        case numericLiteral
        case unknown

        var label: String {
            switch self {
            case .quantity(let dimension): dimension.rawValue
            case .boolean: "boolean"
            case .numericLiteral: "number"
            case .unknown: "unknown"
            }
        }
    }

    let program: ProgramHSMDef
    var issues: [ProgramExpressionValidator.Issue] = []
    private var variables: [String: ValueType] = [:]

    init(program: ProgramHSMDef) {
        self.program = program
        variables = Dictionary(
            uniqueKeysWithValues: program.inputs.map {
                ($0.key, .quantity($0.dimension))
            }
        )
    }

    mutating func run() {
        validateInputs()

        for (index, assignment) in program.initActions.enumerated() {
            validate(
                assignment: assignment,
                path: "initActions[\(index)]"
            )
        }

        collectBindings(in: program.root)
        validate(phase: program.root, path: "root")

        if let bindings = program.previewBindings {
            for (index, binding) in bindings.enumerated() {
                let path = "previewBindings[\(index)]"
                _ = infer(binding.successExpr, path: "\(path).successExpr")
                _ = infer(binding.failureExpr, path: "\(path).failureExpr")
                check(
                    infer(binding.outcomeExpr, path: "\(path).outcomeExpr"),
                    assignableTo: .quantity(.scalar),
                    path: "\(path).outcomeExpr"
                )
            }
        }
    }

    private mutating func validateInputs() {
        var keys = Set<String>()
        for (index, input) in program.inputs.enumerated() {
            let path = "inputs[\(index)]"
            if input.key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                add(path, "変数IDが空です")
            } else if !keys.insert(input.key).inserted {
                add(path, "変数ID「\(input.key)」が重複しています")
            }
            if input.unit.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
               input.dimension != .scalar {
                add(path, "\(input.dimension.rawValue) の表示単位が空です")
            }
            if !input.fallbackValue.isFinite {
                add(path, "初期値が有限値ではありません")
            }
        }
    }

    private mutating func collectBindings(in phase: PhaseDef) {
        switch phase {
        case .leaf(let leaf):
            for day in leaf.days {
                for block in day.resolvedSessions.flatMap(\.blocks) {
                    for set in block.sets {
                        for record in set.records {
                            guard let bind = record.bind else { continue }
                            let key = record.bindFieldKey
                                ?? record.scheme.first?.fieldKey
                            variables[bind] = key
                                .flatMap(ProgramFieldDimensions.dimension)
                                .map(ValueType.quantity) ?? .unknown
                        }
                    }
                }
            }
        case .composite(let composite):
            for child in composite.children {
                collectBindings(in: child)
            }
        }
    }

    private mutating func validate(phase: PhaseDef, path: String) {
        switch phase {
        case .leaf(let leaf):
            validate(transitions: leaf.transitions, path: "\(path).transitions")
            for (dayIndex, day) in leaf.days.enumerated() {
                for (blockIndex, block) in day.resolvedSessions.flatMap(\.blocks).enumerated() {
                    for (setIndex, set) in block.sets.enumerated() {
                        let setPath = "\(path).days[\(dayIndex)].blocks[\(blockIndex)].sets[\(setIndex)]"
                        if let repeatExpr = set.repeatExpr {
                            check(
                                infer(repeatExpr, path: "\(setPath).repeatExpr"),
                                assignableTo: .quantity(.count),
                                path: "\(setPath).repeatExpr"
                            )
                        }
                        for (recordIndex, record) in set.records.enumerated() {
                            validate(
                                record: record,
                                path: "\(setPath).records[\(recordIndex)]"
                            )
                        }
                    }
                }
            }
        case .composite(let composite):
            validate(
                transitions: composite.transitions,
                path: "\(path).transitions"
            )
            for (index, child) in composite.children.enumerated() {
                validate(phase: child, path: "\(path).children[\(index)]")
            }
        }
    }

    private mutating func validate(
        transitions: [TransitionDef],
        path: String
    ) {
        for (index, transition) in transitions.enumerated() {
            let transitionPath = "\(path)[\(index)]"
            let guardType = infer(
                transition.guardExpr,
                path: "\(transitionPath).guardExpr"
            )
            if guardType != .boolean,
               guardType != .numericLiteral,
               guardType != .quantity(.scalar),
               guardType != .unknown {
                add(
                    "\(transitionPath).guardExpr",
                    "guard は boolean または scalar が必要ですが \(guardType.label) です"
                )
            }
            for (actionIndex, assignment) in transition.actions.enumerated() {
                validate(
                    assignment: assignment,
                    path: "\(transitionPath).actions[\(actionIndex)]"
                )
            }
        }
    }

    private mutating func validate(
        assignment: VarAssign,
        path: String
    ) {
        let result = infer(assignment.expr, path: "\(path).expr")
        if let expected = variables[assignment.name] {
            check(
                result,
                assignableTo: expected,
                path: "\(path).expr"
            )
        } else {
            variables[assignment.name] = result
        }
    }

    private mutating func validate(record: RecordPlanTpl, path: String) {
        for (index, scheme) in record.scheme.enumerated() {
            let schemePath = "\(path).scheme[\(index)]"
            let expected = ProgramFieldDimensions.dimension(
                forCanonicalKey: scheme.fieldKey
            ).map(ValueType.quantity)
            let result = infer(scheme.expr, path: "\(schemePath).expr")
            if let expected {
                check(result, assignableTo: expected, path: "\(schemePath).expr")
            }
            if let upperExpr = scheme.upperExpr {
                let upper = infer(
                    upperExpr,
                    path: "\(schemePath).upperExpr"
                )
                if let expected {
                    check(
                        upper,
                        assignableTo: expected,
                        path: "\(schemePath).upperExpr"
                    )
                } else {
                    _ = unify(
                        result,
                        upper,
                        path: "\(schemePath).upperExpr"
                    )
                }
            }
            if let percentExpr = scheme.percentExpr {
                check(
                    infer(
                        percentExpr,
                        path: "\(schemePath).percentExpr"
                    ),
                    assignableTo: .quantity(.ratio),
                    path: "\(schemePath).percentExpr"
                )
            }
        }
    }

    private mutating func infer(_ expr: Expr, path: String) -> ValueType {
        switch expr {
        case .lit:
            return .numericLiteral
        case .variable(let name):
            return variables[name] ?? .unknown
        case .negate(let value):
            return infer(value, path: "\(path).negate")
        case .not(let value):
            let type = infer(value, path: "\(path).not")
            if type != .boolean,
               type != .numericLiteral,
               type != .quantity(.scalar),
               type != .unknown {
                add(path, "not の対象は boolean または scalar が必要です")
            }
            return .boolean
        case .binary(let op, let lhs, let rhs):
            let left = infer(lhs, path: "\(path).lhs")
            let right = infer(rhs, path: "\(path).rhs")
            switch op {
            case .add, .sub:
                return unify(left, right, path: path)
            case .mul:
                return product(left, right, path: path)
            case .div:
                return quotient(left, right, path: path)
            case .eq, .ne, .lt, .le, .gt, .ge:
                _ = unify(left, right, path: path)
                return .boolean
            case .and, .or:
                validateLogical(left, path: "\(path).lhs")
                validateLogical(right, path: "\(path).rhs")
                return .boolean
            }
        case .call(let name, let arguments):
            let types = arguments.enumerated().map {
                infer($0.element, path: "\(path).args[\($0.offset)]")
            }
            switch name.lowercased() {
            case "min", "max":
                return types.dropFirst().reduce(types.first ?? .unknown) {
                    unify($0, $1, path: path)
                }
            case "round", "floor", "ceil", "abs":
                return types.first ?? .unknown
            case "if":
                guard types.count == 3 else {
                    add(path, "if は3引数が必要です")
                    return .unknown
                }
                validateLogical(types[0], path: "\(path).args[0]")
                return unify(types[1], types[2], path: path)
            default:
                return .unknown
            }
        case .fold(let aggregation, _, let body, let predicate):
            if let predicate {
                validateLogical(
                    infer(predicate, path: "\(path).predicate"),
                    path: "\(path).predicate"
                )
            }
            if aggregation == .count {
                return .quantity(.count)
            }
            return body.map { infer($0, path: "\(path).body") } ?? .unknown
        case .ifElse(let condition, let thenExpr, let elseExpr):
            validateLogical(
                infer(condition, path: "\(path).condition"),
                path: "\(path).condition"
            )
            return unify(
                infer(thenExpr, path: "\(path).then"),
                infer(elseExpr, path: "\(path).else"),
                path: path
            )
        }
    }

    private mutating func product(
        _ lhs: ValueType,
        _ rhs: ValueType,
        path: String
    ) -> ValueType {
        if lhs == .numericLiteral || lhs == .quantity(.scalar) || lhs == .quantity(.ratio) {
            return rhs
        }
        if rhs == .numericLiteral || rhs == .quantity(.scalar) || rhs == .quantity(.ratio) {
            return lhs
        }
        if lhs == .unknown || rhs == .unknown {
            return .unknown
        }
        add(path, "\(lhs.label) と \(rhs.label) は乗算できません")
        return .unknown
    }

    private mutating func quotient(
        _ lhs: ValueType,
        _ rhs: ValueType,
        path: String
    ) -> ValueType {
        if rhs == .numericLiteral || rhs == .quantity(.scalar) || rhs == .quantity(.ratio) {
            return lhs
        }
        if lhs == rhs, lhs != .boolean {
            return .quantity(.ratio)
        }
        if lhs == .unknown || rhs == .unknown {
            return .unknown
        }
        add(path, "\(lhs.label) は \(rhs.label) で除算できません")
        return .unknown
    }

    private mutating func unify(
        _ lhs: ValueType,
        _ rhs: ValueType,
        path: String
    ) -> ValueType {
        if lhs == rhs { return lhs }
        if lhs == .numericLiteral { return rhs }
        if rhs == .numericLiteral { return lhs }
        if lhs == .unknown || rhs == .unknown { return .unknown }
        add(path, "\(lhs.label) と \(rhs.label) は同じ次元ではありません")
        return .unknown
    }

    private mutating func check(
        _ actual: ValueType,
        assignableTo expected: ValueType,
        path: String
    ) {
        if actual == expected || actual == .numericLiteral || actual == .unknown {
            return
        }
        add(path, "\(expected.label) が必要ですが \(actual.label) です")
    }

    private mutating func validateLogical(_ type: ValueType, path: String) {
        if type == .boolean
            || type == .numericLiteral
            || type == .quantity(.scalar)
            || type == .unknown {
            return
        }
        add(path, "論理式には boolean または scalar が必要ですが \(type.label) です")
    }

    private mutating func add(_ path: String, _ message: String) {
        issues.append(.init(path: path, message: message))
    }
}
