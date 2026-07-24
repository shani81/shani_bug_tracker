"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AtSign,
  UserPlus,
  RefreshCw,
  MessageSquare,
  Rocket,
  Info,
  BellOff,
  CheckCheck,
  type LucideIcon,
} from "lucide-react";
import { Button, Card, EmptyState } from "@/components/ui/primitives";
import { markNotificationRead, markAllNotificationsRead } from "@/lib/actions";
import { relativeTime, cn, withAlpha } from "@/lib/utils";
import type { NotificationData } from "@/lib/module-queries";

type KindMeta = { icon: LucideIcon; color: string };

const KIND_META: Record<string, KindMeta> = {
  mention: { icon: AtSign, color: "#5b5bd6" },
  assigned: { icon: UserPlus, color: "#0891b2" },
  status: { icon: RefreshCw, color: "#d97706" },
  comment: { icon: MessageSquare, color: "#7c3aed" },
  release: { icon: Rocket, color: "#16a34a" },
  system: { icon: Info, color: "#64748b" },
};

const FALLBACK_META: KindMeta = { icon: Info, color: "#64748b" };

type Filter = "all" | "unread";

export function NotificationsView({ notifications }: { notifications: NotificationData[] }) {
  const router = useRouter();
  const [filter, setFilter] = React.useState<Filter>("all");
  const [busy, setBusy] = React.useState(false);

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const visible = filter === "unread" ? notifications.filter((n) => !n.isRead) : notifications;

  async function markAllRead() {
    if (busy || unreadCount === 0) return;
    setBusy(true);
    await markAllNotificationsRead();
    setBusy(false);
    router.refresh();
  }

  async function openNotification(n: NotificationData) {
    if (!n.isRead) {
      await markNotificationRead(n.id);
      router.refresh();
    }
    if (n.issueId) router.push(`/issue/${n.issueId}`);
  }

  const tabs: { value: Filter; label: string; count: number }[] = [
    { value: "all", label: "All", count: notifications.length },
    { value: "unread", label: "Unread", count: unreadCount },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-2 p-1">
          {tabs.map((t) => (
            <button
              key={t.value}
              onClick={() => setFilter(t.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors",
                filter === t.value ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text",
              )}
            >
              {t.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] font-semibold",
                  filter === t.value ? "bg-surface-3 text-muted" : "bg-surface-3/70 text-faint",
                )}
              >
                {t.count}
              </span>
            </button>
          ))}
        </div>

        <Button variant="subtle" size="sm" onClick={markAllRead} disabled={busy || unreadCount === 0}>
          <CheckCheck size={15} />
          Mark all read
        </Button>
      </div>

      {/* list */}
      {visible.length === 0 ? (
        <EmptyState
          icon={<BellOff size={30} />}
          title={filter === "unread" ? "You're all caught up" : "No notifications"}
          description={
            filter === "unread"
              ? "Every notification has been read. Nice and tidy."
              : "Mentions, assignments, and updates will show up here as they happen."
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border">
            {visible.map((n) => {
              const meta = KIND_META[n.kind] ?? FALLBACK_META;
              const Icon = meta.icon;
              return (
                <div
                  key={n.id}
                  onClick={() => openNotification(n)}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 px-3 py-3 transition-colors hover:bg-surface-2",
                    !n.isRead && "bg-primary-soft/40",
                  )}
                >
                  <span
                    className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full"
                    style={{ backgroundColor: withAlpha(meta.color, 0.14), color: meta.color }}
                  >
                    <Icon size={16} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{n.title}</p>
                    {n.body && <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{n.body}</p>}
                  </div>

                  <div className="flex shrink-0 items-center gap-2 pt-0.5">
                    <span className="whitespace-nowrap text-[11.5px] text-faint">{relativeTime(n.createdAt)}</span>
                    {!n.isRead && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Unread" />}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
