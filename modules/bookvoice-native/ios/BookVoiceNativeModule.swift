import ExpoModulesCore
import AVFoundation
import PDFKit

/// Phone voices rendered to a WAV file (fast, unlimited, offline) and PDF text extraction.
public class BookVoiceNativeModule: Module {
  // Keep the synthesizer alive while it renders.
  private var synth: AVSpeechSynthesizer?

  public func definition() -> ModuleDefinition {
    Name("BookVoiceNative")

    AsyncFunction("listVoices") { () -> [[String: Any]] in
      return AVSpeechSynthesisVoice.speechVoices().map { v in
        var quality = "default"
        if v.quality == .premium { quality = "premium" } else if v.quality == .enhanced { quality = "enhanced" }
        var gender = ""
        if v.gender == .female { gender = "female" } else if v.gender == .male { gender = "male" }
        return ["id": v.identifier, "name": v.name, "language": v.language, "quality": quality, "gender": gender]
      }
    }

    AsyncFunction("synthesize") { (text: String, voiceId: String, rate: Double, pitch: Double, outPath: String, promise: Promise) in
      DispatchQueue.main.async {
        self.render(text: text, voiceId: voiceId, rate: rate, pitch: pitch, outPath: outPath, promise: promise)
      }
    }

    AsyncFunction("pdfText") { (path: String) -> [String] in
      let url: URL = path.hasPrefix("file://") ? (URL(string: path) ?? URL(fileURLWithPath: path)) : URL(fileURLWithPath: path)
      guard let doc = PDFDocument(url: url) else {
        throw Exception(name: "PdfOpen", description: "Could not open this PDF (it may be locked with a password).")
      }
      var pages: [String] = []
      for i in 0..<doc.pageCount {
        pages.append(doc.page(at: i)?.string ?? "")
      }
      return pages
    }
  }

  private func render(text: String, voiceId: String, rate: Double, pitch: Double, outPath: String, promise: Promise) {
    let utterance = AVSpeechUtterance(string: text)
    if !voiceId.isEmpty, let v = AVSpeechSynthesisVoice(identifier: voiceId) {
      utterance.voice = v
    }
    let r = Float(rate) * AVSpeechUtteranceDefaultSpeechRate
    utterance.rate = min(AVSpeechUtteranceMaximumSpeechRate, max(AVSpeechUtteranceMinimumSpeechRate, r))
    utterance.pitchMultiplier = Float(min(2.0, max(0.5, pitch)))

    let synthesizer = AVSpeechSynthesizer()
    self.synth = synthesizer
    var samples = [Int16]()
    samples.reserveCapacity(24000 * 60)
    var sampleRate: Double = 22050
    var finished = false
    var watchdog: DispatchWorkItem?

    let finish: () -> Void = {
      if finished { return }
      finished = true
      watchdog?.cancel()
      self.synth = nil
      let path = outPath.hasPrefix("file://") ? (URL(string: outPath)?.path ?? outPath) : outPath
      do {
        try BookVoiceNativeModule.writeWav(samples: samples, sampleRate: Int(sampleRate), path: path)
        promise.resolve(["path": outPath, "sampleRate": Int(sampleRate), "frames": samples.count])
      } catch {
        promise.reject("WavWrite", error.localizedDescription)
      }
    }
    // Some iOS versions never send the final empty buffer: finish after a quiet spell.
    let arm: () -> Void = {
      watchdog?.cancel()
      let w = DispatchWorkItem { finish() }
      watchdog = w
      DispatchQueue.main.asyncAfter(deadline: .now() + 4.0, execute: w)
    }

    synthesizer.write(utterance) { buffer in
      guard let pcm = buffer as? AVAudioPCMBuffer else { return }
      if pcm.frameLength == 0 {
        DispatchQueue.main.async { finish() }
        return
      }
      let n = Int(pcm.frameLength)
      let rate = pcm.format.sampleRate
      var chunk = [Int16]()
      chunk.reserveCapacity(n)
      if let f = pcm.floatChannelData {
        let ch = f[0]
        for i in 0..<n {
          let v = max(-1.0, min(1.0, ch[i]))
          chunk.append(Int16(v * 32767.0))
        }
      } else if let d = pcm.int16ChannelData {
        chunk.append(contentsOf: UnsafeBufferPointer(start: d[0], count: n))
      } else if let d = pcm.int32ChannelData {
        let ch = d[0]
        for i in 0..<n { chunk.append(Int16(truncatingIfNeeded: ch[i] >> 16)) }
      }
      // all state changes happen on the main queue, in order
      DispatchQueue.main.async {
        if finished { return }
        sampleRate = rate
        samples.append(contentsOf: chunk)
        arm()
      }
    }
    arm()
  }

  static func writeWav(samples: [Int16], sampleRate: Int, path: String) throws {
    var data = Data()
    let dataBytes = samples.count * 2
    func u32(_ v: Int) { var x = UInt32(v).littleEndian; data.append(Data(bytes: &x, count: 4)) }
    func u16(_ v: Int) { var x = UInt16(v).littleEndian; data.append(Data(bytes: &x, count: 2)) }
    data.append("RIFF".data(using: .ascii)!); u32(36 + dataBytes)
    data.append("WAVE".data(using: .ascii)!)
    data.append("fmt ".data(using: .ascii)!); u32(16); u16(1); u16(1); u32(sampleRate); u32(sampleRate * 2); u16(2); u16(16)
    data.append("data".data(using: .ascii)!); u32(dataBytes)
    if !samples.isEmpty {
      samples.withUnsafeBytes { raw in data.append(contentsOf: raw) }
    }
    try data.write(to: URL(fileURLWithPath: path))
  }
}
