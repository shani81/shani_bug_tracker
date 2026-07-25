"use client";

import * as React from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "bt-install-dismissed";

/**
 * Registers the service worker and offers Android's install prompt.
 *
 * Chrome fires `beforeinstallprompt` only when the app is installable and not
 * already installed, so there is nothing to show on desktop Safari or inside
 * the installed app itself.
 */
export function PwaProvider() {
  const [deferred, setDeferred] = React.useState<InstallPromptEvent | null>(null);
  const [hidden, setHidden] = React.useState(true);

  React.useEffect(() => {
    if ("serviceWorker" in navigator) {
      // register after load so it never competes with the first paint
      const onLoad = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
      if (document.readyState === "complete") onLoad();
      else window.addEventListener("load", onLoad);
    }

    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep it, show our own affordance instead
      setDeferred(e as InstallPromptEvent);
      setHidden(localStorage.getItem(DISMISS_KEY) === "1");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    const onInstalled = () => setDeferred(null);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!deferred || hidden) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border border-border bg-surface p-3 shadow-lg lg:left-auto lg:right-4 lg:mx-0">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
        <Download size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-tight">Install Bug Tracker</p>
        <p className="text-[11.5px] text-muted">Add it to your home screen for a full-screen app.</p>
      </div>
      <Button
        size="sm"
        variant="primary"
        onClick={async () => {
          await deferred.prompt();
          await deferred.userChoice;
          setDeferred(null);
        }}
      >
        Install
      </Button>
      <button
        aria-label="Not now"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, "1");
          setHidden(true);
        }}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-faint hover:bg-surface-2"
      >
        <X size={15} />
      </button>
    </div>
  );
}

/** Drop every cached asset — called on sign-out. */
export function clearPwaCaches() {
  navigator.serviceWorker?.controller?.postMessage("clear-caches");
}
