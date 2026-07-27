import Foundation

/// 計算式が見るスコープ。本体の深さと1:1（v4 統合構造仕様 §4、ADR-0016）
public enum ExprScope: String, Codable, CaseIterable, Sendable {
    case record
    case set
    case block
    case session
    case period
}

public enum ExprBinaryOp: String, Codable, Sendable {
    case add, sub, mul, div
    case eq, ne, lt, le, gt, ge
    case and, or
}

public enum ExprAggregation: String, Codable, CaseIterable, Sendable {
    case sum, avg, min, max, count
}

/// 計算フィールド / メトリクス / guard / 処方の穴、全部を表す単一の式（ADR-0016）。
/// 保存は AST（JSON）。編集 UI は文字列構文 ⇄ ExprParser / sourceString。
public indirect enum Expr: Codable, Equatable, Sendable {
    case lit(Double)
    case variable(String)
    case binary(ExprBinaryOp, Expr, Expr)
    case negate(Expr)
    case not(Expr)
    case call(String, [Expr])
    /// Fold(集計, スコープ, 本体式, フィルタ条件?)。count のみ本体式なし
    case fold(ExprAggregation, ExprScope, Expr?, Expr?)
    case ifElse(Expr, Expr, Expr)
}

public extension Expr {
    func jsonData() throws -> Data {
        try JSONEncoder().encode(self)
    }

    static func decode(from data: Data) throws -> Expr {
        try JSONDecoder().decode(Expr.self, from: data)
    }
}
