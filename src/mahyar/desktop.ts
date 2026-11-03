import type { ShortcutPreset, ShotMode } from "@/mahyar/types";

export type CaptureResult =
  | { ok: true; dataUrl: string }
  | { ok: false; cancelled?: boolean; error?: string };

export type OcrRuntimePaths = {
  workerPath: string;
  corePath: string;
  langPath: string;
};

export type MahyarDesktop = {
  isDesktop: true;
  runtime: OcrRuntimePaths;
  captureFull: () => Promise<CaptureResult>;
  captureRegion: () => Promise<CaptureResult>;
  savePng: (dataUrl: string) => Promise<boolean>;
  copyImage: (dataUrl: string) => Promise<boolean>;
  setShortcuts: (preset: ShortcutPreset) => Promise<{ failed: string[] }>;
  onGlobalCapture: (cb: (payload: { mode: ShotMode; dataUrl: string }) => void) => () => void;
};

declare global {
  interface Window {
    mahyarDesktop?: MahyarDesktop;
  }
}

export function pageBase(): string {
  const url = new URL(document.baseURI);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

export function ocrRuntime(): OcrRuntimePaths {
  const desktop = window.mahyarDesktop;
  if (desktop?.runtime) return desktop.runtime;
  const base = pageBase();
  return {
    workerPath: new URL("ocr/worker.min.js", base).href,
    corePath: new URL("ocr/", base).href.replace(/\/$/, ""),
    langPath: new URL("tessdata/", base).href.replace(/\/$/, ""),
  };
}
