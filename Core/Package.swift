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
            targets: ["TrainingLoggerCore"])
    ],
    targets: [
        .target(name: "TrainingLoggerCore"),
    ])
