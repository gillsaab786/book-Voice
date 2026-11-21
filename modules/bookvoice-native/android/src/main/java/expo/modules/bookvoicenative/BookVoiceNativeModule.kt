package expo.modules.bookvoicenative

import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.RandomAccessFile
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** Phone voices rendered to a WAV file (fast, unlimited, offline) and PDF text extraction. */
class BookVoiceNativeModule : Module() {
  private var tts: TextToSpeech? = null
  private var ready = false
  private val waiting = mutableListOf<(TextToSpeech?) -> Unit>()
  private val pending = ConcurrentHashMap<String, Pair<Promise, String>>()

  private fun withTts(block: (TextToSpeech?) -> Unit) {
    synchronized(this) {
      if (ready) { block(tts); return }
      waiting.add(block)
      if (tts != null) return
      val ctx = appContext.reactContext ?: run { waiting.clear(); block(null); return }
      tts = TextToSpeech(ctx.applicationContext) { status ->
        synchronized(this) {
          ready = true
          if (status != TextToSpeech.SUCCESS) tts = null
          tts?.setOnUtteranceProgressListener(listener)
          val list = waiting.toList()
          waiting.clear()
          list.forEach { it(tts) }
        }
      }
    }
  }

  private val listener = object : UtteranceProgressListener() {
    override fun onStart(utteranceId: String?) {}
    override fun onDone(utteranceId: String?) {
      val p = pending.remove(utteranceId ?: return) ?: return
      try {
        val rate = wavSampleRate(p.second)
        p.first.resolve(mapOf("path" to "file://" + p.second, "sampleRate" to rate))
      } catch (e: Exception) {
        p.first.reject("TtsRead", e.message ?: "Could not read the voice output", e)
      }
    }
    @Deprecated("Deprecated in Java")
    override fun onError(utteranceId: String?) {
      pending.remove(utteranceId ?: return)?.first?.reject("Tts", "The phone voice failed to speak this text", null)
    }
    override fun onError(utteranceId: String?, errorCode: Int) {
      pending.remove(utteranceId ?: return)?.first?.reject("Tts", "The phone voice failed (error $errorCode)", null)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("BookVoiceNative")

    OnDestroy {
      tts?.shutdown()
      tts = null
    }

    AsyncFunction("listVoices") { promise: Promise ->
      withTts { t ->
        if (t == null) { promise.resolve(listOf<Map<String, Any>>()); return@withTts }
        val out = (t.voices ?: emptySet()).map { v ->
          mapOf(
            "id" to v.name,
            "name" to v.name,
            "language" to v.locale.toLanguageTag(),
            "quality" to (if (v.quality >= 400) "premium" else if (v.quality >= 300) "enhanced" else "default"),
            "network" to v.isNetworkConnectionRequired,
            "installed" to !(v.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) ?: false)
          )
        }
        promise.resolve(out)
      }
    }

    AsyncFunction("synthesize") { text: String, voiceId: String, rate: Double, pitch: Double, outPath: String, promise: Promise ->
      withTts { t ->
        if (t == null) { promise.reject("Tts", "No text-to-speech engine on this phone. Install Google Speech Services.", null); return@withTts }
        if (voiceId.isNotEmpty()) t.voices?.firstOrNull { it.name == voiceId }?.let { t.voice = it }
        t.setSpeechRate(rate.toFloat())
        t.setPitch(pitch.toFloat())
        val path = outPath.removePrefix("file://")
        val id = UUID.randomUUID().toString()
        pending[id] = Pair(promise, path)
        val r = t.synthesizeToFile(text, Bundle(), File(path), id)
        if (r != TextToSpeech.SUCCESS) {
          pending.remove(id)
          promise.reject("Tts", "The phone voice couldn't start", null)
        }
      }
    }

    AsyncFunction("pdfText") { path: String, promise: Promise ->
      Thread {
        try {
          val ctx = appContext.reactContext ?: throw Exception("No context")
          PDFBoxResourceLoader.init(ctx.applicationContext)
          val pages = mutableListOf<String>()
          PDDocument.load(File(path.removePrefix("file://"))).use { doc ->
            val stripper = PDFTextStripper()
            for (i in 1..doc.numberOfPages) {
              stripper.startPage = i
              stripper.endPage = i
              pages.add(stripper.getText(doc))
            }
          }
          promise.resolve(pages)
        } catch (e: Exception) {
          promise.reject("PdfOpen", e.message ?: "Could not open this PDF", e)
        }
      }.start()
    }
  }

  /** Reads the sample rate from a WAV header (Android engines write 16-bit PCM WAV). */
  private fun wavSampleRate(path: String): Int {
    RandomAccessFile(path, "r").use { f ->
      val b = ByteArray(28)
      f.readFully(b)
      return (b[24].toInt() and 0xff) or ((b[25].toInt() and 0xff) shl 8) or
        ((b[26].toInt() and 0xff) shl 16) or ((b[27].toInt() and 0xff) shl 24)
    }
  }
}
