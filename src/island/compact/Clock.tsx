import { useEffect, useState } from "react";

const format = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

/** Current time, re-rendering once per minute on the minute boundary. */
export function useClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    const id = window.setTimeout(() => setNow(new Date()), msToNextMinute + 20);
    return () => window.clearTimeout(id);
  }, [now]);

  return now;
}

export function Clock({ className }: { className?: string }) {
  const now = useClock();
  return (
    <time className={className} dateTime={now.toISOString()}>
      {format.format(now)}
    </time>
  );
}
