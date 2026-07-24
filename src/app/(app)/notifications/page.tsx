import { getNotifications } from "@/lib/module-queries";
import { PageHeader, PageContainer } from "@/components/page-header";
import { NotificationsView } from "@/components/modules/notifications-view";

export default async function NotificationsPage() {
  const notifications = await getNotifications();
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <PageContainer>
      <PageHeader
        icon={"🔔"}
        title="Notifications"
        subtitle={`${unreadCount} unread`}
      />
      <NotificationsView notifications={notifications} />
    </PageContainer>
  );
}
