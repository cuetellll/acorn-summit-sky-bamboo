import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Box = { x: number; y: number; w: number; h: number };

function containedRect(img: HTMLImageElement) {
  const rect = img.getBoundingClientRect();
  const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
  const width = img.naturalWidth * scale;
  const height = img.naturalHeight * scale;
  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
    scale,
  };
}

async function cropToBlob(img: HTMLImageElement, box: Box): Promise<Blob | null> {
  const frame = containedRect(img);
  const x = (box.x - frame.left) / frame.scale;
  const y = (box.y - frame.top) / frame.scale;
  const w = box.w / frame.scale;
  const h = box.h / frame.scale;
  const left = Math.max(0, Math.round(x));
  const top = Math.max(0, Math.round(y));
  const width = Math.min(img.naturalWidth - left, Math.round(w));
  const height = Math.min(img.naturalHeight - top, Math.round(h));
  if (width < 4 || height < 4) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, left, top, width, height, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export function Cropper({
  url,
  onConfirm,
  onUseAll,
  onCancel,
}: {
  url: string;
  onConfirm: (blob: Blob) => void;
  onUseAll: () => void;
  onCancel: () => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState<Box | null>(null);

  async function finish(next: Box) {
    const img = imgRef.current;
    if (!img) return;
    const blob = await cropToBlob(img, next);
    if (blob) onConfirm(blob);
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg/80 backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="text-sm text-fg">ناحیه را با ماوس بکش. با رها کردن، همان بخش جدا می‌شود.</p>
        <div className="flex gap-2">
          <Button variant="glass" onClick={onUseAll}>
            کل تصویر
          </Button>
          <Button variant="quiet" onClick={onCancel}>
            لغو
          </Button>
        </div>
      </div>
      <div
        className="relative min-h-0 flex-1"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          origin.current = { x: event.clientX, y: event.clientY };
          setBox({ x: event.clientX, y: event.clientY, w: 0, h: 0 });
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = origin.current;
          if (!start) return;
          const x = Math.min(start.x, event.clientX);
          const y = Math.min(start.y, event.clientY);
          setBox({ x, y, w: Math.abs(event.clientX - start.x), h: Math.abs(event.clientY - start.y) });
        }}
        onPointerUp={(event) => {
          const start = origin.current;
          origin.current = null;
          if (!start) return;
          const x = Math.min(start.x, event.clientX);
          const y = Math.min(start.y, event.clientY);
          const next = { x, y, w: Math.abs(event.clientX - start.x), h: Math.abs(event.clientY - start.y) };
          setBox(next);
          if (next.w > 8 && next.h > 8) void finish(next);
        }}
      >
        <img
          ref={imgRef}
          src={url}
          alt="تصویر آمادهٔ برش"
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />
        {box && box.w > 0 && box.h > 0 ? (
          <div
            className="pointer-events-none fixed z-50 border-2 border-primary"
            style={{
              left: box.x,
              top: box.y,
              width: box.w,
              height: box.h,
              boxShadow: "0 0 0 9999px rgb(7 16 22 / 0.55)",
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
