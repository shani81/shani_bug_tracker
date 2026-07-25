import { WifiOff } from "lucide-react";

export const metadata = { title: "Offline — Bug Tracker" };

/**
 * Shown by the service worker when a navigation fails with no network.
 * Lives under (auth) so it renders without the app shell or a session.
 */
export default function OfflinePage() {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg p-5">
      <div className="w-full max-w-sm text-center">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-surface-2 text-muted">
          <WifiOff size={22} />
        </span>
        <h1 className="text-[19px] font-semibold tracking-tight">You&apos;re offline</h1>
        <p className="mt-2 text-[13px] text-muted">
          Bug Tracker needs a connection to load your issues. Nothing you were viewing is stored on this
          device, so nothing is lost — reconnect and try again.
        </p>
        <a
          href="/"
          className="mt-5 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-fg hover:opacity-90"
        >
          Retry
        </a>
      </div>
    </div>
  );
}
