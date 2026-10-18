/** The QR code of Eva's address, as one SVG path, so another device can scan it. */
import { encode } from "uqr";

/** Scanners need a light border of 4 modules around the code. */
const quietBorder = 4;

/** The width in modules, border included, and a path with one square per dark module. */
export function qrCodeShape(text: string): { readonly size: number; readonly path: string } {
  const code = encode(text, { border: quietBorder });
  let path = "";
  code.data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) path += `M${String(x)} ${String(y)}h1v1h-1z`;
    });
  });
  return { size: code.size, path };
}
