# Trip Clipper

A small Chrome extension that sends the business you're currently looking
at (a Yelp listing today, more sites can be added the same way later) to
[trip-planning](../trip-planning) as a pre-filled activity - name, address,
phone, and URL - instead of copy-pasting each field by hand.

It never saves anything on its own. It opens Trip Planning's "add activity"
form with those fields filled in for you to review, edit, and save
yourself.

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
4. Click the extension icon, then the "Trip Planning app URL" link to set
   where it should open activities (defaults to
   `https://trips.evancooperman.com`; point it at your local dev server,
   e.g. `http://127.0.0.1:8060`, while testing)

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
