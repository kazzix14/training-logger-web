#if canImport(FoundationEssentials) && !canImport(Darwin)
import FoundationEssentials
#else
import Foundation
#endif
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
/// The two inputs are UTF-8 byte spans. `namesPtr` carries the known exercises as
/// `{"names":[String],"uuids":[String]}`; a bare `[String]` is accepted as
/// names-only (ADR-0080). Invalid JSON is treated as an empty catalog.
@_cdecl("tl_validate")
public func tl_validate(
    _ jsonPtr: UnsafePointer<UInt8>?,
    _ jsonLen: Int32,
    _ namesPtr: UnsafePointer<UInt8>?,
    _ namesLen: Int32
) -> UnsafePointer<CChar>? {
    let envelopeJSON = data(from: jsonPtr, length: jsonLen)
    let known = knownExercises(from: data(from: namesPtr, length: namesLen))

    let issues = CoreValidation.validate(
        envelopeJSON: envelopeJSON,
        knownExerciseNames: known.names,
        knownExerciseUuids: known.uuids
    )
    let payload = (try? JSONEncoder().encode(ValidationResult(issues: issues)))
        ?? Data(#"{"issues":["検証結果をJSONに変換できません"]}"#.utf8)

    return cString(from: payload)
}

/// Returns a shared program fixture as a NUL-terminated `ProgramTransferEnvelope`
/// JSON value. Unknown keys return a null pointer.
@_cdecl("tl_program_fixture")
public func tl_program_fixture(
    _ keyPtr: UnsafePointer<UInt8>?,
    _ keyLen: Int32
) -> UnsafePointer<CChar>? {
    let key = String(decoding: data(from: keyPtr, length: keyLen), as: UTF8.self)
    guard let program = ProgramFixtureCatalog.fixture(key: key) else { return nil }

    guard let payload = try? JSONEncoder().encode(
        ProgramTransferEnvelope(program: program)
    ) else {
        return nil
    }
    return cString(from: payload)
}

private struct ValidationResult: Encodable {
    let issues: [String]
}

private struct KnownExercisesPayload: Decodable {
    let names: [String]?
    let uuids: [String]?
}

/// `{"names":[…],"uuids":[…]}` を読む。旧形式の `[String]` は名前のみとして扱う
private func knownExercises(from payload: Data) -> (names: [String], uuids: [String]) {
    let decoder = JSONDecoder()
    if let object = try? decoder.decode(KnownExercisesPayload.self, from: payload) {
        return (object.names ?? [], object.uuids ?? [])
    }
    if let names = try? decoder.decode([String].self, from: payload) {
        return (names, [])
    }
    return ([], [])
}

private func data(
    from pointer: UnsafePointer<UInt8>?,
    length: Int32
) -> Data {
    guard let pointer, length > 0 else { return Data() }
    return Data(bytes: pointer, count: Int(length))
}

private func cString(from payload: Data) -> UnsafePointer<CChar> {
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
