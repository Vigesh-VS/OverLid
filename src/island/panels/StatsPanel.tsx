import { useEffect } from "react";

import { Ring } from "../../components/Ring";
import { formatDuration } from "../../lib/format";
import { commands, run } from "../../lib/ipc";
import { useSystem } from "../../stores/system";
import styles from "./StatsPanel.module.css";

const GB = 1024 ** 3;

function gb(bytes: number): string {
  const v = bytes / GB;
  return v >= 100 ? v.toFixed(0) : v.toFixed(1);
}

export function StatsPanel() {
  const tick = useSystem((s) => s.tick);

  useEffect(() => {
    run(commands.systemSetStatsActive(true), "system_set_stats_active");
    return () => run(commands.systemSetStatsActive(false), "system_set_stats_active");
  }, []);

  if (!tick || tick.memTotal === 0) {
    return <div className={styles.loading}>Reading system stats…</div>;
  }

  const mem = tick.memUsed / tick.memTotal;
  const battery = tick.battery;
  const batteryColor = !battery
    ? "var(--ol-text)"
    : battery.charging || battery.onAc
      ? "var(--ol-green)"
      : battery.percent <= 20
        ? "var(--ol-red)"
        : "var(--ol-text)";

  return (
    <div className={styles.panel}>
      <div className={styles.rings}>
        <StatCard
          value={tick.cpuPercent / 100}
          big={`${Math.round(tick.cpuPercent)}%`}
          label="CPU"
          detail={`${tick.cpuCores} threads`}
        />
        <StatCard
          value={mem}
          big={`${Math.round(mem * 100)}%`}
          label="Memory"
          detail={`${gb(tick.memUsed)} / ${gb(tick.memTotal)} GB`}
        />
        {battery ? (
          <StatCard
            value={battery.percent / 100}
            big={`${battery.percent}%`}
            label="Battery"
            detail={battery.charging ? "Charging" : battery.onAc ? "Plugged in" : "On battery"}
            color={batteryColor}
          />
        ) : (
          <StatCard value={0} big="AC" label="Power" detail="No battery" />
        )}
      </div>

      <div className={styles.facts}>
        <div className={styles.fact}>
          <span>Uptime</span>
          <strong>{formatDuration(tick.uptimeSecs)}</strong>
        </div>
        {tick.diskFree !== null && (
          <div className={styles.fact}>
            <span>System drive free</span>
            <strong>{gb(tick.diskFree)} GB</strong>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  value,
  big,
  label,
  detail,
  color = "var(--ol-text)",
}: {
  value: number;
  big: string;
  label: string;
  detail: string;
  color?: string;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.ring}>
        <Ring size={80} stroke={7} value={value} color={color} />
        <span className={styles.ringValue} style={{ color }}>
          {big}
        </span>
      </div>
      <div className={styles.caption}>
        <span className={styles.label}>{label}</span>
        <span className={styles.detail}>{detail}</span>
      </div>
    </div>
  );
}
