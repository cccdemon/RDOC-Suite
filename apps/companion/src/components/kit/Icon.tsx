import type { ComponentType, SVGProps } from "react";
import {
  Check,
  ChevronsUpDown,
  Copy,
  Headphones,
  KeyRound,
  Link2,
  Loader2,
  Mic,
  MicOff,
  Power,
  Radio,
  Settings,
  Users,
  Volume2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";

/**
 * Tiny wrapper that pins icon defaults across the app (strokeWidth,
 * size, no fill). Use the named slots so we have one place to swap
 * the icon library later if we ever want to.
 */
type LucideIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

export const Icon = {
  mic: Mic as LucideIcon,
  micOff: MicOff as LucideIcon,
  headphones: Headphones as LucideIcon,
  wifi: Wifi as LucideIcon,
  wifiOff: WifiOff as LucideIcon,
  link: Link2 as LucideIcon,
  key: KeyRound as LucideIcon,
  users: Users as LucideIcon,
  volume: Volume2 as LucideIcon,
  radio: Radio as LucideIcon,
  power: Power as LucideIcon,
  loader: Loader2 as LucideIcon,
  chev: ChevronsUpDown as LucideIcon,
  check: Check as LucideIcon,
  x: X as LucideIcon,
  copy: Copy as LucideIcon,
  settings: Settings as LucideIcon,
};

export type IconKey = keyof typeof Icon;
