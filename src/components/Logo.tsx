// Overlid brand marks, bundled from src/assets/brand (copied from assets/logo/source).
// The full logo is for large sizes only; anything 32 px or smaller uses the
// micro mark, because the full logo's waveform and lines blur when tiny.

import black from "../assets/brand/overlid-black.svg?url";
import metallic from "../assets/brand/overlid-metallic.svg?url";
import microBlack from "../assets/brand/overlid-micro-black.svg?url";
import microWhite from "../assets/brand/overlid-micro-white.svg?url";
import white from "../assets/brand/overlid-white.svg?url";

const SOURCES = { metallic, white, black, "micro-white": microWhite, "micro-black": microBlack } as const;

export type LogoVariant = keyof typeof SOURCES;

export function Logo({ variant, size, label }: { variant: LogoVariant; size: number; label?: string }) {
  // Below 33 px, always use the matching micro mark.
  const resolved: LogoVariant =
    size <= 32 && !variant.startsWith("micro") ? (variant === "black" ? "micro-black" : "micro-white") : variant;
  // A plain <img>: the SVG is never parsed into the page's DOM.
  return (
    <img
      src={SOURCES[resolved]}
      width={size}
      height={size}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      draggable={false}
      style={{ display: "inline-block", width: size, height: size, flexShrink: 0 }}
    />
  );
}
