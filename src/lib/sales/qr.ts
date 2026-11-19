import "server-only";
import QRCode from "qrcode";

/** QR code for a rep's link: an inline SVG for the page and a PNG data URL for download. */
export async function qrFor(link: string): Promise<{ svg: string; png: string }> {
  const opts = { errorCorrectionLevel: "M" as const, margin: 1, color: { dark: "#0b2d4d", light: "#ffffff" } };
  const [svg, png] = await Promise.all([QRCode.toString(link, { ...opts, type: "svg" }), QRCode.toDataURL(link, { ...opts, width: 600 })]);
  return { svg, png };
}
