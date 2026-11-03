import type { Worker } from "tesseract.js";
import type { OcrLang } from "@/mahyar/types";
import { ocrRuntime } from "@/mahyar/desktop";

const STATUS_FA: Record<string, string> = {
  "loading tesseract core": "بارگذاری موتور متن‌خوان",
  "loading language traineddata": "بارگذاری مدل فارسی و انگلیسی",
  "initializing tesseract": "آماده‌سازی",
  "initializing api": "آماده‌سازی",
  "recognizing text": "خواندن متن تصویر",
};

type Engine = { lang: OcrLang; worker: Worker };

let engine: Engine | null = null;
let chain: Promise<unknown> = Promise.resolve();
let progressSink: (label: string, value: number) => void = () => {};

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function prepareImage(blob: Blob, precise: boolean): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const longest = Math.max(bitmap.width, bitmap.height);
  const maxEdge = 2400;
  let scale = precise && longest < 1400 ? 2 : 1;
  if (longest * scale > maxEdge) scale = maxEdge / longest;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return blob;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return out ?? blob;
}

async function ensureWorker(lang: OcrLang): Promise<Worker> {
  if (engine?.lang === lang) return engine.worker;
  if (engine) {
    await engine.worker.terminate();
    engine = null;
  }
  const paths = ocrRuntime();
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(lang, 1, {
    workerPath: paths.workerPath,
    corePath: paths.corePath,
    langPath: paths.langPath,
    workerBlobURL: true,
    gzip: true,
    logger: (message) => {
      const label = STATUS_FA[message.status] ?? "در حال کار";
      const value = Number.isFinite(message.progress) ? message.progress : 0;
      progressSink(label, value);
    },
  });
  await worker.setParameters({
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });
  engine = { lang, worker };
  return worker;
}

export async function recognizeImage(
  blob: Blob,
  lang: OcrLang,
  precise: boolean,
  onProgress: (label: string, value: number) => void,
): Promise<{ text: string; confidence: number }> {
  return enqueue(async () => {
    progressSink = onProgress;
    onProgress("آماده‌سازی عکس", 0.02);
    const prepared = await prepareImage(blob, precise);
    const worker = await ensureWorker(lang);
    const result = await worker.recognize(prepared, {}, { text: true });
    const text = (result.data.text ?? "").replace(/[ \t]+\n/g, "\n").trim();
    const confidence = Math.round(result.data.confidence ?? 0);
    return { text, confidence };
  });
}
