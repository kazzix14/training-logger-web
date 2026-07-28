// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "TrainingLoggerCore",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(
            name: "TrainingLoggerCore",
            targets: ["TrainingLoggerCore"]
        ),
        .executable(
            name: "CoreWasm",
            targets: ["CoreWasm"]
        ),
    ],
    targets: [
        .target(name: "TrainingLoggerCore"),
        .executableTarget(
            name: "CoreWasm",
            dependencies: ["TrainingLoggerCore"]
        ),
        .testTarget(
            name: "TrainingLoggerCoreTests",
            dependencies: ["TrainingLoggerCore"]
        ),
    ])
