import "server-only";
import sharp from "sharp";
import { createHash } from "node:crypto";

export type SignatureImageResult = { ok: true; dataUrl: string; sha256: string } | { ok: false; message: string };

/**
 * Re-encode a drawn or uploaded signature: decode it as an image (rejects anything that isn't one),
 * flatten onto white, trim the margins, cap the size and write a fresh PNG with no metadata. The stored
 * image is what we produced, never the bytes the browser sent.
 */
export async function normalizeSignatureImage(dataUrl: string): Promise<SignatureImageResult> {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m) return { ok: false, message: "Choose a PNG or JPG image of your signature." };
  const input = Buffer.from(m[2], "base64");
  if (input.length < 100 || input.length > 2_200_000) return { ok: false, message: "That image is too small or too large. Use a clear image under 2 MB." };
  try {
    const meta = await sharp(input, { limitInputPixels: 25_000_000 }).metadata();
    if (!meta.width || !meta.height || meta.width < 40 || meta.height < 15) return { ok: false, message: "That image is too small to be a legible signature." };
    const out = await sharp(input, { limitInputPixels: 25_000_000 })
      .rotate()
      .flatten({ background: "#ffffff" })
      .trim({ background: "#ffffff", threshold: 20 })
      .resize({ width: 900, height: 300, fit: "inside", withoutEnlargement: true })
      .extend({ top: 8, bottom: 8, left: 8, right: 8, background: "#ffffff" })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer();
    const check = await sharp(out).metadata();
    if (!check.width || check.width < 50 || !check.height || check.height < 20) return { ok: false, message: "We couldn't find a signature in that image. Try a darker, tighter crop." };
    const url = `data:image/png;base64,${out.toString("base64")}`;
    if (url.length > 400_000) return { ok: false, message: "That signature image is too detailed. Try a simpler scan." };
    return { ok: true, dataUrl: url, sha256: createHash("sha256").update(out).digest("hex") };
  } catch {
    return { ok: false, message: "That file isn't a readable image. Use a PNG or JPG." };
  }
}

/** Decode a stored PNG data URL for PDF rendering. */
export const pngBuffer = (dataUrl: string | null | undefined): Buffer | null =>
  dataUrl && dataUrl.startsWith("data:image/png;base64,") ? Buffer.from(dataUrl.split(",")[1] ?? "", "base64") : null;
