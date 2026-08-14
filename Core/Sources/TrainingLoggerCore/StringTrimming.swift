#if canImport(FoundationEssentials) && !canImport(Darwin)
import FoundationEssentials
#else
import Foundation
#endif

extension StringProtocol {

    /// 前後の空白と改行を落とす。
    ///
    /// `trimmingCharacters(in: .whitespacesAndNewlines)` は Foundation 側にしかなく、
    /// wasm ビルドが使う FoundationEssentials では解決できない（ADR-0079）。
    /// `Character.isWhitespace` は改行も含むため、判定は同じ範囲になる。
    func trimmedWhitespace() -> String {
        guard let start = firstIndex(where: { !$0.isWhitespace }),
              let end = lastIndex(where: { !$0.isWhitespace }) else {
            return ""
        }
        return String(self[start...end])
    }
}
