#!/usr/bin/env node
/**
 * IndexNow: tells Bing (and the other IndexNow engines: Yandex, Seznam, Naver, Yep) that public
 * URLs changed, so new pages are picked up quickly. Google does not use IndexNow.
 *
 *   node scripts/seo/indexnow.mjs https://built2bid.org/learn/new-guide [more URLs...]
 *
 * Rules (docs/seo/AI_SEARCH.md):
 * - Only send URLs that really changed (a new or edited public page). Never resend unchanged pages.
 * - Only built2bid.org URLs on the public sitemap; never app, account, signing or API paths.
 * - Waits up to 6 minutes for each URL to return 200 (Netlify deploys a few minutes after a commit), then submits once.
 * The key below is public by design: it is served at https://built2bid.org/<key>.txt to prove ownership.
 */
export const INDEXNOW_KEY = "e89608af96996d3374af4cfe3195e1df";
const HOST = "built2bid.org";
const PRIVATE = /^\/(api|admin|staff|dashboard|settings|builder|start|estimates|auth|login|sign|signed|co|scope|updates|projects|meet|home|financials|company|sales)(\/|$)/;

export function validUrls(list) {
  return [...new Set(list)].filter((u) => {
    try {
      const x = new URL(u);
      return x.protocol === "https:" && x.hostname === HOST && !PRIVATE.test(x.pathname) && !x.search;
    } catch {
      return false;
    }
  });
}

async function waitFor200(url, { tries = 12, delayMs = 30_000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { method: "GET", redirect: "manual" }).catch(() => null);
    if (r?.status === 200) return true;
    await new Promise((res) => setTimeout(res, delayMs));
  }
  return false;
}

async function main() {
  const urls = validUrls(process.argv.slice(2));
  if (!urls.length) { console.log("IndexNow: no eligible URLs."); return; }
  const live = [];
  for (const u of urls) {
    if (await waitFor200(u)) live.push(u);
    else console.warn(`IndexNow: ${u} never returned 200, skipped.`);
  }
  if (!live.length) return;
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key: INDEXNOW_KEY, keyLocation: `https://${HOST}/${INDEXNOW_KEY}.txt`, urlList: live }),
  });
  // 200/202 = accepted. 403 = key file not reachable yet. 422 = URL/host mismatch. 429 = too many submissions.
  console.log(`IndexNow: ${res.status} for ${live.length} URL(s): ${live.join(", ")}`);
  if (![200, 202].includes(res.status)) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
