# Web Capture

A small Chrome extension that captures what you're looking at into the
personal-projects apps, reading the page you already have open rather than
fetching anything server-side:

- **A single business** (a Yelp listing today, more sites can be added the
  same way later) goes to [trip-planning](../../trip-planning) as a
  pre-filled activity - name, address, phone, and URL - instead of
  copy-pasting each field by hand. It never saves this on its own: it opens
  Trip Planning's "add activity" form with those fields filled in for you
  to review, edit, and save yourself.
- **A whole saved Instagram collection** goes to the Plans app
  ([social-planning](../../social-planning)) as plans, one per real place
  Claude finds in each caption - see "Import an Instagram collection"
  below. Trip Planning then pulls plans in as activities ("Import from
  plans" on a trip page).

## Why this exists instead of server-side scraping

Yelp actively blocks server-side requests (bot-detection, not a simple
User-Agent check - see trip-planning's scraping notes). A real browser tab
you're looking at isn't a bot at all, so reading data out of that page's
own rendered DOM sidesteps the problem entirely rather than fighting it.
This is the same reason link-preview tools ship as browser extensions
rather than server-side fetchers for sites that don't want to be scraped.

## Load it

1. Go to `chrome://extensions`
2. Turn on "Developer mode" (top right)
3. Click "Load unpacked" and select this folder
4. Click the extension icon, then the "App URLs" link to set where it
   sends things (defaults to `https://trips.evancooperman.com` and
   `https://plans.evancooperman.com`; point them at your local dev servers,
   e.g. `http://127.0.0.1:8060` / `http://127.0.0.1:8020`, while testing)
5. Be signed in to both apps through Cloudflare Access in this Chrome
   profile - the extension's requests ride on that login.

## Use it

On a Yelp business page, click the extension icon, then "Send to Trip
Planner". A new tab opens at Trip Planning's Activities page with the "Add
Activity" form already open and filled in from the page - review it, then
click "Add activity" yourself. From there, associate it with a trip the
same way as any other activity (the trip page's "attach an existing
activity" picker).

## What it reads

For Yelp specifically: the business name and canonical URL (`og:title`
/ `og:url` meta tags), the street address (from the page's embedded
JSON-LD structured data), and phone number (parsed out of the meta
description, the one place Yelp exposes it as text). Any field it can't
find is left blank - fill those in yourself once the form opens.

For any other site, it falls back to just the standard Open Graph title
and URL - no address/phone, since those are Yelp-specific structured data.

## Adding another site

Add a `hostname -> extractor function` entry to `SITE_EXTRACTORS` in
`popup/popup.js`. Each extractor runs isolated inside the target page (via
`chrome.scripting.executeScript`), so it must be fully self-contained - no
references to anything outside the function itself, only nested helpers.

## Import an Instagram collection

1. Open one of your saved collections
   (`instagram.com/<you>/saved/<collection>/<id>/`) and scroll to the
   bottom so every post has loaded - only posts already rendered on the
   page are read (each post's caption is in its thumbnail's alt text).
2. Click the extension icon. On a collection page it switches to collection
   mode and preselects the Plans location whose name matches the
   collection's (e.g. "salem" -> "Salem"); pick another, or "+ New
   location…" to add one to the Plans app's managed list.
3. Click "Import this collection". The Plans app asks Claude for the real
   places in each caption (a "top 5 spots" post becomes five plans, a meme
   becomes none) and creates one plan per place, its URL pointing back at
   the source post.

Re-importing is safe: posts that already have plans are skipped before
Claude is asked anything, so a collection can be re-imported as it grows
and only the new posts cost anything.

Claude also notes where each place actually is, when the caption says -
so a Boston spot saved in a Salem collection gets flagged on the plans
page. To fill that in for posts imported before this existed, tick "Re-check
posts already imported" before importing: those posts' captions are re-read
and their plans updated, without adding any duplicates.
