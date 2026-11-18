/** Mocked news feeds for tests and the screenshot walk. Shapes copied from the real feeds checked on 2026-11-18; no network. */
// ---- Mocked feeds (shapes copied from the real feeds checked on 2026-11-18; no network in tests) ----------
export const ACHR_RSS = `<?xml version="1.0"?><rss xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/" version="2.0"><channel>
<title>Subscribe to The NEWS's RSS Feed</title>
<item><title>Carbon Monoxide Safety Goes Beyond the Furnace </title>
<description>November is Carbon Monoxide Awareness Month. Contractors can help uncover hidden risks and protect homeowners.</description>
<guid>http://www.achrnews.com/articles/167014</guid><pubDate>Tue, 17 Nov 2026 13:00:00 -0500</pubDate>
<link>https://www.achrnews.com/articles/167014-carbon-monoxide-safety-goes-beyond-the-furnace?utm_source=rss&amp;utm_medium=feed</link>
<enclosure url="https://www.achrnews.com/ext/resources/2026/11/17/House-CO-Sources.webp" type="image/jpeg" length="136535"/></item>
<item><title>Heat Pump Sales in Minnesota Climb as Rebates Open</title><description><![CDATA[<p>Distributors say heat pump demand rose this fall.</p>]]></description>
<pubDate>Mon, 16 Nov 2026 09:00:00 -0500</pubDate><link>https://www.achrnews.com/articles/167001-heat-pump-sales-minnesota</link></item>
<item><title>No date item</title><description>x</description><link>https://www.achrnews.com/articles/1-no-date</link></item>
<item><title>Off-site link</title><description>x</description><pubDate>Mon, 16 Nov 2026 09:00:00 -0500</pubDate><link>https://evil.example.com/articles/1</link></item>
<item><title>Homepage link</title><description>x</description><pubDate>Mon, 16 Nov 2026 09:00:00 -0500</pubDate><link>https://www.achrnews.com/</link></item>
<item><title>Future item</title><description>x</description><pubDate>Mon, 30 Nov 2026 09:00:00 -0500</pubDate><link>https://www.achrnews.com/articles/2-future</link></item>
</channel></rss>`;

export const OSHA_RSS = `<?xml version="1.0" encoding="utf-8"?><rss version="2.0" xml:base="https://www.osha.gov/"><channel><title>OSHA News Release</title>
<item><title>US Department of Labor cites Illinois utility construction company for repeated exposure to trenching hazards</title>
<link>https://www.osha.gov/news/newsreleases/chicago/20261021</link><description>October 21, 2026</description><pubDate>Wed, 21 Oct 2026 12:00:00 +0000</pubDate></item>
<item><title>US Department of Labor cites powder coating company for toxic substance exposures</title>
<link>https://www.osha.gov/news/newsreleases/osha-national-news-release/20261116</link><description>November 16, 2026</description><pubDate>Mon, 16 Nov 2026 12:00:00 +0000</pubDate></item>
</channel></rss>`;

export const FR_ABSTRACT = "The Occupational Safety and Health Administration (OSHA) is proposing a standard to protect workers in construction and other industries from hazardous heat. The proposal would require employers to develop a heat injury and illness prevention plan, provide water and rest breaks, and train workers. OSHA invites comments on the proposal.";
export const FR_JSON = {
  count: 2,
  results: [
    { title: "Heat Injury and Illness Prevention in Outdoor and Indoor Work Settings", abstract: FR_ABSTRACT, html_url: "https://www.federalregister.gov/documents/2026/11/17/2026-23400/heat-injury-and-illness-prevention", publication_date: "2026-11-17", effective_on: null, type: "Proposed Rule", agencies: [{ name: "Occupational Safety and Health Administration" }], document_number: "2026-23400" },
    { title: "UL LLC: Application for Expansion of Recognition", abstract: "In this notice, OSHA announces the application of UL LLC for expansion of the scope of recognition as a Nationally Recognized Testing Laboratory (NRTL) and presents the agency&amp;#39;s preliminary finding to grant the application.", html_url: "https://www.federalregister.gov/documents/2026/11/17/2026-23315/ul-llc-application-for-expansion-of-recognition", publication_date: "2026-11-17", effective_on: null, type: "Notice", agencies: [{ name: "Occupational Safety and Health Administration" }], document_number: "2026-23315" },
  ],
};
export const FEMA_JSON = {
  DisasterDeclarationsSummaries: [
    { disasterNumber: 4955, state: "FL", declarationType: "DR", declarationDate: "2026-10-27T00:00:00.000Z", incidentType: "Hurricane", declarationTitle: "HURRICANE ISAIAS", incidentBeginDate: "2026-10-06T00:00:00.000Z", incidentEndDate: "2026-10-12T00:00:00.000Z", fipsStateCode: "12", fipsCountyCode: "005", designatedArea: "Bay (County)", iaProgramDeclared: false, ihProgramDeclared: true, paProgramDeclared: true },
    { disasterNumber: 4955, state: "FL", declarationType: "DR", declarationDate: "2026-10-27T00:00:00.000Z", incidentType: "Hurricane", declarationTitle: "HURRICANE ISAIAS", incidentBeginDate: "2026-10-06T00:00:00.000Z", incidentEndDate: "2026-10-12T00:00:00.000Z", fipsStateCode: "12", fipsCountyCode: "045", designatedArea: "Gulf (County)", iaProgramDeclared: false, ihProgramDeclared: true, paProgramDeclared: true },
  ],
};
