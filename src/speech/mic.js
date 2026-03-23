// FILE: src/speech/mic.js
// NewsPilot Fix 6 – Voice capture (WAV/PCM16)
// - Records microphone audio as WAV (PCM16, mono).
// - Transcription is handled separately (OpenAI Whisper) if a Speech API key is provided.

export function isRecordingSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// We do not use browser-native STT here; STT is optional via OpenAI Whisper.
export function isSpeechSupported() {
  return false;
}

/**
 * startVoiceSession()
 * Options:
 *  { lang?: string, maxMs?: number }
 *
 * Returns:
 *  { stop(): Promise<{ blob, url, text, meta }> }
 */
export async function startVoiceSession(options = {}) {
  const {
    lang = (navigator.language || "en-US"),
    maxMs = 120000
  } = options;

  if (!isRecordingSupported()) {
    throw new Error("recording_not_supported");
  }

  // Desktop (Electron/Chromium) + Web: WAV/PCM16 recording
  return startWavSession({ lang, maxMs });
}

/* =========================
   WAV (PCM16) Encoder
========================= */

function encodeWavPCM16({ samples, sampleRate, numChannels }) {
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF header
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");

  // fmt chunk
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);      // PCM
  view.setUint16(20, 1, true);       // AudioFormat = 1 (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);      // bits per sample

  // data chunk
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    let s = samples[i];
    s = Math.max(-1, Math.min(1, s));
    const int16 = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/* =========================
   WAV Recording Session
========================= */

async function startWavSession({ lang, maxMs }) {
  // 1) Get audio stream
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });

  // 2) Build Web Audio graph
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  // Ensure running (user gesture should already exist via button click)
  try { await ctx.resume(); } catch (_) {}

  const source = ctx.createMediaStreamSource(stream);

  const bufferSize = 4096;
  const numChannels = 1; // mono
  const processor = ctx.createScriptProcessor(bufferSize, numChannels, numChannels);

  // Silent sink to keep processor alive without playing audio to speakers
  const sink = ctx.createGain();
  sink.gain.value = 0;

  const chunks = [];
  let stopped = false;
  let stopPromise = null; // FIX: idempotent stop
  const startedAt = Date.now();

  processor.onaudioprocess = (e) => {
    if (stopped) return;
    const input = e.inputBuffer.getChannelData(0);
    // Copy the chunk (do not keep references to the underlying buffer)
    chunks.push(new Float32Array(input));
  };

  source.connect(processor);
  processor.connect(sink);
  sink.connect(ctx.destination);

  // FIX: Auto-stop only if maxMs is provided and > 0
  let timer = null;
  const max = Number.isFinite(maxMs) ? (maxMs | 0) : 0;
  if (max > 0) {
    // keep your "at least 5 seconds" safety behavior, but only when maxMs is used
    const safeMs = Math.max(5000, max);
    timer = setTimeout(() => {
      try { session.stop(); } catch (_) {}
    }, safeMs);
  }

  const session = {
    async stop() {
      // FIX: idempotent stop (no throw, return same promise)
      if (stopPromise) return stopPromise;

      stopPromise = (async () => {
        if (stopped) {
          // in case state flips before stopPromise set, still return a stable object
          return null;
        }
        stopped = true;

        if (timer) {
          try { clearTimeout(timer); } catch (_) {}
          timer = null;
        }

        try { processor.disconnect(); } catch (_) {}
        try { source.disconnect(); } catch (_) {}
        try { sink.disconnect(); } catch (_) {}
        try { stream.getTracks().forEach((t) => t.stop()); } catch (_) {}

        const totalLen = chunks.reduce((a, c) => a + c.length, 0);
        const samples = new Float32Array(totalLen);
        let off = 0;
        for (const c of chunks) {
          samples.set(c, off);
          off += c.length;
        }

        const sampleRate = ctx.sampleRate || 44100;

        const wavBlob = encodeWavPCM16({
          samples,
          sampleRate,
          numChannels
        });

        try { await ctx.close(); } catch (_) {}

        const endedAt = Date.now();
        const url = URL.createObjectURL(wavBlob);

        return {
          blob: wavBlob,
          url,
          text: "", // STT (OpenAI) fills this optionally in UI layer
          meta: {
            mimeType: "audio/wav",
            format: "wav_pcm16",
            lang,
            numChannels,
            sampleRate,
            startedAt,
            endedAt,
            durationMs: endedAt - startedAt,
            sizeBytes: wavBlob.size
          }
        };
      })();

      const res = await stopPromise;
      // res null ise bile UI’nın patlamaması için güvenli dönüş:
      return res || {
        blob: new Blob([], { type: "audio/wav" }),
        url: "",
        text: "",
        meta: {
          mimeType: "audio/wav",
          format: "wav_pcm16",
          lang,
          numChannels: 1,
          sampleRate: 44100,
          startedAt,
          endedAt: Date.now(),
          durationMs: 0,
          sizeBytes: 0
        }
      };
    }
  };

  return session;
}
