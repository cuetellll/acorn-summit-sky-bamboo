import { useEffect, useRef, useState } from "react";
import {
  Aperture,
  Check,
  ClipboardPaste,
  Copy,
  Crop,
  FileImage,
  FolderOpen,
  Keyboard,
  LoaderCircle,
  Monitor,
  Sparkles,
  Trash2,
  Type,
} from "lucide-react";
import mark from "@/assets/mark.png";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  captureErrorMessage,
  copyImageBlob,
  dataUrlToBlob,
  grabScreen,
  isCancelled,
  makeSampleBlob,
  saveImageBlob,
} from "@/mahyar/capture";
import { Cropper } from "@/mahyar/cropper";
import { addShot, deleteShot, getShotBlob, listShots, updateShotText } from "@/mahyar/history";
import { recognizeImage } from "@/mahyar/ocr";
import type { HistoryItem, OcrLang, ShortcutPreset, ShotMode } from "@/mahyar/types";

const SETTINGS_KEY = "mahyar-settings-v1";

const LANGS: { id: OcrLang; label: string }[] = [
  { id: "fas+eng", label: "هر دو" },
  { id: "fas", label: "فارسی" },
  { id: "eng", label: "انگلیسی" },
];

const PRESETS: { id: ShortcutPreset; label: string; region: string; full: string }[] = [
  { id: "ctrl", label: "Ctrl", region: "Ctrl+Shift+S", full: "Ctrl+Shift+F" },
  { id: "alt", label: "Alt", region: "Alt+Shift+S", full: "Alt+Shift+F" },
  { id: "print", label: "Print", region: "PrintScreen", full: "Ctrl+PrintScreen" },
];

type Settings = {
  lang: OcrLang;
  precise: boolean;
  autoOcr: boolean;
  preset: ShortcutPreset;
};

function loadSettings(): Settings {
  const fallback: Settings = { lang: "fas+eng", precise: true, autoOcr: true, preset: "ctrl" };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return fallback;
  }
}

function matches(
  event: KeyboardEvent,
  kind: "region" | "full",
  preset: ShortcutPreset,
): boolean {
  const key = event.key.toLowerCase();
  if (preset === "print") {
    if (key !== "printscreen") return false;
    return kind === "full" ? event.ctrlKey && !event.shiftKey : !event.ctrlKey && !event.shiftKey;
  }
  const want = kind === "region" ? "s" : "f";
  if (key !== want || !event.shiftKey) return false;
  return preset === "alt" ? event.altKey && !event.ctrlKey : event.ctrlKey && !event.altKey;
}

export function App() {
  const [desktop, setDesktop] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [lang, setLang] = useState<OcrLang>("fas+eng");
  const [precise, setPrecise] = useState(true);
  const [autoOcr, setAutoOcr] = useState(true);
  const [preset, setPreset] = useState<ShortcutPreset>("ctrl");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [shotId, setShotId] = useState<string | null>(null);
  const [mode, setMode] = useState<ShotMode | null>(null);
  const [text, setText] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [busy, setBusy] = useState<"capture" | "read" | null>(null);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("آماده");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [cropUrl, setCropUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const historyUrls = useRef<string[]>([]);
  const runId = useRef(0);
  const actions = useRef({
    take: async (_kind: "full" | "region") => {},
    copyText: async () => {},
    read: async () => {},
  });

  async function refreshHistory() {
    const items = await listShots();
    for (const item of historyUrls.current) URL.revokeObjectURL(item);
    historyUrls.current = items.map((item) => item.url);
    setHistory(items);
  }

  function replaceUrl(next: string | null) {
    setUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return next;
    });
  }

  async function remember(next: Blob, shotMode: ShotMode, value: string, score: number | null) {
    const id = crypto.randomUUID();
    setShotId(id);
    await addShot({ id, mode: shotMode, text: value, confidence: score, blob: next });
    await refreshHistory();
    return id;
  }

  async function readBlob(next: Blob, id: string | null) {
    const token = ++runId.current;
    setBusy("read");
    setError(null);
    setProgress(0.04);
    setPhase("خواندن متن");
    try {
      const result = await recognizeImage(next, lang, precise, (label, value) => {
        if (token !== runId.current) return;
        setPhase(label);
        setProgress(Math.max(0.04, Math.min(1, value || 0)));
      });
      if (token !== runId.current) return;
      setText(result.text);
      setConfidence(result.confidence);
      setPhase(result.text ? "متن آماده است" : "متنی در عکس پیدا نشد");
      if (id) {
        await updateShotText(id, result.text, result.confidence);
        setHistory((items) =>
          items.map((item) =>
            item.id === id ? { ...item, text: result.text, confidence: result.confidence } : item,
          ),
        );
      }
      if (!result.text) setError("متنی دیده نشد. ناحیه را تنگ‌تر دور نوشته بگیر یا زبان را عوض کن.");
    } catch (reason) {
      if (token !== runId.current) return;
      setPhase("خطا در خواندن");
      setError(reason instanceof Error ? reason.message : "خواندن متن ناموفق بود.");
    } finally {
      if (token === runId.current) {
        setBusy(null);
        setProgress(0);
      }
    }
  }

  async function acceptBlob(next: Blob, shotMode: ShotMode, runRead: boolean) {
    setBlob(next);
    setMode(shotMode);
    setText("");
    setConfidence(null);
    setError(null);
    replaceUrl(URL.createObjectURL(next));
    const id = await remember(next, shotMode, "", null);
    if (runRead && autoOcr) await readBlob(next, id);
    else setPhase("عکس آماده است");
  }

  async function take(kind: "full" | "region") {
    if (busy) return;
    setBusy("capture");
    setError(null);
    setPhase(kind === "full" ? "گرفتن تمام صفحه" : "گرفتن ناحیه");
    try {
      const desk = window.mahyarDesktop;
      if (desk) {
        const result = kind === "full" ? await desk.captureFull() : await desk.captureRegion();
        if (isCancelled(result)) {
          setPhase("لغو شد");
          return;
        }
        if (!result.ok) throw new Error(result.error || "عکس گرفته نشد.");
        await acceptBlob(await dataUrlToBlob(result.dataUrl), kind, true);
        return;
      }
      const shot = await grabScreen();
      if (kind === "region") {
        setCropUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return URL.createObjectURL(shot);
        });
        setPhase("ناحیه را انتخاب کن");
        return;
      }
      await acceptBlob(shot, "full", true);
    } catch (reason) {
      setPhase("متوقف شد");
      setError(captureErrorMessage(reason));
    } finally {
      setBusy(null);
    }
  }

  async function copyText() {
    if (!text.trim()) {
      setFlash("متنی برای کپی نیست");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setFlash("متن کپی شد");
    } catch {
      setFlash("کپی ممکن نشد");
    }
  }

  const acceptRef = useRef(acceptBlob);
  acceptRef.current = acceptBlob;

  actions.current = {
    take,
    copyText,
    read: async () => {
      if (blob) await readBlob(blob, shotId);
    },
  };

  useEffect(() => {
    const saved = loadSettings();
    setLang(saved.lang);
    setPrecise(saved.precise);
    setAutoOcr(saved.autoOcr);
    setPreset(saved.preset);
    setHydrated(true);
    void refreshHistory();
    const desk = window.mahyarDesktop;
    if (!desk) return;
    setDesktop(true);
    void desk.setShortcuts(saved.preset).then((result) => {
      if (result.failed.length) setFlash("یکی از میانبرها را ویندوز آزاد نکرد");
    });
    return desk.onGlobalCapture((payload) => {
      const shotMode = payload.mode === "full" ? "full" : "region";
      void dataUrlToBlob(payload.dataUrl).then((next) => acceptRef.current(next, shotMode, true));
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const next: Settings = { lang, precise, autoOcr, preset };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    if (window.mahyarDesktop) void window.mahyarDesktop.setShortcuts(preset);
  }, [hydrated, lang, precise, autoOcr, preset]);

  useEffect(() => {
    if (desktop) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "TEXTAREA" || target?.tagName === "INPUT";
      if (event.ctrlKey && event.key === "Enter") {
        event.preventDefault();
        void actions.current.read();
        return;
      }
      if (typing) return;
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void actions.current.copyText();
        return;
      }
      if (matches(event, "region", preset)) {
        event.preventDefault();
        void actions.current.take("region");
      } else if (matches(event, "full", preset)) {
        event.preventDefault();
        void actions.current.take("full");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop, preset]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (!item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (!file) return;
        event.preventDefault();
        void acceptRef.current(file, "paste", true);
        return;
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 2200);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const shortcut = PRESETS.find((item) => item.id === preset) ?? PRESETS[0];
  const chars = text.replace(/\s/g, "").length;

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-4 overflow-x-hidden px-4 py-4 lg:px-6">
      <header className="glass flex flex-wrap items-center gap-4 rounded-3xl px-4 py-3">
        <div className="logo-shell relative size-14 shrink-0 overflow-hidden rounded-2xl">
          <img src={mark} alt="" className="size-full object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs tracking-[0.28em] text-primary" dir="ltr">
            MAHYAR IMAGE TOOLS
          </p>
          <h1 className="text-2xl font-bold leading-tight">مهیار ایمیج تولز</h1>
        </div>
        <p className="inline-flex items-center gap-2 rounded-full border border-border bg-bg/50 px-3 py-2 text-sm text-muted">
          <Aperture className="size-4 text-primary" />
          {phase}
        </p>
      </header>

      <p className="px-1 text-sm text-muted">
        {desktop
          ? "نسخهٔ ویندوز باز است. میانبر حتی وقتی این پنجره پشت برنامه‌های دیگر است کار می‌کند."
          : "این پیش‌نمایش مرورگر است. میانبر فقط وقتی همین صفحه جلو باشد کار می‌کند. نسخهٔ نصبی و پرتابل را از گیت‌هاب می‌سازی."}
      </p>

      <div className="grid flex-1 gap-4 lg:grid-cols-[272px_minmax(0,1fr)]">
        <aside className="glass flex flex-col gap-4 rounded-3xl p-4">
          <div className="grid gap-2">
            <Button variant="primary" size="lg" disabled={busy !== null} onClick={() => void take("full")}>
              <Monitor className="size-4" />
              تمام‌صفحه
            </Button>
            <Button variant="glass" size="lg" disabled={busy !== null} onClick={() => void take("region")}>
              <Crop className="size-4" />
              انتخاب ناحیه
            </Button>
            <Button
              variant="glass"
              disabled={busy !== null}
              onClick={() => {
                const read = navigator.clipboard?.read?.bind(navigator.clipboard);
                if (!read) {
                  setFlash("با Ctrl+V عکس را بچسبان");
                  return;
                }
                void read()
                  .then(async (items) => {
                    for (const item of items) {
                      const type = item.types.find((entry) => entry.startsWith("image/"));
                      if (!type) continue;
                      await acceptBlob(await item.getType(type), "paste", true);
                      return;
                    }
                    setFlash("عکسی در کلیپبورد نیست");
                  })
                  .catch(() => setFlash("اجازهٔ کلیپبورد داده نشد. Ctrl+V را بزن."));
              }}
            >
              <ClipboardPaste className="size-4" />
              چسباندن عکس
            </Button>
            <Button variant="glass" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
              <FolderOpen className="size-4" />
              باز کردن فایل
            </Button>
            <Button
              variant="quiet"
              disabled={busy !== null}
              onClick={() => void makeSampleBlob().then((sample) => acceptBlob(sample, "sample", true))}
            >
              <Sparkles className="size-4" />
              نمونهٔ آزمایشی
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void acceptBlob(file, "file", true);
              }}
            />
          </div>

          <div className="grid gap-2">
            <p className="text-xs text-muted">زبان متن داخل عکس</p>
            <div className="grid grid-cols-3 gap-1">
              {LANGS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={lang === item.id}
                  onClick={() => setLang(item.id)}
                  className={cn(
                    "h-11 rounded-full text-sm transition-transform duration-150 active:scale-[0.96]",
                    lang === item.id ? "bg-primary text-bg" : "border border-border text-muted",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-pressed={precise}
              onClick={() => setPrecise((value) => !value)}
              className={cn(
                "h-11 rounded-full px-3 text-sm transition-transform duration-150 active:scale-[0.96]",
                precise ? "bg-primary text-bg" : "border border-border text-muted",
              )}
            >
              دقت بالاتر
            </button>
            <button
              type="button"
              aria-pressed={autoOcr}
              onClick={() => setAutoOcr((value) => !value)}
              className={cn(
                "h-11 rounded-full px-3 text-sm transition-transform duration-150 active:scale-[0.96]",
                autoOcr ? "bg-primary text-bg" : "border border-border text-muted",
              )}
            >
              خواندن خودکار
            </button>
          </div>

          <div className="grid gap-2">
            <p className="inline-flex items-center gap-2 text-xs text-muted">
              <Keyboard className="size-3.5" />
              میانبر
            </p>
            <div className="grid grid-cols-3 gap-1">
              {PRESETS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={preset === item.id}
                  onClick={() => setPreset(item.id)}
                  className={cn(
                    "h-11 rounded-full text-sm transition-transform duration-150 active:scale-[0.96]",
                    preset === item.id ? "bg-primary text-bg" : "border border-border text-muted",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="grid gap-1 text-xs leading-6 text-muted">
              <span>
                ناحیه{" "}
                <kbd className="rounded-md border border-border px-1.5 py-0.5 text-primary" dir="ltr">
                  {shortcut.region}
                </kbd>
              </span>
              <span>
                تمام‌صفحه{" "}
                <kbd className="rounded-md border border-border px-1.5 py-0.5 text-primary" dir="ltr">
                  {shortcut.full}
                </kbd>
              </span>
            </p>
          </div>

          <div className="grid gap-2">
            <p className="text-xs text-muted">تاریخچهٔ همین دستگاه</p>
            {history.length === 0 ? (
              <p className="text-sm text-muted">هنوز عکسی نیست.</p>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {history.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="relative size-16 shrink-0 overflow-hidden rounded-xl border border-border"
                    onClick={() =>
                      void getShotBlob(item.id).then((stored) => {
                        if (!stored) return;
                        setBlob(stored);
                        setShotId(item.id);
                        setMode(item.mode);
                        setText(item.text);
                        setConfidence(item.confidence);
                        setError(null);
                        replaceUrl(URL.createObjectURL(stored));
                        setPhase("از تاریخچه");
                      })
                    }
                  >
                    <img src={item.url} alt="" className="size-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-col gap-4">
          <div
            className={cn(
              "living-frame glass min-h-80 overflow-hidden rounded-3xl",
              dragging && "border-primary",
            )}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files?.[0];
              if (file?.type.startsWith("image/")) void acceptBlob(file, "file", true);
            }}
          >
            <div className="relative flex min-h-80 items-center justify-center p-4">
              {url ? (
                <img src={url} alt="عکس گرفته‌شده" className="max-h-[52vh] w-full object-contain" />
              ) : (
                <div className="grid max-w-md justify-items-center gap-3 text-center">
                  <img src={mark} alt="" className="size-24 rounded-3xl object-cover" />
                  <p className="text-lg font-medium">عکس بگیر، متنش را بردار</p>
                  <p className="text-sm text-muted">
                    تمام صفحه، یک ناحیه با ماوس، یا عکسی که از قبل داری. متن فارسی و انگلیسی با یک کلیک کپی می‌شود.
                  </p>
                </div>
              )}
              {busy === "read" ? (
                <div className="pointer-events-none absolute inset-x-0 top-0 h-full overflow-hidden">
                  <div className="scan-line absolute inset-x-8 h-px bg-primary shadow-glow" />
                </div>
              ) : null}
            </div>
            {busy === "read" ? (
              <div className="h-1 bg-bg">
                <div className="h-full bg-primary transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            ) : null}
          </div>

          <div className="glass grid gap-3 rounded-3xl p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="inline-flex items-center gap-2 text-base font-medium">
                <Type className="size-4 text-primary" />
                متن استخراج‌شده
              </h2>
              <span className="text-xs text-muted">
                {chars.toLocaleString("fa-IR")} نویسه
                {confidence !== null ? ` · اطمینان ${confidence.toLocaleString("fa-IR")}٪` : ""}
              </span>
              <div className="ms-auto flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => void copyText()}>
                  <Copy className="size-4" />
                  کپی متن
                </Button>
                <Button variant="glass" disabled={!blob || busy !== null} onClick={() => blob && void readBlob(blob, shotId)}>
                  {busy === "read" ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  خواندن متن
                </Button>
                <Button
                  variant="glass"
                  disabled={!blob || busy !== null}
                  onClick={() =>
                    blob &&
                    void copyImageBlob(blob)
                      .then(() => setFlash("عکس کپی شد"))
                      .catch((reason: unknown) => setError(captureErrorMessage(reason)))
                  }
                >
                  <FileImage className="size-4" />
                  کپی عکس
                </Button>
                <Button
                  variant="glass"
                  disabled={!blob}
                  onClick={() =>
                    blob &&
                    void saveImageBlob(blob).then((result) => {
                      if (result === "saved") setFlash("عکس ذخیره شد");
                    })
                  }
                >
                  <Check className="size-4" />
                  ذخیره
                </Button>
                <Button
                  variant="quiet"
                  disabled={!blob && !text}
                  onClick={() => {
                    if (shotId) void deleteShot(shotId).then(() => refreshHistory());
                    setBlob(null);
                    setShotId(null);
                    setMode(null);
                    setText("");
                    setConfidence(null);
                    setError(null);
                    replaceUrl(null);
                    setPhase("آماده");
                  }}
                >
                  <Trash2 className="size-4" />
                  پاک کردن
                </Button>
              </div>
            </div>
            <label className="sr-only" htmlFor="ocr-text">
              متن خوانده‌شده از عکس
            </label>
            <textarea
              id="ocr-text"
              dir="auto"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="متن اینجا می‌آید. می‌توانی قبل از کپی ویرایشش کنی."
              className="min-h-40 w-full resize-y rounded-2xl border border-border bg-bg/70 p-4 text-fg outline-none focus-visible:outline-2 focus-visible:outline-primary"
            />
            {error ? <p className="text-sm text-primary">{error}</p> : null}
            {mode ? (
              <p className="text-xs text-muted">
                میانبر کپی وقتی صفحه جلو است: Ctrl+Shift+C · خواندن دوباره: Ctrl+Enter
              </p>
            ) : null}
          </div>
        </section>
      </div>

      {cropUrl ? (
        <Cropper
          url={cropUrl}
          onCancel={() => {
            URL.revokeObjectURL(cropUrl);
            setCropUrl(null);
            setPhase("لغو شد");
          }}
          onUseAll={() => {
            const current = cropUrl;
            setCropUrl(null);
            void dataUrlToBlob(current).then((next) => {
              URL.revokeObjectURL(current);
              return acceptBlob(next, "region", true);
            });
          }}
          onConfirm={(next) => {
            URL.revokeObjectURL(cropUrl);
            setCropUrl(null);
            void acceptBlob(next, "region", true);
          }}
        />
      ) : null}

      {flash ? (
        <p role="status" className="glass fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm text-fg">
          {flash}
        </p>
      ) : null}
    </div>
  );
}
