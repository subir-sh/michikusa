internal import ExpoModulesCore
import Foundation
import Vision

class MichikusaVisionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MichikusaVision")

    AsyncFunction("classify") { (uri: String, limit: Int) async throws -> [[String: Any]] in
      guard let url = URL(string: uri), url.isFileURL else {
        throw NSError(
          domain: "MichikusaVision",
          code: 1,
          userInfo: [NSLocalizedDescriptionKey: "Vision classifier requires a local file URL"]
        )
      }

      let request = VNClassifyImageRequest()
      let handler = VNImageRequestHandler(url: url, options: [:])
      try handler.perform([request])

      let safeLimit = max(1, min(limit, 50))
      return (request.results ?? []).prefix(safeLimit).map { observation in
        [
          "identifier": observation.identifier,
          "confidence": Double(observation.confidence)
        ]
      }
    }
  }
}
