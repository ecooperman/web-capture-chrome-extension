// Extracts business details from the page you're currently looking at and
// opens Trip Planning's "add activity" form pre-filled with them, for you
// to review and save. Runs entirely client-side against the page's own
// rendered DOM (the same content your browser already loaded as a normal,
// human page view) - never fetches anything server-side, so it isn't
// affected by sites that block server-side scraping.
//
// Each extractor function below is passed to chrome.scripting.executeScript
// and runs isolated in the target page, so it must be fully self-contained
// (no references to anything outside itself - nested helpers only).

const DEFAULT_APP_URL = "https://trips.evancooperman.com";

function extractYelp() {
  function getMeta(prop) {
    const el = document.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`);
    return el ? el.getAttribute("content") : null;
  }

  function findAddressRecursive(obj) {
    if (!obj || typeof obj !== "object") return null;
    if (obj.address && obj.address.streetAddress) return obj.address;
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (Array.isArray(val)) {
        for (const item of val) {
          const found = findAddressRecursive(item);
          if (found) return found;
        }
      } else if (val && typeof val === "object") {
        const found = findAddressRecursive(val);
        if (found) return found;
      }
    }
    return null;
  }

  function findAddress() {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const s of scripts) {
      try {
        const found = findAddressRecursive(JSON.parse(s.textContent));
        if (found) return found;
      } catch (e) {
        // skip malformed JSON-LD blocks
      }
    }
    return null;
  }

  const ogTitle = getMeta("og:title") || document.title || "";
  const name = ogTitle.split(" - ")[0].trim();
  const description = getMeta("description") || "";

  const addressObj = findAddress();
  const address = addressObj
    ? [addressObj.streetAddress, addressObj.addressLocality, addressObj.addressRegion, addressObj.postalCode].filter(Boolean).join(", ")
    : null;

  // Yelp's meta description embeds the phone as "+1XXXXXXXXXX" - not
  // exposed as a structured field anywhere else on the page.
  const phoneMatch = description.match(/\+1(\d{10})\b/);
  const phone_number = phoneMatch ? `(${phoneMatch[1].slice(0, 3)}) ${phoneMatch[1].slice(3, 6)}-${phoneMatch[1].slice(6)}` : null;

  const map_link = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;

  return { name, url: getMeta("og:url") || window.location.href, address, phone_number, map_link };
}

// Fallback for any other site: just the standard Open Graph fields every
// link-preview-friendly page tends to expose. No address/phone - those are
// site-specific structured data Yelp happens to embed.
function extractGeneric() {
  function getMeta(prop) {
    const el = document.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`);
    return el ? el.getAttribute("content") : null;
  }
  return {
    name: (getMeta("og:title") || document.title || "").trim(),
    url: getMeta("og:url") || window.location.href,
    address: null,
    phone_number: null,
    map_link: null,
  };
}

// Add another site's extractor here the same way - hostname -> function.
const SITE_EXTRACTORS = {
  "www.yelp.com": extractYelp,
  "yelp.com": extractYelp,
};

// Reads every post currently rendered on an Instagram saved-collection grid
// page (e.g. instagram.com/<user>/saved/<collection>/<id>/) - just what's
// already in the DOM from scrolling/loading the page normally, no
// additional navigation or opening individual posts. Instagram puts each
// post's full caption in its thumbnail <img>'s alt text (confirmed by
// hand - it's not just generic accessibility text), which is what makes a
// batch read of a whole collection possible without visiting each post.
function extractInstagramCollectionGrid() {
  const links = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
  const seen = new Set();
  const posts = [];
  for (const a of links) {
    const href = a.getAttribute("href");
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const img = a.querySelector("img");
    if (!img || !img.alt) continue; // no caption to work with - skip rather than send empty
    posts.push({
      permalink: new URL(href, window.location.origin).href,
      caption: img.alt,
      thumbnail_url: img.src || null,
    });
  }
  return posts;
}

function base64UrlEncode(obj) {
  const json = JSON.stringify(obj);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function setStatus(text, isError) {
  const el = document.getElementById("status");
  el.textContent = text;
  el.className = "status" + (isError ? " error" : "");
}

async function getAppUrl() {
  const { appUrl } = await chrome.storage.local.get({ appUrl: DEFAULT_APP_URL });
  return appUrl.replace(/\/$/, "");
}

document.getElementById("send-btn").addEventListener("click", async () => {
  const button = document.getElementById("send-btn");
  button.disabled = true;
  setStatus("Reading page…", false);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const hostname = new URL(tab.url).hostname;
    const extractor = SITE_EXTRACTORS[hostname] || extractGeneric;

    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractor });

    if (!result || !result.name) {
      setStatus("Couldn't find a business name on this page.", true);
      button.disabled = false;
      return;
    }

    const appUrl = await getAppUrl();
    const prefill = base64UrlEncode(result);
    await chrome.tabs.create({ url: `${appUrl}/activities.html?prefill=${prefill}` });
    window.close();
  } catch (err) {
    setStatus(`Failed: ${err.message}`, true);
    button.disabled = false;
  }
});

// --- Instagram collection import --------------------------------------------
//
// A saved-collection grid page looks like
// instagram.com/<user>/saved/<collection-slug>/<id>/ - the bare
// /<user>/saved/ picker page (no collection chosen yet) doesn't match, so
// the button only appears once you've actually opened one.
function isInstagramCollectionPage(url) {
  const parsed = new URL(url);
  if (!/(^|\.)instagram\.com$/.test(parsed.hostname)) return false;
  return /^\/[^/]+\/saved\/[^/]+\/.+/.test(parsed.pathname);
}

// Extension fetches to the configured app are cross-origin from the
// popup's own perspective - host_permissions (requested here, not baked
// into the manifest, since the app URL is user-configurable in Options)
// is what lets fetch() reach it regardless of the server's own CORS
// headers, same mechanism content scripts use for the page they're on.
async function ensureAppHostPermission(appUrl) {
  const originPattern = `${new URL(appUrl).origin}/*`;
  const already = await chrome.permissions.contains({ origins: [originPattern] });
  if (already) return true;
  return chrome.permissions.request({ origins: [originPattern] });
}

async function loadTripOptions(appUrl) {
  const select = document.getElementById("trip-select");
  try {
    const granted = await ensureAppHostPermission(appUrl);
    if (!granted) {
      select.innerHTML = '<option value="">Permission needed - click Import</option>';
      return;
    }
    const trips = await fetch(`${appUrl}/api/trips`).then((r) => r.json());
    select.innerHTML = '<option value="">Don\'t associate with a trip</option>';
    for (const trip of trips) {
      if (trip.archived) continue;
      const opt = document.createElement("option");
      opt.value = String(trip.id);
      opt.textContent = trip.location;
      select.appendChild(opt);
    }
  } catch (err) {
    select.innerHTML = '<option value="">Couldn\'t load trips</option>';
  }
}

async function initPopup() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url || !isInstagramCollectionPage(tab.url)) return;

  document.getElementById("single-post-section").classList.add("hidden");
  document.getElementById("collection-section").classList.remove("hidden");

  const appUrl = await getAppUrl();
  loadTripOptions(appUrl);
}

document.getElementById("import-btn").addEventListener("click", async () => {
  const button = document.getElementById("import-btn");
  button.disabled = true;
  setStatus("Reading collection…", false);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const appUrl = await getAppUrl();

    const granted = await ensureAppHostPermission(appUrl);
    if (!granted) {
      setStatus("Permission to reach the app was declined.", true);
      button.disabled = false;
      return;
    }

    const [{ result: posts }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractInstagramCollectionGrid,
    });

    if (!posts || posts.length === 0) {
      setStatus("No posts with captions found on this page.", true);
      button.disabled = false;
      return;
    }

    setStatus(`Asking Claude about ${posts.length} post${posts.length === 1 ? "" : "s"}…`, false);

    const tripId = document.getElementById("trip-select").value;
    const response = await fetch(`${appUrl}/api/instagram-import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posts, trip_id: tripId ? Number(tripId) : null }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || `Request failed (${response.status})`);
    }

    const summary = await response.json();
    setStatus(
      `Created ${summary.activities_created} activit${summary.activities_created === 1 ? "y" : "ies"} from ${summary.posts_processed} post${summary.posts_processed === 1 ? "" : "s"}` +
        (summary.posts_skipped ? ` (${summary.posts_skipped} skipped - not a place).` : "."),
      false
    );
  } catch (err) {
    setStatus(`Failed: ${err.message}`, true);
  } finally {
    button.disabled = false;
  }
});

initPopup();

document.getElementById("options-link").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
