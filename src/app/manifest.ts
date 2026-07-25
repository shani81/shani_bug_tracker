import type { MetadataRoute } from "next";

/**
 * Web app manifest — what makes this installable on Android.
 *
 * `display: standalone` gives it its own window without browser chrome, and the
 * maskable icons let Android crop to whatever shape the launcher uses.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bug Tracker",
    short_name: "Bugs",
    description: "Track bugs, ship releases and keep QA honest.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#14151d",
    theme_color: "#5b5bd6",
    categories: ["productivity", "developer"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press the home screen icon to jump straight to a module.
    shortcuts: [
      { name: "Report a bug", short_name: "Report", url: "/bugs?new=1" },
      { name: "My dashboard", short_name: "Dashboard", url: "/" },
      { name: "Bug tracker", short_name: "Bugs", url: "/bugs" },
    ],
  };
}
