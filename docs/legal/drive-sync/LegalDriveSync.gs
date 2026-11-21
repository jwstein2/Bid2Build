/**
 * Built2Bid — Legal Drive Sync (Google Apps Script, free, runs in James's Google account)
 *
 * Every hour it reads each public legal page on built2bid.org. When a page's text changes:
 *   1. the current Doc in "Published Policies (live site) / Active" moves to "Archive (old versions)"
 *      and gets " (superseded YYYY-MM-DD)" added to its name;
 *   2. a new Google Doc with the live text is created in Active, named "<Document> — v<version date>";
 *   3. a row is added to the "Legal Sync Change Log" sheet in Company Documents.
 * Nothing is ever deleted. No API keys or service accounts: it runs as the Google account that
 * authorized it, and only reads public pages.
 *
 * Setup (one time): paste this file + appsscript.json, run setup(), click Allow.
 * Add a new public page: add a line to PAGES below (path, document name). Source of truth for the
 * list is src/lib/legal/registry.ts in jwstein2/bid2build (docs/legal/GOOGLE_DRIVE_SYNC.md).
 */

const CONFIG = {
  SITE: 'https://built2bid.org',
  ACTIVE_FOLDER_ID: '1YNjS_L95HxLSvAs0S8t54ufZybaZbCxu',   // 01 Legal / Published Policies (live site) / Active
  ARCHIVE_FOLDER_ID: '1s1JRAGBS7QXBTyjd5_3tbijHvOq2W-ZU',  // 01 Legal / Published Policies (live site) / Archive (old versions)
  LOG_FOLDER_ID: '1JLtlt84QGCw-WLPXr6UWQr_8P2TK4qaY',      // Company Documents
  LOG_NAME: 'Legal Sync Change Log',
  NOTIFY_EMAIL: '',   // optional: an address to email when a document changes ('' = no email)
  TIME_ZONE: 'America/Chicago',
};

const PAGES = [
  ['terms', 'Terms of Service'],
  ['privacy', 'Privacy Policy'],
  ['cookies', 'Cookie Policy'],
  ['subprocessors', 'Service Providers (Subprocessors)'],
  ['accessibility', 'Accessibility Statement'],
  ['referral-terms', 'Referral Program Terms'],
  ['trial-terms', 'Free Trial, Pass and Gift Terms'],
  ['academy-terms', 'Academy Terms and Community Rules'],
  ['esign-disclosure', 'Electronic Signature Disclosure'],
  ['security', 'Security Overview'],
  ['affiliates/terms', 'Affiliate Program Terms (public page)'],
  ['legal', 'Legal Documents Index (public page)'],
];

/** Run once by hand: creates the hourly trigger and does a first pass (first pass only records a baseline). */
function setup() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncLegalDocs')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncLegalDocs').timeBased().everyHours(1).create();
  syncLegalDocs();
}

/** The hourly job. */
function syncLegalDocs() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const active = DriveApp.getFolderById(CONFIG.ACTIVE_FOLDER_ID);
    const archive = DriveApp.getFolderById(CONFIG.ARCHIVE_FOLDER_ID);
    const today = Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyy-MM-dd');
    const changes = [];
    const errors = [];

    PAGES.forEach(([path, name]) => {
      const url = CONFIG.SITE + '/' + path;
      try {
        const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
        if (res.getResponseCode() !== 200) { errors.push(name + ': HTTP ' + res.getResponseCode()); return; }
        const article = extractArticle_(res.getContentText());
        if (!article) { errors.push(name + ': no <article>/<main> found'); return; }
        const text = htmlToText_(article);
        if (text.length < 200) { errors.push(name + ': page text too short, skipped'); return; }
        const hash = sha256_(text);
        const key = 'hash:' + path;
        const prev = props.getProperty(key);
        const current = findActive_(active, name);

        if (prev === hash && current.length) return;            // unchanged
        if (!prev && current.length) {                          // first run: adopt the existing Doc as baseline
          props.setProperty(key, hash);
          return;
        }

        const version = extractVersion_(text) || today;
        let title = name + ' — v' + version;
        if (current.some(f => f.getName() === title)) {
          title += ' (rev ' + Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyy-MM-dd HHmm') + ')';
        }
        current.forEach(f => {
          f.moveTo(archive);
          f.setName(f.getName() + ' (superseded ' + today + ')');
        });
        const doc = createDocFromHtml_(title, wrap_(article, url, today), CONFIG.ACTIVE_FOLDER_ID,
          'Source: ' + url + ' | sha256: ' + hash + ' | captured ' + today);
        props.setProperty(key, hash);
        changes.push([new Date(), name, version, url, doc.webViewLink || '', current.map(f => f.getName()).join('; ')]);
      } catch (e) {
        errors.push(name + ': ' + e.message);
      }
    });

    if (changes.length) {
      logChanges_(changes);
      if (CONFIG.NOTIFY_EMAIL) {
        MailApp.sendEmail(CONFIG.NOTIFY_EMAIL, 'Built2Bid legal docs updated in Drive',
          changes.map(c => '• ' + c[1] + ' → v' + c[2] + '\n  ' + c[4]).join('\n'));
      }
    }
    if (errors.length) console.warn(errors.join('\n'));
    props.setProperty('lastRun', new Date().toISOString() + ' changes=' + changes.length + ' errors=' + errors.length);
  } finally {
    lock.releaseLock();
  }
}

// ---------- helpers ----------

function findActive_(folder, name) {
  const out = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(name + ' — v') === 0) out.push(f);
  }
  return out;
}

function extractArticle_(html) {
  const m = html.match(/<article[\s\S]*?<\/article>/i) || html.match(/<main[\s\S]*?<\/main>/i);
  if (!m) return null;
  return m[0]
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<button[\s\S]*?<\/button>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(href|src)="\/(?!\/)/g, '$1="' + CONFIG.SITE + '/');
}

function htmlToText_(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractVersion_(text) {
  const m = text.match(/Version:\s*([A-Z][a-z]+ \d{1,2}, \d{4})/) || text.match(/Last updated\s*([A-Z][a-z]+ \d{1,2}, \d{4})/);
  if (!m) return null;
  const d = new Date(m[1] + ' 12:00:00');
  return isNaN(d) ? null : Utilities.formatDate(d, CONFIG.TIME_ZONE, 'yyyy-MM-dd');
}

function wrap_(article, url, today) {
  return '<html><head><meta charset="utf-8"></head><body><p><i>Source: ' + url + ' — captured ' + today +
    ' by Legal Drive Sync</i></p>' + article + '</body></html>';
}

function createDocFromHtml_(title, html, folderId, description) {
  const blob = Utilities.newBlob(html, 'text/html', title + '.html');
  return Drive.Files.create(
    { name: title, mimeType: 'application/vnd.google-apps.document', parents: [folderId], description: description },
    blob,
    { fields: 'id,webViewLink' }
  );
}

function sha256_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function logChanges_(rows) {
  const folder = DriveApp.getFolderById(CONFIG.LOG_FOLDER_ID);
  const it = folder.getFilesByName(CONFIG.LOG_NAME);
  let ss;
  if (it.hasNext()) {
    ss = SpreadsheetApp.open(it.next());
  } else {
    ss = SpreadsheetApp.create(CONFIG.LOG_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    ss.getSheets()[0].appendRow(['Changed at', 'Document', 'New version', 'Source page', 'New Active Doc', 'Moved to Archive']);
  }
  const sh = ss.getSheets()[0];
  rows.forEach(r => sh.appendRow(r));
}

/** Optional: run by hand to see what the script remembers. */
function showStatus() {
  console.log(JSON.stringify(PropertiesService.getScriptProperties().getProperties(), null, 2));
}
