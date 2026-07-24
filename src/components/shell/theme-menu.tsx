"use client";

import * as React from "react";
import { Sun, Moon, Monitor, Contrast, Check } from "lucide-react";
import { useTheme } from "@/components/theme";
import { cn } from "@/lib/utils";

export function ThemeMenu() {
  const { theme, density, contrast, setTheme, setDensity, setContrast } = useTheme();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const Row = ({
    active,
    onClick,
    icon,
    label,
  }: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
  }) => (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-surface-2",
        active && "text-text",
      )}
    >
      <span className="text-muted">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {active && <Check size={14} className="text-primary" />}
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
        aria-label="Appearance"
        title="Appearance"
      >
        {theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}
      </button>
      {open && (
        <div className="card animate-in absolute right-0 top-11 z-50 w-52 p-1.5">
          <p className="px-2.5 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-faint">Theme</p>
          <Row active={theme === "light"} onClick={() => setTheme("light")} icon={<Sun size={15} />} label="Light" />
          <Row active={theme === "dark"} onClick={() => setTheme("dark")} icon={<Moon size={15} />} label="Dark" />
          <div className="my-1 h-px bg-border" />
          <p className="px-2.5 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-faint">Density</p>
          <Row active={density === "cozy"} onClick={() => setDensity("cozy")} icon={<Monitor size={15} />} label="Cozy" />
          <Row active={density === "compact"} onClick={() => setDensity("compact")} icon={<Monitor size={15} />} label="Compact" />
          <div className="my-1 h-px bg-border" />
          <Row
            active={contrast === "high"}
            onClick={() => setContrast(contrast === "high" ? "normal" : "high")}
            icon={<Contrast size={15} />}
            label="High contrast"
          />
        </div>
      )}
    </div>
  );
}
