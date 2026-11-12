import "server-only";
import sharp from "sharp";

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export type LogoKind = "png" | "jpeg" | "webp" | "svg";
export type LogoResult = { ok: true; png: Buffer; width: number; height: number; sourceKind: LogoKind } | { ok: false; error: string };

export function sniffImage(buf: Buffer): LogoKind | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  const head = buf.subarray(0, 1024).toString("utf8").replace(/^﻿/, "").trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
  return null;
}

/** Reject anything in an SVG that could execute, load external resources, or expand entities. */
export function svgIsSafe(svg: string): boolean {
  const s = svg.toLowerCase();
  if (/<script[\s>]/.test(s)) return false;
  if (/<!doctype|<!entity/.test(s)) return false;
  if (/<foreignobject[\s>]/.test(s)) return false;
  if (/\son[a-z]+\s*=/.test(s)) return false;
  if (/javascript:|vbscript:|data:text\/html/.test(s)) return false;
  // Only allow fragment references (#id) and embedded raster data URIs in href/src.
  const refs = s.match(/(?:xlink:)?href\s*=\s*["'][^"']*["']|src\s*=\s*["'][^"']*["']/g) ?? [];
  for (const r of refs) {
    const v = r.replace(/^[^=]*=\s*["']/, "").replace(/["']$/, "").trim();
    if (!(v.startsWith("#") || /^data:image\/(png|jpeg|gif|webp);base64,/.test(v))) return false;
  }
  if (/url\(\s*['"]?(?!#)/.test(s)) return false; // CSS url() to anything but fragments
  if (/@import/.test(s)) return false;
  return true;
}

const ALLOWED_MIME: Record<string, LogoKind> = {
  "image/png": "png", "image/jpeg": "jpeg", "image/jpg": "jpeg", "image/webp": "webp", "image/svg+xml": "svg",
};

/**
 * Validate an uploaded logo and normalize it to a PNG (max 1200×600). SVGs are checked for active
 * content and rasterized, so no SVG markup is ever stored or served back to a browser.
 */
export async function processLogo(buf: Buffer, declaredMime?: string): Promise<LogoResult> {
  if (buf.length === 0) return { ok: false, error: "The file is empty." };
  if (buf.length > MAX_LOGO_BYTES) return { ok: false, error: "Logos must be 2 MB or smaller." };
  const kind = sniffImage(buf);
  if (!kind) return { ok: false, error: "Upload a JPG, PNG, WebP, or SVG image." };
  if (declaredMime && ALLOWED_MIME[declaredMime.toLowerCase()] !== kind) {
    return { ok: false, error: "The file type does not match its contents." };
  }
  if (kind === "svg" && !svgIsSafe(buf.toString("utf8"))) {
    return { ok: false, error: "This SVG contains scripts or external references and cannot be used. Try a PNG instead." };
  }
  try {
    const img = sharp(buf, { limitInputPixels: 40_000_000, density: kind === "svg" ? 144 : undefined });
    const meta = await img.metadata();
    if (!meta.width || !meta.height) return { ok: false, error: "We could not read this image." };
    const png = await img.rotate().resize({ width: 1200, height: 600, fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
    const out = await sharp(png).metadata();
    return { ok: true, png, width: out.width ?? 0, height: out.height ?? 0, sourceKind: kind };
  } catch {
    return { ok: false, error: "We could not read this image." };
  }
}
