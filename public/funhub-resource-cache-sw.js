/*
 * Compatibility cleanup for stale Funhub service worker registrations.
 *
 * Admin Base does not register this worker. This file exists because browsers
 * can keep a service worker registered for the same localhost/127.0.0.1 origin
 * after another project used that port. When Chrome checks the old worker URL,
 * serving this no-op replacement lets the registration activate and unregister
 * itself instead of repeatedly hitting Next.js with 404 requests.
 */

const LEGACY_CACHE_KEYWORDS = ["funhub", "resource-cache"];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((key) =>
              LEGACY_CACHE_KEYWORDS.some((keyword) => key.toLowerCase().includes(keyword)),
            )
            .map((key) => caches.delete(key)),
        );
      } catch {
        // Cache cleanup is best-effort; unregistering the legacy worker matters most.
      }

      try {
        await self.clients.claim();
      } catch {
        // If claiming fails, the unregister step below still stops future update checks.
      }

      await self.registration.unregister();

      try {
        const clients = await self.clients.matchAll({
          includeUncontrolled: true,
          type: "window",
        });
        for (const client of clients) {
          client.postMessage({ type: "ADMIN_BASE_LEGACY_FUNHUB_SW_UNREGISTERED" });
        }
      } catch {
        // Some browsers can reject client access during teardown.
      }
    })(),
  );
});
