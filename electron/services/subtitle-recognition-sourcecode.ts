/**
 * 模力方舟平台字幕识别服务（OpenAI 兼容 API）
 *
 * 调用端点：https://api.moark.com/v1/audio/transcriptions
 * 模型：whisper-large-v3，失败时改用 whisper-large-v3-turbo。
 * 音频会先转成 16kHz 单声道 mp3，再按官方字段提交（model、language、file）。
 *
 * 音频来源可能是远程 URL 或本地文件路径：
 *   - 远程 URL：主进程先下载为 Buffer，再以 multipart/form-data 形式提交
 *   - 本地路径：主进程直接读取文件后提交
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { resolveFfmpegPath } from "./_shared/ffmpeg-path";

import type {
  SubtitleRecognitionResult,
  SubtitleSegment,
} from "./subtitle-recognition";

const execFileAsync = promisify(execFile);

const MOARK_BASE_URL = "https://api.moark.com/v1";
const DEFAULT_MODEL = "whisper-large-v3";
const FALLBACK_MODEL = "whisper-large-v3-turbo";

interface MoarkTranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  [key: string]: unknown;
}

interface MoarkTranscriptionChunk {
  text?: string;
  start?: number;
  end?: number;
  timestamp?: Array<number | null>;
  timestamps?: Array<number | null>;
}

interface MoarkTranscriptionResponse {
  duration?: string | number;
  language?: string;
  text?: string;
  segments?: MoarkTranscriptionSegment[];
  chunks?: MoarkTranscriptionChunk[];
  [key: string]: unknown;
}

/**
 * 下载远端音频文件为 Buffer
 */
async function downloadAudioBuffer(
  url: string,
  signal: AbortSignal,
): Promise<{ buffer: Buffer; fileName: string }> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`下载音频失败: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  // 从 URL 中提取文件名
  const urlPath = new URL(url).pathname;
  const fileName = basename(urlPath) || "audio.mp3";
  return { buffer: Buffer.from(arrayBuffer), fileName };
}

/**
 * 读取本地音频文件为 Buffer
 */
async function readLocalAudioBuffer(
  filePath: string,
): Promise<{ buffer: Buffer; fileName: string }> {
  const buffer = await readFile(filePath);
  const fileName = basename(filePath);
  return { buffer, fileName };
}

function parseDurationSeconds(ffmpegStderr: string): number {
  const match = ffmpegStderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) {
    return 0;
  }

  return (
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
  );
}

/**
 * 合成音频的扩展名是按下载地址猜的，内容和扩展名经常对不上。
 * 先转成 16kHz 单声道 mp3，避免识别服务把异常音频当成内部错误。
 */
async function transcodeToMp3(
  audioBuffer: Buffer,
): Promise<{ buffer: Buffer; durationSec: number }> {
  const dir = await mkdtemp(join(tmpdir(), "subtitle-asr-"));
  const inputPath = join(dir, "input.bin");
  const outputPath = join(dir, "audio.mp3");

  try {
    await writeFile(inputPath, audioBuffer);
    const { stderr } = await execFileAsync(
      resolveFfmpegPath(),
      [
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "64k",
        outputPath,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const buffer = await readFile(outputPath);
    if (buffer.length < 1024) {
      throw new Error("音频转码结果为空");
    }

    return {
      buffer,
      durationSec: parseDurationSeconds(String(stderr ?? "")),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function requestTranscription(
  apiKey: string,
  audioBuffer: Buffer,
  model: string,
  verbose: boolean,
  signal: AbortSignal,
): Promise<Response> {
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([audioBuffer], { type: "audio/mpeg" }),
    "audio.mp3",
  );
  formData.append("model", model);
  formData.append("language", "zh");
  if (verbose) {
    formData.append("response_format", "verbose_json");
  }

  return fetch(`${MOARK_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
    signal,
  });
}

/**
 * 模力方舟字幕识别入口
 *
 * @param apiKey 模力方舟 API KEY
 * @param audioSource 音频来源（远程 URL 或本地文件绝对路径）
 * @param signal 取消信号
 */
export async function recognizeMoarkSubtitles(
  apiKey: string,
  audioSource: string,
  signal: AbortSignal,
  modelName?: string,
): Promise<SubtitleRecognitionResult> {
  let audioBuffer: Buffer;

  if (audioSource.startsWith("local-audio://synthesized/")) {
    const { join: joinPath, basename: baseName } = await import("node:path");
    const { app } = await import("electron");
    const decodedName = baseName(
      decodeURIComponent(new URL(audioSource).pathname.replace(/^\/+/, "")),
    );
    const filePath = joinPath(
      app.getPath("temp"),
      "free-super-agent",
      "synthesized-audio",
      decodedName,
    );
    audioBuffer = await readFile(filePath);
  } else if (/^https?:\/\//i.test(audioSource)) {
    audioBuffer = (await downloadAudioBuffer(audioSource, signal)).buffer;
  } else {
    audioBuffer = (await readLocalAudioBuffer(audioSource)).buffer;
  }

  if (audioBuffer.length < 1024) {
    throw new Error("音频文件过小，无法识别字幕");
  }

  let prepared: { buffer: Buffer; durationSec: number };
  try {
    prepared = await transcodeToMp3(audioBuffer);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    throw new Error("音频转码失败，无法识别字幕");
  }

  const model = modelName?.trim() || DEFAULT_MODEL;
  const attempts: Array<{ model: string; verbose: boolean }> = [
    { model, verbose: true },
    { model, verbose: false },
  ];
  if (model !== FALLBACK_MODEL) {
    attempts.push({ model: FALLBACK_MODEL, verbose: true });
    attempts.push({ model: FALLBACK_MODEL, verbose: false });
  }

  let response: Response | undefined;
  let lastError = "";
  for (const attempt of attempts) {
    response = await requestTranscription(
      apiKey,
      prepared.buffer,
      attempt.model,
      attempt.verbose,
      signal,
    );
    if (response.ok) {
      break;
    }
    lastError = await response.text().catch(() => "");
    if (response.status !== 500 && response.status !== 400) {
      break;
    }
  }

  if (!response?.ok) {
    if (response?.status === 401) {
      throw new Error("模力方舟 API Key 无效或已过期，请重新登录");
    }
    const detail = lastError.includes("unexpected error")
      ? ""
      : lastError.replace(/\s+/g, " ").slice(0, 180);
    throw new Error(
      detail
        ? `模力方舟字幕识别失败（${response?.status ?? 500}）：${detail}`
        : "模力方舟字幕识别失败，服务暂时无法处理这段音频，请稍后重试",
    );
  }

  const data = (await response.json()) as MoarkTranscriptionResponse;
  let subtitles = readSubtitleSegments(data);
  const fullText =
    typeof data.text === "string"
      ? data.text.trim()
      : subtitles.map((item) => item.text).join("");

  if (subtitles.length === 0 && fullText) {
    subtitles = splitTextToSubtitles(fullText, prepared.durationSec);
  }

  if (subtitles.length === 0) {
    throw new Error("模力方舟转写结果为空");
  }

  const srt = subtitles
    .map((item, index) => {
      const startTime = formatSrtTime(item.start);
      const endTime = formatSrtTime(item.end);
      return `${index + 1}\n${startTime} --> ${endTime}\n${item.text}\n`;
    })
    .join("\n");

  return {
    executionTimeMs: 0,
    requestId: "",
    srt,
    status: "completed",
    subtitles,
    text: fullText,
  };
}

function readTimePair(value: Array<number | null> | undefined): {
  start: number;
  end: number;
} | null {
  if (!value || value.length === 0) {
    return null;
  }
  const start = typeof value[0] === "number" ? value[0] : 0;
  const end = typeof value[1] === "number" ? value[1] : start;
  return { start, end };
}

function readSubtitleSegments(
  data: MoarkTranscriptionResponse,
): SubtitleSegment[] {
  if (Array.isArray(data.segments) && data.segments.length > 0) {
    return data.segments
      .map((seg, index) => ({
        id: `segment-${index + 1}`,
        start: typeof seg.start === "number" ? seg.start : 0,
        end: typeof seg.end === "number" ? seg.end : 0,
        text: typeof seg.text === "string" ? seg.text.trim() : "",
      }))
      .filter((item) => item.text);
  }

  if (!Array.isArray(data.chunks)) {
    return [];
  }

  return data.chunks
    .map((chunk, index) => {
      const pair =
        readTimePair(chunk.timestamp) ?? readTimePair(chunk.timestamps);
      return {
        id: `segment-${index + 1}`,
        start:
          pair?.start ?? (typeof chunk.start === "number" ? chunk.start : 0),
        end: pair?.end ?? (typeof chunk.end === "number" ? chunk.end : 0),
        text: typeof chunk.text === "string" ? chunk.text.trim() : "",
      };
    })
    .filter((item) => item.text);
}

function splitTextToSubtitles(
  text: string,
  durationSec: number,
): SubtitleSegment[] {
  const pieces = text
    .split(/(?<=[。！？!?；;\n])/)
    .map((item) => item.trim())
    .filter(Boolean);
  const lines = pieces.length > 0 ? pieces : [text.trim()].filter(Boolean);
  if (lines.length === 0) {
    return [];
  }

  const total = Math.max(durationSec, lines.length * 0.4);
  const slice = total / lines.length;
  return lines.map((line, index) => ({
    id: `segment-${index + 1}`,
    start: Number((index * slice).toFixed(3)),
    end: Number(
      (index === lines.length - 1 ? total : (index + 1) * slice).toFixed(3),
    ),
    text: line,
  }));
}

/**
 * 将秒数转为 SRT 时间格式 (HH:MM:SS,mmm)
 */
function formatSrtTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}
