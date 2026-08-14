/**
 * Local Voice-to-Text - Direct Whisper API implementation
 *
 * This replaces the Dyad Engine's server-side Voice-to-Text with a local implementation
 * that works with any provider's OpenAI-compatible API.
 *
 * Supports:
 * - OpenAI Whisper API (via any OpenAI-compatible provider)
 * - Local Whisper models (future)
 */

import log from "electron-log";
import { readFile } from "fs/promises";
import path from "path";
import { readSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("local_transcribe");

export interface TranscribeOptions {
  /** Audio buffer to transcribe */
  audioBuffer: Buffer;
  /** Filename for MIME type detection */
  filename: string;
  /** Request ID for tracking */
  requestId: string;
  /** Language hint (optional) */
  language?: string;
}

export interface TranscribeResult {
  /** Transcribed text */
  text: string;
  /** Provider used */
  provider: string;
}

// ─── MIME Type Detection ────────────────────────────────────────────────────

function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    webm: "audio/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    flac: "audio/flac",
  };
  return mimeMap[ext || ""] || "audio/webm";
}

// ─── Provider Detection ─────────────────────────────────────────────────────

/**
 * Get the OpenAI-compatible API endpoint for transcription.
 * Checks providers in order: openai, then any other provider with OpenAI-compatible API.
 */
function getTranscriptionEndpoint(): { url: string; apiKey: string } | null {
  const settings = readSettings();

  // Check OpenAI first (has native Whisper support)
  const openaiConfig = settings.providerSettings?.openai;
  if (openaiConfig?.apiKey?.value) {
    return {
      url: "https://api.openai.com/v1/audio/transcriptions",
      apiKey: openaiConfig.apiKey.value,
    };
  }

  // Check for any OpenAI-compatible provider
  // (OpenRouter, Together, Groq, etc. support Whisper)
  const compatibleProviders = ["openrouter", "together", "groq", "fireworks"];
  for (const provider of compatibleProviders) {
    const config = settings.providerSettings?.[provider];
    if (config?.apiKey?.value) {
      // These providers typically use OpenAI-compatible endpoints
      return {
        url: `https://api.${provider}.com/v1/audio/transcriptions`,
        apiKey: config.apiKey.value,
      };
    }
  }

  return null;
}

// ─── Main Transcription Function ────────────────────────────────────────────

/**
 * Transcribe audio using the OpenAI Whisper API.
 *
 * This is the local equivalent of the Dyad Engine's server-side Voice-to-Text.
 * It uses the user's own API key to call the Whisper API directly.
 *
 * @param options - Transcription options
 * @returns Transcribed text
 */
export async function localTranscribe(
  options: TranscribeOptions,
): Promise<TranscribeResult> {
  const { audioBuffer, filename, language } = options;

  const startTime = Date.now();
  logger.log(`Transcribing audio: ${filename} (${audioBuffer.length} bytes)`);

  // Get transcription endpoint
  const endpoint = getTranscriptionEndpoint();
  if (!endpoint) {
    throw new DyadError(
      "No OpenAI-compatible provider configured for transcription. Please configure OpenAI or another provider with Whisper support.",
      DyadErrorKind.Auth,
    );
  }

  // Create FormData
  const formData = new FormData();
  const mimeType = getMimeType(filename);
  const audioBytes = new Uint8Array(
    audioBuffer.buffer as ArrayBuffer,
    audioBuffer.byteOffset,
    audioBuffer.byteLength,
  );
  const blob = new Blob([audioBytes], { type: mimeType });
  formData.append("file", blob, filename);
  formData.append("model", "whisper-1");

  if (language) {
    formData.append("language", language);
  }

  // Call Whisper API
  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${endpoint.apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new DyadError(
      `Transcription failed: ${response.status} ${response.statusText} - ${errorText}`,
      DyadErrorKind.External,
    );
  }

  const data = (await response.json()) as { text: string };
  const elapsed = Date.now() - startTime;

  logger.log(
    `Transcription completed in ${elapsed}ms: "${data.text.substring(0, 50)}..."`,
  );

  return {
    text: data.text,
    provider: endpoint.url.includes("openai") ? "openai" : "compatible",
  };
}

// ─── File-based Transcription Wrapper ────────────────────────────────────────

/**
 * Transcribe audio from a file path.
 * Reads the file from disk and delegates to localTranscribe.
 *
 * @param options - Audio path and optional language
 * @returns Transcribed text and detected language
 */
export async function transcribeAudio(options: {
  audioPath: string;
  language?: string;
}): Promise<{ text: string; language: string }> {
  const { audioPath, language } = options;

  const audioBuffer = await readFile(audioPath);
  const filename = path.basename(audioPath);

  const result = await localTranscribe({
    audioBuffer,
    filename,
    requestId: `transcribe-${Date.now()}`,
    language,
  });

  return {
    text: result.text,
    language: language || "auto",
  };
}
