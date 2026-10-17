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

// Two destinations: a single business (Yelp etc.) goes to Trip Planning's
// pre-filled "add activity" form; a whole saved Instagram collection goes
// to the Plans app (social-planning), which trips later pulls from.
const DEFAULT_APP_URL = "https://trips.evancooperman.com";
const DEFAULT_PLANS_URL = "https://plans.evancooperman.com";

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

async function getPlansUrl() {
  const { plansUrl } = await chrome.storage.local.get({ plansUrl: DEFAULT_PLANS_URL });
  return plansUrl.replace(/\/$/, "");
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

// Extension fetches to the apps are cross-origin from the popup's own
// perspective - a host permission for the app's origin is what lets fetch()
// reach it regardless of the server's CORS headers. The production apps are
// granted up front in manifest.json's host_permissions; any other URL set
// in Options (e.g. a local dev server) is requested when Options is saved,
// since Chrome only allows that request during a click - the popup itself
// only ever checks, never asks.
async function hasAppHostPermission(appUrl) {
  return chrome.permissions.contains({ origins: [`${new URL(appUrl).origin}/*`] });
}

// fetch() for the apps' JSON APIs. credentials: "include" sends the
// Cloudflare Access login cookie (an extension page is a different origin,
// so fetch's default would leave it off), and redirect: "manual" turns
// Access's redirect-to-login into a clear "sign in first" error rather than
// a confusing CORS failure on the login page.
async function appFetch(baseUrl, path, options = {}) {
  const host = new URL(baseUrl).host;
  if (!(await hasAppHostPermission(baseUrl))) {
    throw new Error(`No access to ${host} - open App URLs and click Save to allow it.`);
  }
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, { credentials: "include", redirect: "manual", ...options });
  } catch (err) {
    throw new Error(`Couldn't reach ${host} (${err.message}).`);
  }
  const signInError = new Error(`Not signed in to ${host} - open https://${host} in this browser, sign in, then try again.`);
  if (response.type === "opaqueredirect" || response.status === 401 || response.status === 403) throw signInError;
  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  if (!isJson) throw signInError; // Access's login page, not the app
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || `Request failed (${response.status})`);
  return body;
}

const NEW_LOCATION = "__new__";

// The collection's own slug (instagram.com/<user>/saved/<slug>/<id>/) is
// usually the place it's about - "salem", "new-york" - so it's used to
// preselect the matching Plans location, ignoring case and dashes.
function collectionSlug(url) {
  const match = new URL(url).pathname.match(/^\/[^/]+\/saved\/([^/]+)\//);
  return match ? decodeURIComponent(match[1]).replace(/[-_]+/g, " ").trim().toLowerCase() : "";
}

async function loadLocationOptions(plansUrl, slug, selectId) {
  const select = document.getElementById("location-select");
  try {
    const locations = await appFetch(plansUrl, "/api/locations");
    select.innerHTML = '<option value="">No location</option>';
    for (const loc of locations) {
      const opt = document.createElement("option");
      opt.value = String(loc.id);
      opt.textContent = loc.name;
      select.appendChild(opt);
    }
    const newOpt = document.createElement("option");
    newOpt.value = NEW_LOCATION;
    newOpt.textContent = "+ New location…";
    select.appendChild(newOpt);

    const match = locations.find((loc) => loc.name.trim().toLowerCase() === slug);
    if (selectId) select.value = String(selectId);
    else if (match) select.value = String(match.id);
  } catch (err) {
    select.innerHTML = '<option value="">Couldn\'t load locations</option>';
    setStatus(err.message, true);
  }
}

// Locations are a managed list in the Plans app (picked, never typed per
// plan) - creating one here goes through the same API as its Settings page,
// so the uniqueness check (ignoring case) still applies.
async function createLocation(plansUrl, slug) {
  const name = prompt("New location name:", slug.replace(/\b\w/g, (c) => c.toUpperCase()));
  if (!name || !name.trim()) return null;
  return appFetch(plansUrl, "/api/locations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim() }),
  });
}

async function initPopup() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url || !isInstagramCollectionPage(tab.url)) return;

  document.getElementById("single-post-section").classList.add("hidden");
  document.getElementById("collection-section").classList.remove("hidden");

  const plansUrl = await getPlansUrl();
  const slug = collectionSlug(tab.url);
  const select = document.getElementById("location-select");
  loadLocationOptions(plansUrl, slug);

  select.addEventListener("change", async () => {
    if (select.value !== NEW_LOCATION) return;
    try {
      const created = await createLocation(plansUrl, slug);
      await loadLocationOptions(plansUrl, slug, created && created.id);
      if (created) setStatus(`Added location "${created.name}".`, false);
    } catch (err) {
      setStatus(`Couldn't add location: ${err.message}`, true);
      await loadLocationOptions(plansUrl, slug);
    }
  });
}

document.getElementById("import-btn").addEventListener("click", async () => {
  const button = document.getElementById("import-btn");
  button.disabled = true;
  setStatus("Reading collection…", false);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const plansUrl = await getPlansUrl();

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

    const locationId = document.getElementById("location-select").value;
    const summary = await appFetch(plansUrl, "/api/instagram-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posts,
        location_id: locationId && locationId !== NEW_LOCATION ? Number(locationId) : null,
      }),
    });
    const notes = [];
    if (summary.posts_already_imported) notes.push(`${summary.posts_already_imported} already imported`);
    if (summary.posts_skipped) notes.push(`${summary.posts_skipped} not a place`);
    setStatus(
      `Created ${summary.plans_created} plan${summary.plans_created === 1 ? "" : "s"} from ${summary.posts_processed} post${summary.posts_processed === 1 ? "" : "s"}` +
        (notes.length ? ` (${notes.join(", ")}).` : "."),
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
