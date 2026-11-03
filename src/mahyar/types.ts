export type ShotMode = "full" | "region" | "paste" | "file" | "sample";

export type OcrLang = "fas+eng" | "fas" | "eng";

export type ShortcutPreset = "ctrl" | "alt" | "print";

export type HistoryItem = {
  id: string;
  createdAt: number;
  mode: ShotMode;
  text: string;
  confidence: number | null;
  url: string;
};
