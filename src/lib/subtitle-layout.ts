export type SubtitleBreakMode = "sentence" | "clause";

const SENTENCE_END = /[。！？!?，,]/;

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

/**
 * 把每条字幕拆成前后几屏：同一时刻只保留一句。
 * 断句和文案创作一致：在句号、问号、感叹号、逗号处断开。
 * 字数是上限：短句保持原长，不必凑满。超过上限时先按句内标点拆开。
 * clause 模式则在任意标点处切屏，同样不显示标点。
 */
export function expandSubtitleCues(
  cues: SubtitleCue[],
  maxChars: number,
  mode: SubtitleBreakMode = "sentence",
): SubtitleCue[] {
  const limit = Math.max(4, Math.floor(maxChars));
  const pages: SubtitleCue[] = [];

  for (const cue of cues) {
    const pieces = pagesForText(cue.text, limit, mode);
    if (pieces.length === 0) continue;

    const weights = pieces.map((piece) => Math.max(1, Array.from(piece).length));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const span = Math.max(0.05, cue.end - cue.start);
    let cursor = cue.start;

    pieces.forEach((text, index) => {
      const isLast = index === pieces.length - 1;
      const next = cursor + (span * weights[index]) / totalWeight;
      const end = isLast ? cue.end : Math.max(next, cursor + 0.05);
      pages.push({
        start: roundTime(cursor),
        end: roundTime(end),
        text,
      });
      cursor = end;
    });
  }

  return pages;
}

function pagesForText(
  text: string,
  limit: number,
  mode: SubtitleBreakMode,
): string[] {
  const pages: string[] = [];
  for (const sentence of splitPieces(text, mode)) {
    const plain = stripSubtitlePunctuation(sentence);
    if (!plain) continue;
    if (Array.from(plain).length <= limit) {
      pages.push(plain);
      continue;
    }

    const clauses = splitPieces(sentence, "clause");
    if (clauses.length <= 1) {
      pages.push(...hardWrap(plain, limit));
      continue;
    }

    for (const clause of clauses) {
      const clausePlain = stripSubtitlePunctuation(clause);
      if (!clausePlain) continue;
      if (Array.from(clausePlain).length <= limit) {
        pages.push(clausePlain);
        continue;
      }
      pages.push(...hardWrap(clausePlain, limit));
    }
  }
  return pages;
}

function hardWrap(text: string, limit: number): string[] {
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let index = 0; index < chars.length; index += limit) {
    chunks.push(chars.slice(index, index + limit).join(""));
  }
  return chunks;
}

function splitPieces(text: string, mode: SubtitleBreakMode): string[] {
  const chars = Array.from(text);
  const parts: string[] = [];
  let buffer = "";

  for (let index = 0; index < chars.length; index += 1) {
    const ch = chars[index];
    if (ch === "\n") {
      pushPiece(parts, buffer);
      buffer = "";
      continue;
    }

    const breaks =
      mode === "sentence"
        ? isSentenceEnd(chars, index)
        : isClauseBreak(chars, index);
    if (breaks) {
      pushPiece(parts, buffer);
      buffer = "";
      continue;
    }

    buffer += ch;
  }

  pushPiece(parts, buffer);
  return parts;
}

function pushPiece(parts: string[], buffer: string): void {
  if (buffer.trim()) parts.push(buffer);
}

function isSentenceEnd(chars: string[], index: number): boolean {
  const ch = chars[index];
  if (!SENTENCE_END.test(ch)) return false;
  if (ch === "." && isDecimalDot(chars, index)) return false;
  if ((ch === "," || ch === "，") && isDecimalDot(chars, index)) return false;
  return true;
}

function isClauseBreak(chars: string[], index: number): boolean {
  const ch = chars[index];
  if (!/\p{P}/u.test(ch)) return false;
  if ((ch === "." || ch === "．") && isDecimalDot(chars, index)) return false;
  return true;
}

function isDecimalDot(chars: string[], index: number): boolean {
  const prev = chars[index - 1];
  const next = chars[index + 1];
  return Boolean(prev && next && /\d/.test(prev) && /\d/.test(next));
}

export function stripSubtitlePunctuation(text: string): string {
  const chars = Array.from(text);
  let result = "";
  for (let index = 0; index < chars.length; index += 1) {
    const ch = chars[index];
    if ((ch === "." || ch === "．") && isDecimalDot(chars, index)) {
      result += ch;
      continue;
    }
    if (/\p{P}/u.test(ch)) continue;
    result += ch;
  }
  return result.replace(/\s+/g, " ").trim();
}

function roundTime(value: number): number {
  return Number(value.toFixed(3));
}

/** 每条字幕原样上屏，相邻句的时间不重叠，避免两句同时出现。 */
export function displaySubtitleCues(cues: SubtitleCue[]): SubtitleCue[] {
  const sorted = cues
    .filter((cue) => cue.text.trim())
    .map((cue) => ({
      start: cue.start,
      end: cue.end,
      text: cue.text.trim(),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  return sorted
    .map((cue, index) => {
      const next = sorted[index + 1];
      if (!next || cue.end <= next.start) return cue;
      return {
        ...cue,
        end: roundTime(Math.max(cue.start, next.start - 0.001)),
      };
    })
    .filter((cue) => cue.end > cue.start);
}

/**
 * 按文案创作的句子切开：在句号、问号、感叹号、逗号和换行处断开。
 */
export function splitSpokenSentences(text: string): string[] {
  const chars = Array.from(text);
  const parts: string[] = [];
  let buffer = "";

  for (let index = 0; index < chars.length; index += 1) {
    const ch = chars[index];
    if (ch === "\n" || ch === "\r") {
      pushPiece(parts, buffer);
      buffer = "";
      continue;
    }
    buffer += ch;
    if (isSentenceEnd(chars, index)) {
      pushPiece(parts, buffer);
      buffer = "";
    }
  }

  pushPiece(parts, buffer);
  return parts;
}

/**
 * 用识别结果的时间轴，把字幕改成和文案创作相同的句子。
 * 画面上不保留标点。没有创作文案时保持识别结果。
 */
export function alignSpokenSentences(
  copyText: string,
  cues: SubtitleCue[],
): SubtitleCue[] {
  const sentences = splitSpokenSentences(copyText)
    .map((sentence) => stripSubtitlePunctuation(sentence))
    .filter((sentence) => sentence.length > 0);
  if (sentences.length === 0 || cues.length === 0) return cues;

  const marks = cues.flatMap((cue) => {
    const chars = Array.from(stripSubtitlePunctuation(cue.text));
    if (chars.length === 0) return [];
    const span = Math.max(0.05, cue.end - cue.start);
    return chars.map((ch, index) => ({
      ch,
      start: cue.start + (span * index) / chars.length,
      end: cue.start + (span * (index + 1)) / chars.length,
    }));
  });
  if (marks.length === 0) return cues;

  const weights = sentences.map((sentence) =>
    Math.max(1, Array.from(sentence).length),
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let consumed = 0;

  const aligned = sentences.map((text, index) => {
    const startIndex = Math.min(
      marks.length - 1,
      Math.floor((consumed / totalWeight) * marks.length),
    );
    consumed += weights[index];
    const endIndex =
      index === sentences.length - 1
        ? marks.length - 1
        : Math.min(
            marks.length - 1,
            Math.max(
              startIndex,
              Math.ceil((consumed / totalWeight) * marks.length) - 1,
            ),
          );
    const start = marks[startIndex]?.start ?? cues[0].start;
    const end = Math.max(
      start + 0.05,
      marks[endIndex]?.end ?? cues[cues.length - 1].end,
    );
    return {
      start: roundTime(start),
      end: roundTime(end),
      text,
    };
  });
  return displaySubtitleCues(aligned);
}
