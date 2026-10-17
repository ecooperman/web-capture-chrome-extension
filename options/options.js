const DEFAULT_APP_URL = "https://trips.evancooperman.com";

async function load() {
  const { appUrl } = await chrome.storage.local.get({ appUrl: DEFAULT_APP_URL });
  document.getElementById("app-url").value = appUrl;
}

document.getElementById("save-btn").addEventListener("click", async () => {
  const input = document.getElementById("app-url");
  const value = input.value.trim() || DEFAULT_APP_URL;
  await chrome.storage.local.set({ appUrl: value });
  const status = document.getElementById("status");
  status.textContent = "Saved.";
  setTimeout(() => (status.textContent = ""), 2000);
});

load();
