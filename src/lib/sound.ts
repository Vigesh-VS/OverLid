// A soft two-note chime, synthesised so there's no audio asset to ship.

let ctx: AudioContext | null = null;

export function chime(kind: "done" | "attention" = "done"): void {
  try {
    ctx ??= new AudioContext();
    const now = ctx.currentTime;
    const notes = kind === "done" ? [880, 1318.5] : [660, 660];
    notes.forEach((freq, i) => {
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.14;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.65);
    });
  } catch (e) {
    console.debug("chime unavailable", e);
  }
}
