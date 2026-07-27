import Foundation
import TrainingLoggerCore

// C ABI used by wasm-core.js. The allocation is implemented with Swift's
// allocator so this target also compiles on macOS without importing Darwin,
// Glibc, or WASI-specific modules.

@_cdecl("tl_alloc")
public func tl_alloc(_ size: Int32) -> UnsafeMutableRawPointer? {
    guard size > 0 else { return nil }
    return UnsafeMutableRawPointer.allocate(
        byteCount: Int(size),
        alignment: MemoryLayout<UInt8>.alignment
    )
}

@_cdecl("tl_free")
public func tl_free(_ pointer: UnsafeMutableRawPointer?) {
    pointer?.deallocate()
}

@_cdecl("tl_free_result")
public func tl_free_result(_ pointer: UnsafeMutablePointer<CChar>?) {
    UnsafeMutableRawPointer(pointer)?.deallocate()
}

/// Validates an envelope and returns a NUL-terminated UTF-8 JSON object:
/// `{"issues":[String]}`.
///
/// The two inputs are UTF-8 byte spans. `namesPtr` contains a JSON array of
/// exercise names. Invalid name JSON is treated as an empty list.
@_cdecl("tl_validate")
public func tl_validate(
    _ jsonPtr: UnsafePointer<UInt8>?,
    _ jsonLen: Int32,
    _ namesPtr: UnsafePointer<UInt8>?,
    _ namesLen: Int32
) -> UnsafePointer<CChar>? {
    let envelopeJSON = data(from: jsonPtr, length: jsonLen)
    let knownExerciseNames =
        (try? JSONDecoder().decode(
            [String].self,
            from: data(from: namesPtr, length: namesLen)
        )) ?? []

    let issues = CoreValidation.validate(
        envelopeJSON: envelopeJSON,
        knownExerciseNames: knownExerciseNames
    )
    let payload = (try? JSONEncoder().encode(ValidationResult(issues: issues)))
        ?? Data(#"{"issues":["検証結果をJSONに変換できません"]}"#.utf8)

    let result = UnsafeMutablePointer<CChar>.allocate(capacity: payload.count + 1)
    payload.copyBytes(
        to: UnsafeMutableRawBufferPointer(
            start: result,
            count: payload.count
        )
    )
    result[payload.count] = 0
    return UnsafePointer(result)
}

private struct ValidationResult: Encodable {
    let issues: [String]
}

private func data(
    from pointer: UnsafePointer<UInt8>?,
    length: Int32
) -> Data {
    guard let pointer, length > 0 else { return Data() }
    return Data(bytes: pointer, count: Int(length))
}
