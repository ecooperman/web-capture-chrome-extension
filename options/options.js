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

document.getElementById("save-btn").addEventListener("click", async () => {
  const appUrl = document.getElementById("app-url").value.trim() || DEFAULT_APP_URL;
  const plansUrl = document.getElementById("plans-url").value.trim() || DEFAULT_PLANS_URL;
  await chrome.storage.local.set({ appUrl, plansUrl });
  const status = document.getElementById("status");
  status.textContent = "Saved.";
  setTimeout(() => (status.textContent = ""), 2000);
});

load();
