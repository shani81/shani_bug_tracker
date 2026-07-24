import {
  LayoutDashboard,
  Bug,
  Sparkles,
  TrendingUp,
  CircleCheck,
  FlaskConical,
  Rocket,
  Map,
  Gauge,
  ChartColumn,
  Bell,
  Settings,
  type LucideIcon,
} from "lucide-react";

// Registry for icons referenced by string name (e.g. from NAV_ITEMS).
export const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Bug,
  Sparkles,
  TrendingUp,
  CircleCheck,
  FlaskConical,
  Rocket,
  Map,
  Gauge,
  ChartColumn,
  Bell,
  Settings,
};

export function NavIcon({ name, className, size = 18 }: { name: string; className?: string; size?: number }) {
  const Cmp = ICONS[name] ?? Bug;
  return <Cmp className={className} size={size} strokeWidth={2} />;
}
