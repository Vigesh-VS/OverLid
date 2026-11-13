// Overlid brand marks, inlined from src/assets/brand (copied from assets/logo/source).
// The full logo is for large sizes only; anything 32 px or smaller uses the
// micro mark, because the full logo's waveform and lines blur when tiny.

import black from "../assets/brand/overlid-black.svg?raw";
import metallic from "../assets/brand/overlid-metallic.svg?raw";
import microBlack from "../assets/brand/overlid-micro-black.svg?raw";
import microWhite from "../assets/brand/overlid-micro-white.svg?raw";
import white from "../assets/brand/overlid-white.svg?raw";

const SOURCES = { metallic, white, black, "micro-white": microWhite, "micro-black": microBlack } as const;

export type LogoVariant = keyof typeof SOURCES;

export function Logo({ variant, size, label }: { variant: LogoVariant; size: number; label?: string }) {
  // Below 33 px, always use the matching micro mark.
  const resolved: LogoVariant =
    size <= 32 && !variant.startsWith("micro") ? (variant === "black" ? "micro-black" : "micro-white") : variant;
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ display: "inline-flex", width: size, height: size, flexShrink: 0 }}
      // Trusted, bundled SVG assets.
      dangerouslySetInnerHTML={{
        __html: SOURCES[resolved].replace("<svg ", `<svg width="${size}" height="${size}" `),
      }}
    />
  );
}
