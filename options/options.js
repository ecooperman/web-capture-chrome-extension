const DEFAULT_APP_URL = "https://trips.evancooperman.com";
const DEFAULT_PLANS_URL = "https://plans.evancooperman.com";

async function load() {
  const { appUrl, plansUrl } = await chrome.storage.local.get({
    appUrl: DEFAULT_APP_URL,
    plansUrl: DEFAULT_PLANS_URL,
  });
  document.getElementById("app-url").value = appUrl;
  document.getElementById("plans-url").value = plansUrl;
}

// Chrome only allows asking for a host permission during a click, so
// Save is where access to non-default URLs (e.g. a local dev server) is
// requested - the production apps are already granted in manifest.json.
// The request has to be the first thing the handler does, before any
// await, or Chrome no longer counts it as part of the click.
document.getElementById("save-btn").addEventListener("click", () => {
  const appUrl = document.getElementById("app-url").value.trim() || DEFAULT_APP_URL;
  const plansUrl = document.getElementById("plans-url").value.trim() || DEFAULT_PLANS_URL;
  const status = document.getElementById("status");
  let origins;
  try {
    origins = [...new Set([appUrl, plansUrl].map((u) => `${new URL(u).origin}/*`))];
  } catch (err) {
    status.textContent = "One of those isn't a valid URL.";
    return;
  }
  chrome.permissions.request({ origins }, async (granted) => {
    await chrome.storage.local.set({ appUrl, plansUrl });
    status.textContent = granted ? "Saved." : "Saved, but access was declined - the extension can't reach those URLs until you allow it.";
    setTimeout(() => (status.textContent = ""), granted ? 2000 : 6000);
  });
});

load();
