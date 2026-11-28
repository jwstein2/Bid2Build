// App screenshot posts. Screens come from Built2Bid's built-in Demo Mode (made-up company and customers),
// captured 2026-11-28; real account names blurred. Claims are product facts visible in the screenshot.
// Dated (James approved 2026-11-28): week of 12/7 replaces one tip per platform; the rest go in the week of 12/14.
// Image: assets/app-shots/<id>.png. The scheduler treats these as part of the week whose dates they carry.
const IG = (topic) => `#contractor #construction #estimating #${topic}`;
module.exports = [
{ id: 'ig-shot-a', date: '2026-12-11', time: '11:00', platform: 'instagram', shot: '05-proposal-pricing.jpg', crop: [165, 140, 625, 530], kicker: 'INSIDE BUILT2BID',
  title: 'Line items your customer can actually read.', note: 'Sample proposal from the Built2Bid demo company.',
  caption: `This is the customer's view of a proposal: sections, plain-language line items and a price for each part of the job.\n\nNo napkin math, no mystery lump sum.\n\nFree plan at built2bid.org (link in bio).\n\n${IG('contractorlife')}` },
{ id: 'ig-shot-b', date: '2026-12-16', time: '11:00', platform: 'instagram', shot: '02-sign-online.jpg', crop: [215, 0, 780, 490], kicker: 'INSIDE BUILT2BID',
  title: 'Signed on their phone. No account needed.', note: 'Demo company shown. Your name and logo go on yours.',
  caption: `Your customer reviews the exact version you sent and signs on their phone or computer. They don't need an account or a payment to sign.\n\nThen you countersign, and the contract shows who signed when.\n\n${IG('smallbusiness')}` },
{ id: 'fb-shot-a', date: '2026-12-17', time: '07:30', platform: 'facebook', shot: '07-trade-picker.jpg', crop: [220, 80, 770, 545], kicker: 'INSIDE BUILT2BID',
  title: 'Pick the trade. Start with a real list.', note: '42 trades, one pricing engine and proposal builder.',
  caption: `Roofing, siding, decks, concrete, kitchens, baths, HVAC and more. Choose a trade and Built2Bid starts you with suggested sections and items.\n\nEvery trade uses the same pricing engine and proposal builder. Free plan at built2bid.org` },
{ id: 'fb-shot-b', date: '2026-12-10', time: '07:30', platform: 'facebook', shot: '06-proposal-total-schedule.jpg', crop: [165, 110, 625, 470], kicker: 'INSIDE BUILT2BID',
  title: 'Deposit, progress, completion. In writing.', note: 'Sample proposal from the Built2Bid demo company.',
  caption: `Put the payment schedule on the proposal, before anyone signs.\n\nSubtotal, sales tax, total, and what's due when. It saves an awkward conversation later.` },
{ id: 'li-shot-a', date: '2026-12-09', time: '12:00', platform: 'linkedin', shot: '03-estimate-costs.jpg', crop: [215, 0, 780, 545], kicker: 'INSIDE BUILT2BID',
  title: 'Cost, price and margin on every section.', note: 'Demo company data shown.',
  caption: `Each section of a Built2Bid estimate shows your cost, the customer price and the gross margin, with the proposal total and profit pinned at the bottom.\n\nYou see the margin while you build the bid, not after the job.\n\n#construction #estimating #contractors` },
{ id: 'li-shot-b', date: '2026-12-15', time: '12:00', platform: 'linkedin', shot: '01-my-bids.jpg', crop: [228, 40, 765, 435], kicker: 'INSIDE BUILT2BID',
  title: 'Approved jobs, ready for review.', note: 'Demo company data shown.',
  caption: `When a customer approves a bid, it lands in a review queue so nothing signed gets lost in an inbox.\n\nOne list, one place to start the job.\n\n#construction #smallbusiness #contractors` },
];
