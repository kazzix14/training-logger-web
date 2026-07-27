import Foundation

struct ExprParseError: Error, Equatable, CustomStringConvertible {
    let message: String
    let position: Int

    var description: String { "\(message)（位置: \(position)）" }
}

/// 文字列構文 → Expr。編集 UI 用の小さな構文（ADR-0016）。
///
/// ```
/// expression := ternary
/// ternary    := or ( '?' expression ':' expression )?
/// or         := and ( '||' and )*
/// and        := cmp ( '&&' cmp )*
/// cmp        := additive ( (== != < <= > >=) additive )?   // 連結不可
/// additive   := mult ( (+ -) mult )*
/// mult       := unary ( (* /) unary )*
/// unary      := ('-' | '!') unary | primary
/// primary    := number | '(' expression ')' | ident | ident '(' args ')'
/// ```
///
/// 関数形の特別解釈:
/// - `if(条件, 真, 偽)` → If
/// - `sum/avg/min/max(スコープ, 本体 [, フィルタ])`、`count(スコープ [, フィルタ])` → Fold
///   （第1引数が record/set/block/session/period のときのみ。スコープ名はこの位置で予約語）
/// - それ以外は組み込み関数（abs/round/floor/ceil/min/max/e1rm_percent）
enum ExprParser {

    static func parse(_ source: String) throws -> Expr {
        var parser = Parser(tokens: try Lexer.tokenize(source))
        let expr = try parser.parseExpression()
        try parser.expectEnd()
        return expr
    }

    // MARK: - Token

    private enum Token: Equatable {
        case number(Double)
        case ident(String)
        case symbol(String)   // ( ) , ? : + - * / ! < <= > >= == != && ||
    }

    private struct PositionedToken {
        let token: Token
        let position: Int
    }

    // MARK: - Lexer

    private enum Lexer {
        static func tokenize(_ source: String) throws -> [PositionedToken] {
            let chars = Array(source)
            var tokens: [PositionedToken] = []
            var i = 0

            while i < chars.count {
                let c = chars[i]

                if c.isWhitespace {
                    i += 1
                    continue
                }

                if c.isNumber || (c == "." && i + 1 < chars.count && chars[i + 1].isNumber) {
                    let start = i
                    var text = ""
                    var seenDot = false
                    while i < chars.count, chars[i].isNumber || (chars[i] == "." && !seenDot) {
                        if chars[i] == "." { seenDot = true }
                        text.append(chars[i])
                        i += 1
                    }
                    guard let value = Double(text) else {
                        throw ExprParseError(message: "数値を解釈できません: \(text)", position: start)
                    }
                    tokens.append(PositionedToken(token: .number(value), position: start))
                    continue
                }

                if c.isLetter || c == "_" {
                    let start = i
                    var text = ""
                    while i < chars.count, chars[i].isLetter || chars[i].isNumber || chars[i] == "_" {
                        text.append(chars[i])
                        i += 1
                    }
                    tokens.append(PositionedToken(token: .ident(text), position: start))
                    continue
                }

                let two = i + 1 < chars.count ? String([c, chars[i + 1]]) : ""
                if ["<=", ">=", "==", "!=", "&&", "||"].contains(two) {
                    tokens.append(PositionedToken(token: .symbol(two), position: i))
                    i += 2
                    continue
                }

                if "()?,:+-*/!<>".contains(c) {
                    tokens.append(PositionedToken(token: .symbol(String(c)), position: i))
                    i += 1
                    continue
                }

                if c == "=" {
                    throw ExprParseError(message: "比較は == を使ってください", position: i)
                }
                if c == "&" || c == "|" {
                    throw ExprParseError(message: "論理演算は && / || を使ってください", position: i)
                }
                throw ExprParseError(message: "解釈できない文字: \(c)", position: i)
            }
            return tokens
        }
    }

    // MARK: - Parser

    private struct Parser {
        let tokens: [PositionedToken]
        var index = 0

        private var currentPosition: Int {
            index < tokens.count ? tokens[index].position : (tokens.last.map { $0.position + 1 } ?? 0)
        }

        private func peek() -> Token? {
            index < tokens.count ? tokens[index].token : nil
        }

        private mutating func advance() -> Token? {
            guard index < tokens.count else { return nil }
            defer { index += 1 }
            return tokens[index].token
        }

        private mutating func consume(symbol: String) throws {
            guard peek() == .symbol(symbol) else {
                throw ExprParseError(message: "「\(symbol)」が必要です", position: currentPosition)
            }
            index += 1
        }

        private mutating func match(symbol: String) -> Bool {
            if peek() == .symbol(symbol) {
                index += 1
                return true
            }
            return false
        }

        mutating func expectEnd() throws {
            if index < tokens.count {
                throw ExprParseError(message: "式の途中で終わっています", position: currentPosition)
            }
        }

        mutating func parseExpression() throws -> Expr {
            try parseTernary()
        }

        private mutating func parseTernary() throws -> Expr {
            let condition = try parseOr()
            guard match(symbol: "?") else { return condition }
            let thenExpr = try parseExpression()
            try consume(symbol: ":")
            let elseExpr = try parseExpression()
            return .ifElse(condition, thenExpr, elseExpr)
        }

        private mutating func parseOr() throws -> Expr {
            var lhs = try parseAnd()
            while match(symbol: "||") {
                lhs = .binary(.or, lhs, try parseAnd())
            }
            return lhs
        }

        private mutating func parseAnd() throws -> Expr {
            var lhs = try parseComparison()
            while match(symbol: "&&") {
                lhs = .binary(.and, lhs, try parseComparison())
            }
            return lhs
        }

        private static let comparisonOps: [String: ExprBinaryOp] = [
            "==": .eq, "!=": .ne, "<": .lt, "<=": .le, ">": .gt, ">=": .ge,
        ]

        private mutating func parseComparison() throws -> Expr {
            let lhs = try parseAdditive()
            guard case .symbol(let sym)? = peek(), let op = Self.comparisonOps[sym] else {
                return lhs
            }
            index += 1
            let rhs = try parseAdditive()
            if case .symbol(let next)? = peek(), Self.comparisonOps[next] != nil {
                throw ExprParseError(message: "比較は連結できません", position: currentPosition)
            }
            return .binary(op, lhs, rhs)
        }

        private mutating func parseAdditive() throws -> Expr {
            var lhs = try parseMultiplicative()
            while true {
                if match(symbol: "+") {
                    lhs = .binary(.add, lhs, try parseMultiplicative())
                } else if match(symbol: "-") {
                    lhs = .binary(.sub, lhs, try parseMultiplicative())
                } else {
                    return lhs
                }
            }
        }

        private mutating func parseMultiplicative() throws -> Expr {
            var lhs = try parseUnary()
            while true {
                if match(symbol: "*") {
                    lhs = .binary(.mul, lhs, try parseUnary())
                } else if match(symbol: "/") {
                    lhs = .binary(.div, lhs, try parseUnary())
                } else {
                    return lhs
                }
            }
        }

        private mutating func parseUnary() throws -> Expr {
            if match(symbol: "-") {
                return .negate(try parseUnary())
            }
            if match(symbol: "!") {
                return .not(try parseUnary())
            }
            return try parsePrimary()
        }

        private mutating func parsePrimary() throws -> Expr {
            let position = currentPosition
            switch advance() {
            case .number(let value):
                return .lit(value)

            case .symbol("("):
                let inner = try parseExpression()
                try consume(symbol: ")")
                return inner

            case .ident(let name):
                guard match(symbol: "(") else {
                    return .variable(name)
                }
                return try parseCallLike(name: name, position: position)

            case .symbol(let sym):
                throw ExprParseError(message: "「\(sym)」から式は始められません", position: position)
            case nil:
                throw ExprParseError(message: "式が途切れています", position: position)
            }
        }

        /// `name(` まで読んだ状態から、if / Fold / 組み込み関数を解釈する
        private mutating func parseCallLike(name: String, position: Int) throws -> Expr {
            if name == "if" {
                let args = try parseArguments()
                guard args.count == 3 else {
                    throw ExprParseError(message: "if(条件, 真, 偽) は3引数です", position: position)
                }
                return .ifElse(args[0], args[1], args[2])
            }

            if let agg = ExprAggregation(rawValue: name), let scope = peekScopeArgument() {
                index += 1   // scope ident を消費
                var body: Expr?
                var filter: Expr?

                if agg == .count {
                    if match(symbol: ",") {
                        filter = try parseExpression()
                    }
                } else {
                    try consume(symbol: ",")
                    body = try parseExpression()
                    if match(symbol: ",") {
                        filter = try parseExpression()
                    }
                }
                try consume(symbol: ")")
                return .fold(agg, scope, body, filter)
            }

            let args = try parseArguments()
            try validateBuiltin(name: name, argCount: args.count, position: position)
            return .call(name, args)
        }

        /// Fold 判定: 集計名の直後の第1引数が スコープ名 かつ その直後が , or ) のときだけ
        /// スコープ名として解釈する（この位置でのみ予約語）
        private func peekScopeArgument() -> ExprScope? {
            guard case .ident(let name)? = peek(),
                  let scope = ExprScope(rawValue: name) else { return nil }
            let nextIndex = index + 1
            guard nextIndex < tokens.count,
                  case .symbol(let sym) = tokens[nextIndex].token,
                  sym == "," || sym == ")" else { return nil }
            return scope
        }

        private mutating func parseArguments() throws -> [Expr] {
            var args: [Expr] = []
            if match(symbol: ")") {
                return args
            }
            repeat {
                args.append(try parseExpression())
            } while match(symbol: ",")
            try consume(symbol: ")")
            return args
        }

        private func validateBuiltin(name: String, argCount: Int, position: Int) throws {
            let arity: ClosedRange<Int>
            switch name {
            case "abs", "round", "floor", "ceil": arity = 1...1
            case "min", "max": arity = 2...Int.max
            case "e1rm_percent": arity = 2...2
            default:
                throw ExprParseError(message: "未知の関数: \(name)", position: position)
            }
            guard arity.contains(argCount) else {
                throw ExprParseError(message: "\(name) の引数の数が不正です", position: position)
            }
        }
    }
}

