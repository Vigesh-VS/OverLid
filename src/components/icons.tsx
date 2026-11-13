// Inline icons. Decorative by default; give the parent button an aria-label.

type IconProps = { size?: number; color?: string };

export function PlayIcon({ size = 20, color = "currentColor" }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
    </svg>
  );
}

export function PauseIcon({ size = 20, color = "currentColor" }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

export function PreviousIcon({ size = 22, color = "currentColor" }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M7 6v12h2V6Z" />
      <path d="M19 6 10 12l9 6Z" />
    </svg>
  );
}

export function NextIcon({ size = 22, color = "currentColor" }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M15 6v12h2V6Z" />
      <path d="M5 6l9 6-9 6Z" />
    </svg>
  );
}

function Stroke({
  size = 16,
  color = "currentColor",
  width = 2,
  children,
}: IconProps & { width?: number; children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function GearIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Stroke>
  );
}

export function BoltIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M13 2 4 14h8l-1 8 9-12h-8Z" />
    </Stroke>
  );
}

export function CheckIcon(props: IconProps & { width?: number }) {
  return (
    <Stroke {...props}>
      <path d="m5 12 5 5 9-10" />
    </Stroke>
  );
}

export function KeyUpIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M12 4 4 12h4v5h8v-5h4Z" />
      <path d="M8 21h8" />
    </Stroke>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Stroke>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </Stroke>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </Stroke>
  );
}

export function StopIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
