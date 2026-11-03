import type { CaptureResult } from "@/mahyar/desktop";

export async function grabScreen(): Promise<Blob> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("این مرورگر اشتراک صفحه ندارد. عکس را بچسبان، از فایل باز کن، یا نسخهٔ ویندوز را بساز.");
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 1 },
    audio: false,
  });
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await video.play();
    if (!video.videoWidth) {
      await new Promise<void>((resolve) => {
        video.onloadeddata = () => resolve();
      });
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx || !canvas.width) throw new Error("عکس صفحه خالی بود.");
    ctx.drawImage(video, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("ساخت عکس ناموفق بود."))), "image/png");
    });
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }
}

export function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return fetch(dataUrl).then((res) => res.blob());
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("خواندن عکس ناموفق بود."));
    reader.readAsDataURL(blob);
  });
}

export function shotFilename(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `Mahyar-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
}

export async function copyImageBlob(blob: Blob): Promise<void> {
  if (window.mahyarDesktop) {
    const ok = await window.mahyarDesktop.copyImage(await blobToDataUrl(blob));
    if (!ok) throw new Error("کپی عکس انجام نشد.");
    return;
  }
  const png = blob.type === "image/png" ? blob : await transcodePng(blob);
  if (!navigator.clipboard?.write) throw new Error("کلیپبورد این مرورگر کپی عکس را اجازه نمی‌دهد. ذخیره کن.");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

async function transcodePng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return blob;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("تبدیل عکس ناموفق بود."))), "image/png");
  });
}

export async function saveImageBlob(blob: Blob): Promise<"saved" | "cancelled"> {
  if (window.mahyarDesktop) {
    const ok = await window.mahyarDesktop.savePng(await blobToDataUrl(blob));
    return ok ? "saved" : "cancelled";
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = shotFilename();
  link.click();
  URL.revokeObjectURL(url);
  return "saved";
}

export function captureErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "اجازهٔ اشتراک صفحه داده نشد. می‌توانی عکس را بچسبانی یا از فایل باز کنی.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "عکس گرفته نشد.";
}

export function isCancelled(result: CaptureResult): boolean {
  return !result.ok && Boolean(result.cancelled);
}

export async function makeSampleBlob(): Promise<Blob> {
  await document.fonts.ready;
  await document.fonts.load("700 64px Vazirmatn");
  const canvas = document.createElement("canvas");
  canvas.width = 1100;
  canvas.height = 560;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("نمونه ساخته نشد.");
  ctx.fillStyle = "#f3fffd";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#08343c";
  ctx.fillRect(0, 0, canvas.width, 12);
  ctx.fillStyle = "#071016";
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.font = "700 64px Vazirmatn";
  ctx.fillText("ابزار تصویر مهیار", 1040, 180);
  ctx.font = "400 40px Vazirmatn";
  ctx.fillText("سلام، این متن باید دقیق خوانده شود.", 1040, 270);
  ctx.fillText("یک کلیک برای کپی همین نوشته.", 1040, 340);
  ctx.direction = "ltr";
  ctx.textAlign = "left";
  ctx.font = "500 36px Vazirmatn";
  ctx.fillText("Mahyar Image Tools  ·  OCR sample", 60, 450);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("نمونه ساخته نشد."))), "image/png");
  });
}
