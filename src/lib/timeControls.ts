export type TimeControlKey = "bullet" | "blitz" | "rapid";
export type ColorChoice = "white" | "black" | "random";

export interface TimeControlSpec {
  key: TimeControlKey;
  label: string;
  short: string;
  initialSeconds: number;
  incrementSeconds: number;
  icon: string;
}

export const TIME_CONTROLS: Record<TimeControlKey, TimeControlSpec> = {
  bullet: {
    key: "bullet",
    label: "Bullet",
    short: "1+0",
    initialSeconds: 60,
    incrementSeconds: 0,
    icon: "⚡",
  },
  blitz: {
    key: "blitz",
    label: "Blitz",
    short: "3+2",
    initialSeconds: 180,
    incrementSeconds: 2,
    icon: "🔥",
  },
  rapid: {
    key: "rapid",
    label: "10 Minuten",
    short: "10+0",
    initialSeconds: 600,
    incrementSeconds: 0,
    icon: "⏱️",
  },
};

export const TIME_CONTROL_LIST: TimeControlSpec[] = [
  TIME_CONTROLS.bullet,
  TIME_CONTROLS.blitz,
  TIME_CONTROLS.rapid,
];

export function isTimeControlKey(value: unknown): value is TimeControlKey {
  return value === "bullet" || value === "blitz" || value === "rapid";
}

export function isColorChoice(value: unknown): value is ColorChoice {
  return value === "white" || value === "black" || value === "random";
}

/** mm:ss, unter 20 Sekunden mit Zehntel — dort entscheidet die Zehntelsekunde. */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = clamped / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  if (clamped < 20_000) {
    return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
  }
  return `${minutes}:${Math.floor(seconds).toString().padStart(2, "0")}`;
}
