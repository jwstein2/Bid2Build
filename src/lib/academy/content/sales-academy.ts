import type { CourseSeed } from "../types";

/**
 * Contractor Sales Academy: Built2Bid original coursework (content class "mixed": original lessons with
 * clearly attributed, link-only external resources). Written for small residential and light-commercial
 * contractors. No statistics are quoted; where something depends on the state (contracts, cancellation rights,
 * licensing), the lesson says so.
 */
export const SALES_ACADEMY: CourseSeed = {
  slug: "contractor-sales-academy",
  trade: null,
  pillar: "sales",
  title: "Contractor Sales Academy",
  summary: "Twelve practical lessons on winning the right jobs at the right price, from the first call to the referral.",
  description:
    "A complete, trade-aware sales course for contractors who sell their own work. It follows the real order of a job: getting qualified leads, answering enquiries, running the walk-through, presenting the estimate, handling price objections, following up, closing without pressure, and turning finished jobs into referrals. Each lesson has an original Built2Bid write-up, practical takeaways, a checklist, notes for specific trades, credited expert videos, and a link to the Built2Bid tool that puts the lesson into practice.",
  level: "beginner",
  access: "public",
  status: "published",
  contentClass: "mixed",
  featured: true,
  sort: 0,
  seoTitle: "Contractor Sales Training: Free 12-Lesson Course",
  seoDescription: "Free contractor sales course: finding leads, discovery, presenting estimates, price objections, follow-up, closing and referrals, with trade-specific examples.",
  plannedLessons: [],
  resources: ["skool-builders-circle", "skool-stg-academy", "skool-contractor-ads-university"],
  lessons: [
    // ------------------------------------------------------------------------------------------------------
    {
      slug: "finding-qualified-leads",
      module: "1. Getting the right leads",
      title: "Finding qualified leads",
      summary: "Why the best leads are the ones that fit your work, and how to build two or three dependable sources.",
      access: "public",
      minutes: 9,
      body: `A lead is only worth chasing if it fits your business: the right type of work, in your service area, with a realistic budget and timeline. Ten of those beat fifty random enquiries, because every appointment costs you drive time, an evening and an estimate.

### Know who you are looking for
Write one or two sentences describing your ideal job. For example: "Full roof replacements on owner-occupied homes within 30 minutes of the shop." That sentence decides where you spend your marketing time and which calls you politely refer out.

### Build more than one source
Most small contractors live on word of mouth until it slows down. Aim for two or three sources you work on every month:
- **Past customers and referrals.** The cheapest leads you will ever get. Stay in touch after the job.
- **Your Google Business Profile and reviews.** For local trades this is often the first thing a homeowner sees.
- **Relationships.** Suppliers, real-estate agents, property managers, other trades and builders who see work you don't do.
- **Yard signs, truck lettering and neighborhood work.** A finished job is an advertisement on the street.
- **Paid advertising**, once you can measure what a booked appointment costs.

### Track where every lead comes from
Ask every caller how they heard about you and write it down. After a few months you will see which sources bring jobs you actually win, not just phone calls. Spend more on those and less on the rest.

### Qualify early
A short set of questions on the first call (location, type of work, rough timing, whether they've set a budget) saves you from appointments that were never going to turn into work. Qualifying isn't rude; it respects both sides' time.`,
      takeaways: [
        "Define your ideal job in one sentence and market toward it.",
        "Work two or three lead sources on purpose instead of relying on one.",
        "Record the source of every lead so you can see which ones turn into signed work.",
        "Qualify on the first call: location, type of work, timing and budget.",
      ],
      checklist: [
        "Write your ideal-job sentence.",
        "List your current lead sources and circle the one that brings the best jobs.",
        "Pick one new source to work on this month.",
        "Add a \"How did you hear about us?\" question to your intake.",
        "Check that your Google Business Profile has your services, service area and recent photos.",
      ],
      tradeNotes: {
        roofing: "Storm activity brings floods of enquiries and competition. Qualify for insurance claims versus retail replacements early, because the conversations are very different.",
        landscaping: "Install customers are the best source of maintenance accounts. Every design-build lead is also a possible recurring customer.",
        concrete: "Builders, general contractors and property managers can supply steady flatwork. One reliable builder relationship can matter more than many one-off driveways.",
        painting: "Neighborhood work compounds: a well-run exterior repaint is visible to every neighbor on the street. Ask permission for a yard sign.",
        "interior-remodeling": "Remodeling leads take longer to mature. Keep in touch with people who are \"planning for next year\".",
        "general-contracting": "Architects, designers and real-estate agents are major referral sources for larger projects. Treat them like customers.",
      },
      action: { label: "Add your customers and lead sources", href: "/dashboard/customers", area: "customers", why: "Keep every lead, where it came from and its status in one list so you can see which sources win work." },
      resources: [
        { key: "hormozi-leads", note: "A broad framework for the ways a business can generate leads. Use it to list channels you haven't tried." },
        { key: "hunsaker-gbp", note: "How to set up and strengthen the Google Business Profile that most local customers see first." },
        { key: "hormozi-free-customers", note: "Low-cost ways to win customers, most of which apply directly to referrals and past customers." },
      ],
      quiz: [
        { q: "Which lead is most valuable to a small contractor?", options: ["Any enquiry, because volume matters most", "An enquiry that fits your work, area and budget", "The lead that came in first"], answer: 1, explain: "Every appointment costs time. Leads that fit your work are the ones that turn into profitable jobs." },
        { q: "Why record how each lead heard about you?", options: ["It's required by law", "So you can see which sources bring jobs you win", "To send them marketing emails"], answer: 1, explain: "Tracking sources shows where your marketing time and money actually pay off." },
      ],
    },
    // ------------------------------------------------------------------------------------------------------
    {
      slug: "responding-to-inquiries",
      module: "1. Getting the right leads",
      title: "Responding to inquiries",
      summary: "Fast, organised replies win appointments. Here is what to say on the first call and what to send after.",
      access: "public",
      minutes: 7,
      body: `Homeowners often contact several contractors at once. The first company that replies clearly and books a time usually gets the first look at the job, and first impressions stick.

### Respond quickly, even if briefly
If you're on a roof or under a sink, a short text such as "Thanks for reaching out. I'm on a job and will call you by 5 today" buys time and shows you're organised. Then keep that promise.

### Use a simple first-call script
Have the same handful of questions in front of you every time:
1. What's the project, and what prompted it now?
2. Where is the property?
3. When are you hoping to get it done?
4. Have you set a budget range, or would it help if I explained typical price ranges first?
5. Who else will be involved in the decision?

The last question matters. If a spouse or business partner needs to be part of the decision, invite them to the appointment.

### Confirm in writing
After booking, send a short confirmation: the date and time, who is coming, how long it will take, and anything they should have ready (photos, measurements, an HOA approval letter). A written confirmation reduces no-shows and sets a professional tone before you arrive.

### Refer out what you don't do
If the job isn't a fit, say so and, if you can, recommend someone. Homeowners remember the contractor who was honest with them, and other trades remember who sends them work.`,
      takeaways: [
        "Reply fast, even if it's just to say when you'll call.",
        "Ask the same qualifying questions every time.",
        "Find out who makes the decision and invite them to the appointment.",
        "Confirm the appointment in writing with what to expect.",
      ],
      checklist: [
        "Save a short \"I'll call you by...\" text template on your phone.",
        "Print or save your five first-call questions.",
        "Create an appointment confirmation template.",
        "Keep a list of trusted contractors you can refer out to.",
      ],
      tradeNotes: {
        roofing: "If there is an active leak, say what you can do now (tarping, temporary repair) and what the full inspection will cover.",
        landscaping: "Ask whether they want a one-time project or ongoing care. It changes who you send and how you price.",
        "general-contracting": "Ask whether they already have plans or drawings and whether permits have been discussed.",
      },
      action: { label: "Log the lead and start an estimate", href: "/builder", area: "estimate", why: "Start the estimate while the details from the call are fresh, so nothing gets lost before the site visit." },
      resources: [
        { key: "builder-funnel-remodel-sales", note: "Shows a short phone pre-qualification on location, budget and project type before booking." },
      ],
    },
    // ------------------------------------------------------------------------------------------------------
    {
      slug: "discovery-conversations",
      module: "2. The appointment",
      title: "Conducting discovery conversations",
      summary: "The walk-through is where jobs are won. Ask before you measure, and listen more than you talk.",
      access: "public",
      minutes: 10,
      body: `Most contractors are good at measuring and poor at asking. Discovery is the part of the appointment where you learn why the customer called, what a good outcome looks like to them, and what worries them about the project.

### Start with their story, not your tape measure
Before you look at anything, ask: "Tell me what's going on and what made you call now." People buy for reasons: a leak before winter, a house going on the market, a growing family, a bad experience with another contractor. If you know the reason, you can write a proposal that answers it.

### Useful discovery questions
- What made you decide to do this now?
- What would make this project a success for you?
- What worries you most about having this work done?
- Have you had work like this done before? How did it go?
- Is there anything you definitely want, or definitely don't?
- How will you make the decision, and when?

### Listen, then repeat it back
After they answer, summarise: "So the main thing is getting the leak fixed before winter, and you want the cleanup to be good because you have young kids. Did I get that right?" This shows you listened and lets them correct you before you price the wrong job.

### Write it down
Notes from discovery become the first paragraph of your proposal. When a homeowner reads their own priorities in your proposal, it feels written for them, because it was.`,
      takeaways: [
        "Ask why they called now before you measure anything.",
        "Use open questions that start with what, how and why.",
        "Repeat back what you heard to confirm it.",
        "Use their priorities to open your proposal.",
      ],
      checklist: [
        "Pick four discovery questions and use them on your next appointment.",
        "Bring a notes page (or use your phone) dedicated to the customer's goals and worries.",
        "Practise a one-sentence summary to repeat back.",
        "Add a \"Your goals\" section to your proposal template.",
      ],
      tradeNotes: {
        "interior-remodeling": "Ask how they'll live in the house during the work. Dust, noise and kitchen access often matter more than the finish list.",
        painting: "Ask about past paint jobs that failed. It opens a natural conversation about prep.",
        roofing: "Ask how long they plan to stay in the home; it shapes the material conversation.",
        concrete: "Ask how the slab will be used (vehicles, equipment, foot traffic). It determines thickness, reinforcement and the scope you need to explain.",
      },
      action: { label: "Capture notes in a new estimate", href: "/builder", area: "estimate", why: "Put the customer's goals in the estimate's notes so they carry straight into the proposal." },
      resources: [
        { key: "miner-discovery", note: "Questions that help a prospect explain their real problem instead of shutting down." },
        { key: "miner-better-questions", note: "How to word questions so the conversation opens up." },
        { key: "roofing-insights-7-steps", note: "One contractor's full sales process, useful for seeing where discovery fits." },
      ],
      quiz: [
        { q: "What should usually come first at a walk-through?", options: ["Measuring", "Asking why they called now", "Quoting a ballpark price"], answer: 1, explain: "Understanding the reason behind the project lets you scope and present the right job." },
      ],
    },
    // ------------------------------------------------------------------------------------------------------
    {
      slug: "understanding-customer-needs",
      module: "2. The appointment",
      title: "Understanding customer needs",
      summary: "Separate must-haves from nice-to-haves, and use options to fit the budget without cutting your price.",
      access: "members",
      minutes: 8,
      body: `Customers rarely arrive with a clear scope. They have needs (the roof must stop leaking), wants (they'd like a different color) and limits (budget, timing, HOA rules). Your job is to sort them.

### Needs, wants and limits
During or right after discovery, split what you heard into three columns:
- **Needs:** what must happen for the project to succeed.
- **Wants:** what would make them happier but could be phased or skipped.
- **Limits:** budget, schedule, access, permits, HOA or landlord approval.

### Talk about budget early and calmly
Many contractors avoid budget questions and then present a price that shocks the customer. Instead, give honest context: "Projects like this in our area usually fall somewhere between X and Y depending on materials. Where would you like to land?" Use your own real numbers, never a figure you can't stand behind.

### Use options instead of discounts
When the budget is tight, change the scope, not your price. Good, better and best options let the customer choose what matters to them while protecting your margin. Keep options simple: two or three, clearly different, each a complete job.

### Watch for hidden decision makers and deadlines
If the customer mentions a closing date, an event, or someone else who "has to see it", that is part of the need. Plan your proposal and follow-up around it.`,
      takeaways: [
        "Sort what you hear into needs, wants and limits.",
        "Discuss budget openly using your own real price ranges.",
        "Offer options that change scope rather than cutting price.",
        "Treat deadlines and other decision makers as part of the scope.",
      ],
      checklist: [
        "Use a needs / wants / limits page on your next appointment.",
        "Write down your honest price ranges for your three most common job types.",
        "Build a good / better / best option set for one common job.",
      ],
      tradeNotes: {
        landscaping: "Phasing works well: hardscape and grading now, planting and lighting next season.",
        "interior-remodeling": "Allowances for finishes the customer hasn't chosen keep the proposal honest. Explain how allowances work before they sign.",
        "general-contracting": "Separate base scope from alternates so the customer can compare like with like.",
      },
      action: { label: "Build option tiers in an estimate", href: "/builder", area: "estimate", why: "Group line items into sections so you can show what each option includes." },
      resources: [
        { key: "hormozi-never-lower-prices", note: "The argument for changing scope or terms instead of discounting." },
      ],
    },
    // ------------------------------------------------------------------------------------------------------
    {
      slug: "presenting-estimates-professionally",
      module: "3. The proposal",
      title: "Presenting estimates professionally",
      summary: "A clear, branded proposal walked through in person or on a call beats a number in a text message.",
      access: "members",
      minutes: 11,
      body: `The proposal is your product before the job starts. Two contractors can quote the same price, and the one whose proposal is clearer, more organised and easier to trust will usually win.

### What a professional proposal includes
- **The customer's goals**, in their words from discovery.
- **Scope of work**, written in plain language, grouped into sections the customer understands.
- **What's not included (exclusions)** and any allowances. This is where most disputes start, so be specific.
- **Price and payment schedule**, including deposit and when each payment is due.
- **Timeline**: estimated start window and duration.
- **Warranty and who to call** if something goes wrong.
- **Your company details**: license number where your state requires it, insurance, and contact information.
- **A clear way to accept**, such as a signature.

Contract requirements (cancellation rights, required notices, deposit limits, license display) vary by state and sometimes by city. Have your proposal and contract terms reviewed for the places you work.

### Present it, don't just send it
Whenever you can, walk the customer through the proposal in person or on a video call. Start with their goals, then scope, then exclusions, then price. Pause for questions after each section. If you must email it, call to go through it together.

### Decide your itemization policy in advance
Some contractors show every unit price; others show the scope in detail with section totals. Either can work. Decide before the customer asks, and be consistent.`,
      takeaways: [
        "Lead with the customer's goals, then scope, exclusions and price.",
        "Exclusions and allowances prevent most disputes. Be specific.",
        "Walk through the proposal live whenever possible.",
        "Have your contract terms reviewed for your state.",
      ],
      checklist: [
        "Check your proposal template for scope, exclusions, payment schedule, timeline and warranty.",
        "Add your license number where your state requires it.",
        "Book a presentation time when you schedule the walk-through.",
        "Decide and write down your itemization policy.",
      ],
      tradeNotes: {
        painting: "List prep steps (washing, scraping, priming, caulking) as their own section. It's the work customers can't see in a lower bid.",
        roofing: "Include photos of the current roof and a plain condition summary. Explain decking replacement as a unit price for hidden damage.",
        concrete: "State base depth, reinforcement, thickness and joint layout in writing so the customer can compare scopes, not just prices.",
        "interior-remodeling": "Spell out allowances, the change-order process and protection of the rest of the house.",
        "general-contracting": "Separate base scope, alternates and owner-supplied items so nothing is assumed.",
      },
      action: { label: "Create a professional proposal", href: "/builder", area: "proposal", why: "The estimate builder lets you add scope sections, exclusions and payment terms and send a branded proposal the customer can sign." },
      resources: [
        { key: "contractor-cuts-present", note: "Presenting an estimate as part of a relationship, not just a number." },
        { key: "wallin-break-down-bid", note: "One contractor's reasons for not itemizing prices, useful for setting your own policy." },
      ],
      quiz: [
        { q: "Which part of a proposal prevents the most disputes?", options: ["The logo", "Specific exclusions and allowances", "The payment button"], answer: 1, explain: "Disagreements usually come from assumptions about what was included." },
        { q: "Who decides what your contract must contain?", options: ["Only you", "Requirements vary by state and city; get your terms reviewed", "Your supplier"], answer: 1, explain: "Cancellation rights, notices and deposit rules differ by location." },
      ],
    },
    // ------------------------------------------------------------------------------------------------------
    {
      slug: "explaining-project-value",
      module: "3. The proposal",
      title: "Explaining project value",
      summary: "Help customers compare what they get, not just what they pay: process, materials, warranty and risk.",
      access: "members",
      minutes: 8,
      body: `Customers can compare prices in seconds. They can't easily compare what happens behind those prices. Explaining value means making the invisible parts of your work visible.

### What customers can't see in a price
- **Preparation and process**, such as surface prep, base work, flashing details or protection of the home.
- **Materials and specifications**, and why you chose them.
- **Insurance, licensing and permits**, and what they protect the customer from.
- **Communication and scheduling**: who answers their calls and how they'll know what's happening.
- **Warranty and follow-through**: what you'll do if something goes wrong.
- **Cleanup and site care.**

### Explain, don't attack
When a customer mentions a cheaper bid, avoid criticising the other contractor. Instead, offer to compare scopes side by side: "Let's look at what each proposal includes so you're comparing the same job." Often the difference is in what isn't written down.

### Use proof
Photos of similar jobs, reviews from nearby customers, and a clear description of your process are more convincing than adjectives like "quality" and "professional".

### Make it about their goals
Tie value back to discovery: "You said you plan to stay in this house for a long time, which is why we've specified..." Value is personal; connect it to what they told you.`,
      takeaways: [
        "Make preparation, materials, insurance and warranty visible.",
        "Compare scopes side by side rather than criticising competitors.",
        "Use photos and reviews as proof instead of adjectives.",
        "Tie value back to the customer's own goals.",
      ],
      checklist: [
        "Write a short \"How we work\" section for your proposal.",
        "Collect before/after photos of five recent jobs.",
        "Prepare a scope-comparison checklist for your most common job.",
      ],
      tradeNotes: {
        painting: "Prep and number of coats are the biggest invisible differences. Show them.",
        concrete: "Base preparation and reinforcement are invisible once the pour is done. Photograph them on every job so you can show future customers.",
        roofing: "Explain underlayment, flashing and ventilation; they decide how long a roof lasts and are hidden once shingles go on.",
      },
      action: { label: "Add scope details and exclusions", href: "/builder", area: "proposal", why: "Detailed scope and exclusion sections make the value of your proposal visible next to a cheaper one." },
      resources: [
        { key: "barstow-painting-sales", note: "Sales basics for painters, including explaining what the customer can't see." },
        { key: "profitdig-bidding", note: "Bidding strategically with clear inclusions and exclusions." },
      ],
    },
    // ------------------------------------------------------------------------------------------------------
    {
      slug: "handling-price-objections",
      module: "3. The proposal",
      title: "Handling price objections",
      summary: "\"Too expensive\" usually means something else. Ask, listen, and answer the real concern.",
      access: "members",
      minutes: 10,
      body: `Hearing "that's more than we expected" is normal. It doesn't mean the job is lost. It means the customer has a concern you haven't addressed yet.

### Stay calm and ask
Don't defend your price straight away. Ask a question:
- "That's fair. What were you expecting?"
- "Compared to what?"
- "Is it the total, or the timing of the payments?"
- "If price weren't a factor, would we be the company you'd choose?"

The answers tell you what the objection really is.

### Common real objections behind "too expensive"
- **They're comparing a different scope.** Offer a side-by-side comparison.
- **They don't trust the value yet.** Go back to process, proof and warranty.
- **The budget is real.** Offer options, phasing or a reduced scope.
- **Cash flow.** Discuss the payment schedule, or financing if you offer it.
- **They need to talk to someone else.** Offer to present again with everyone there.

### Change scope, not price
If you cut your price on request, you teach customers that your first number wasn't real. If the budget is the issue, adjust what's included and show the new price for the new scope.

### Know your walk-away number
Before every presentation, know the lowest price at which the job still makes sense for your business. If the customer needs to go below it, it's fine to say so respectfully and leave the door open.`,
      takeaways: [
        "Respond to a price objection with a question.",
        "Find the real concern: scope, trust, budget, cash flow or decision makers.",
        "Adjust scope instead of discounting.",
        "Know your walk-away number before you present.",
      ],
      checklist: [
        "Write down three questions you'll ask when you hear \"too expensive\".",
        "Calculate your walk-away margin for your most common job type.",
        "Prepare a reduced-scope version of a typical proposal.",
      ],
      tradeNotes: {
        concrete: "When you're up against a lower bid, compare base depth, thickness, reinforcement, joints and finish line by line. The difference is often in what isn't written.",
        roofing: "Homeowners often anchor on an insurance estimate or a deductible. Explain clearly what your proposal includes and how payments work; never offer to waive or absorb a deductible, which may be illegal where you work.",
        painting: "Ask whether the other quote included the same prep and coats. If not, the comparison isn't fair to either of you.",
        landscaping: "Phase the project or move some items to maintenance visits rather than cutting the install price.",
        "interior-remodeling": "Revisit allowances: the customer may be pricing finishes they don't need.",
        "general-contracting": "Value-engineering suggestions (alternate materials or sequencing) show you're on the owner's side without discounting your fee.",
      },
      action: { label: "Create a reduced-scope option", href: "/builder", area: "estimate", why: "Duplicate sections or items to build a smaller-scope version, rather than discounting the original." },
      resources: [
        { key: "reber-too-expensive", note: "What to say when a customer says you're too expensive, and how to find the real objection." },
        { key: "miner-too-expensive", note: "A short example of answering a price objection with questions." },
        { key: "bensman-roofing-objections", note: "Roofing-specific objections in one session." },
        { key: "bensman-roofing-price", note: "Handling cost concerns on roof replacements." },
      ],
      quiz: [
        { q: "A customer says your price is too high. What's the best first response?", options: ["Offer a discount", "Ask what they're comparing it to", "Explain your overhead"], answer: 1, explain: "A question uncovers the real concern without giving away margin." },
        { q: "If the budget really is lower than your price, what should you do?", options: ["Cut the price", "Reduce or phase the scope and show the new price", "End the conversation immediately"], answer: 1, explain: "Changing scope protects your pricing and still helps the customer." },
      ],
    },
    // ------------------------------------------------------------------------------------------------------
    {
      slug: "following-up-on-estimates",
      module: "4. After the proposal",
      title: "Following up on outstanding estimates",
      summary: "Silence is not a no. A planned, helpful follow-up recovers jobs that would otherwise be forgotten.",
      access: "members",
      minutes: 8,
      body: `Many estimates aren't lost to a competitor; they're lost to silence. The customer got busy, had a question they didn't ask, or simply forgot. A planned follow-up fixes that.

### Agree on the next step before you leave
At the end of the presentation, ask: "When would you like to make a decision?" and "Is it OK if I check in on Thursday?" Now your follow-up is expected, not pushy.

### A simple follow-up rhythm
- **Within a day:** thank them and send the proposal link again, with one useful detail (a photo of a similar job, a material sample, an answer to a question they asked).
- **On the agreed date:** call. Ask if they've had a chance to review and whether anything is unclear.
- **A week or so later:** a short message with something helpful, such as scheduling availability or a reminder about seasonal timing.
- **Then:** a respectful close-the-loop message: "Should I keep this open or close it out for now?" Many people reply to this one.

Adjust the rhythm to the size of the job. Larger projects often have longer decision cycles.

### Make every follow-up useful
"Just checking in" gives the customer nothing. Answer a question, share availability, or clarify a scope item. Each touch should help them decide.

### Track it
Know which proposals are open, when you last contacted each customer, and what the next step is. Without a list, follow-up depends on memory.`,
      takeaways: [
        "Agree on a decision date and follow-up time before you leave.",
        "Follow up with something useful, not \"just checking in\".",
        "Use a simple, repeatable rhythm, sized to the job.",
        "Keep a list of open proposals and next steps.",
      ],
      checklist: [
        "Ask for a decision date at your next presentation.",
        "Write templates for your day-one, agreed-date and close-the-loop messages.",
        "Review every open proposal once a week.",
      ],
      tradeNotes: {
        landscaping: "Seasonal timing is a genuine, helpful reason to follow up: planting windows and crew schedules fill up.",
        roofing: "If the customer is waiting on an insurance decision, ask when they expect to hear and follow up after that date.",
        "general-contracting": "Large projects may depend on financing or permits. Follow up on those milestones, not only on your proposal.",
      },
      action: { label: "Review your open proposals", href: "/dashboard", area: "pipeline", why: "Your dashboard shows every estimate and its stage, so you can see what needs a follow-up today." },
      resources: [
        { key: "reber-follow-up", note: "How long to wait and how to follow up without sounding desperate." },
      ],
    },
    // ------------------------------------------------------------------------------------------------------
    {
      slug: "closing-without-pressure",
      module: "4. After the proposal",
      title: "Closing without aggressive pressure",
      summary: "Closing is simply asking for a decision. Make it easy, clear and respectful.",
      access: "members",
      minutes: 7,
      body: `Many contractors present well and then never ask for the job. Closing doesn't mean pressure. It means making the next step clear and easy, then asking.

### Make sure they're ready
Before asking, check: "Does the scope cover everything we talked about? Any questions about the timeline or payments?" If something is unresolved, deal with it first.

### Ask a clear question
- "Would you like to get on the schedule?"
- "Shall I send the agreement for signature?"
- "Which option would you like to go with?"

Then stop talking. Silence is fine. Let the customer think.

### Make saying yes easy
A proposal they can sign online, a clear deposit amount, and a realistic start window remove friction. If they need to think, agree on when you'll talk next.

### Avoid tactics that damage trust
Fake deadlines, "today-only" prices and pressure to sign on the spot may win a job once and cost you referrals for years. Some states also have specific rules for home-improvement sales, including cancellation rights for contracts signed in the home. Know the rules where you work.

### Hear "no" well
If the answer is no, ask what led to the decision. It's useful information, and a gracious response keeps the door open for the next project or a referral.`,
      takeaways: [
        "Confirm there are no open questions before asking.",
        "Ask one clear question, then wait.",
        "Remove friction: online signature, clear deposit, realistic start window.",
        "Skip pressure tactics; learn from every \"no\".",
      ],
      checklist: [
        "Choose the closing question you'll use and practise it.",
        "Make sure your proposals can be accepted with a signature.",
        "Check your state's rules on in-home sales and cancellation rights.",
      ],
      tradeNotes: {
        roofing: "Insurance jobs: confirm who signs (often both owners) and what happens if the adjuster's scope changes before you ask for the signature.",
        concrete: "Weather and cure time drive the schedule. Close by offering two real pour windows, not by pushing for a decision today.",
        landscaping: "Seasonal timing is a fair reason to decide, not pressure. Say plainly when the planting or install window closes.",
        painting: "Offer a color consultation or sample patch as the next step when a customer hesitates. It moves the job forward without a hard ask.",
        "interior-remodeling": "Big remodels are joint decisions. Ask early who else needs to see the proposal and offer to walk through it with them.",
        "general-contracting": "Break a large project into a signed first phase (design, permits or demo) when the customer isn't ready to commit to everything.",
      },
      action: { label: "Send a proposal for e-signature", href: "/builder", area: "proposal", why: "Customers can review and sign your proposal online, which makes saying yes easy." },
      resources: [
        { key: "hormozi-3-steps-close", note: "A simple structure for asking for the sale." },
      ],
    },
    // ------------------------------------------------------------------------------------------------------
    {
      slug: "customer-communication",
      module: "4. After the proposal",
      title: "Customer communication",
      summary: "The sale continues after the signature. Predictable updates turn customers into referrers.",
      access: "members",
      minutes: 8,
      body: `How you communicate during the job decides whether the customer refers you. Most complaints come from surprises, not from the work itself.

### Set expectations at the start
After the contract is signed, tell the customer:
- who their main contact is,
- how and when you'll send updates,
- what the first few days will look like,
- how changes are handled (change orders, in writing, with price and schedule impact).

### Update on a rhythm
A short update at predictable times (end of each day on short jobs, or a weekly summary on longer ones) prevents most "what's going on?" calls. Include progress, what's next and anything you need from them.

### Deliver bad news early
Weather delays, material backorders and hidden damage happen. Tell the customer as soon as you know, with what it means for the schedule or price and what you recommend. Waiting makes it worse.

### Put changes in writing
Every change to scope, price or schedule should be written down and approved before the work is done. It protects both sides and keeps the final invoice from being a surprise.

### Close the job well
A final walk-through, a punch list completed promptly, warranty information and a thank-you set up the referral conversation in the next lesson.`,
      takeaways: [
        "Set the communication plan when the contract is signed.",
        "Send short updates at predictable times.",
        "Share bad news early with a recommendation.",
        "Approve every change in writing before doing the work.",
      ],
      checklist: [
        "Write a \"what happens next\" message for newly signed customers.",
        "Choose your update rhythm for short and long jobs.",
        "Use written change orders on your next job.",
      ],
      tradeNotes: {
        roofing: "Tell customers the day before tear-off what to expect: noise, nails, where the dumpster goes, and what to move from the attic.",
        concrete: "Explain cure time in writing: when they can walk on it, drive on it, and when sealing happens.",
        landscaping: "Send a short watering and care note when the job wraps. Most plant-loss complaints start with watering.",
        painting: "Confirm colors and sheen in writing before the first coat, and share a photo of each finished room or elevation.",
        "interior-remodeling": "A weekly update with photos, what's next and any open decisions prevents most remodel disputes.",
        "general-contracting": "Put every change in writing with its price and schedule impact before the work happens.",
      },
      action: { label: "Send project updates from Project Command Center", href: "/projects", area: "pm", why: "Schedule the job, share updates with the customer and keep changes documented in one place." },
      resources: [
        { key: "jobnimbus-communication", note: "Practical habits for contractor-customer communication." },
        { key: "schroeder-communication", note: "Why communication is a core construction-management skill." },
      ],
    },
    // ------------------------------------------------------------------------------------------------------
    {
      slug: "referrals-and-repeat-business",
      module: "4. After the proposal",
      title: "Referrals and repeat business",
      summary: "Ask at the right moment, make it easy, and stay in touch. Past customers are your best lead source.",
      access: "members",
      minutes: 7,
      body: `A happy customer is the start of your next job: a referral, a review, or their own next project.

### Ask at the moment of satisfaction
The best time to ask is when the customer is happiest, usually at the final walk-through or right after they've seen the finished work. "We really enjoyed this project. If you know anyone who needs similar work, we'd be grateful for an introduction."

### Make it easy
- Ask for an online review with a direct link.
- Leave a few business cards or a simple referral card.
- Ask permission to place a yard sign and to photograph the finished work.

### Stay in touch
Keep a list of past customers. A short check-in after a season, a maintenance reminder, or a note on the anniversary of the project keeps you top of mind for the next job. Only send marketing messages to people who agreed to receive them.

### Thank referrers
When a referral turns into a job, thank the person who sent it. A handwritten note goes a long way. If you offer referral rewards, check whether your state or licensing board restricts them.

### Build recurring work where it fits
Many trades can add maintenance plans, inspections or seasonal services that keep customers coming back. See the Recurring Revenue course in your trade classroom.`,
      takeaways: [
        "Ask for referrals and reviews when the customer is happiest.",
        "Make referring easy: review link, cards, yard sign.",
        "Stay in touch with past customers, with their permission.",
        "Thank every referrer; check local rules on referral rewards.",
      ],
      checklist: [
        "Get your direct review link and save it as a text template.",
        "Add a referral ask to your final walk-through.",
        "Start a past-customer list with permission to stay in touch.",
      ],
      tradeNotes: {
        landscaping: "Every install should end with a maintenance offer. It's the natural way to stay in the customer's yard.",
        roofing: "Offer a post-storm or annual inspection to past customers; it keeps the relationship alive.",
        painting: "Offer touch-up visits and a reminder when exterior repaint timing comes around.",
      },
      action: { label: "See your past customers", href: "/dashboard/customers", area: "customers", why: "Your customer list is your referral and repeat-work list." },
      resources: [
        { key: "hormozi-free-customers", note: "Low-cost ways to win customers, including referrals." },
        { key: "skool-restoration-referral", note: "A community focused on building referral partnerships (roofing and restoration)." },
      ],
    },
    // ------------------------------------------------------------------------------------------------------
    {
      slug: "measuring-sales-performance",
      module: "4. After the proposal",
      title: "Sales performance measurement",
      summary: "A few numbers, reviewed weekly, show where your sales process leaks.",
      access: "members",
      minutes: 8,
      body: `You can't improve what you don't measure. You don't need complicated reports: a handful of numbers reviewed every week will show you where jobs are being lost.

### The core numbers
- **Leads:** how many enquiries came in, and from which source.
- **Appointments:** how many turned into site visits.
- **Proposals sent:** how many estimates went out.
- **Jobs won:** how many were signed.
- **Close rate:** jobs won divided by proposals sent.
- **Average job size** and **gross margin** on won jobs.

### Read them as a funnel
Each step shows a different problem:
- Lots of leads but few appointments: your response time or qualifying needs work.
- Lots of appointments but few proposals: you may be visiting jobs that don't fit.
- Lots of proposals but a low close rate: look at presentation, value and follow-up.
- Good close rate but low margin: your pricing may be too low.

### Look at trends, not single weeks
One slow week means little. Compare months and seasons. Change one thing at a time so you can see what worked.

### Use your own baseline
Industry benchmarks vary widely by trade, region and job size. The most useful comparison is your own numbers last quarter versus this quarter.`,
      takeaways: [
        "Track leads, appointments, proposals, wins, close rate, job size and margin.",
        "Read the numbers as a funnel to find the leak.",
        "Look at monthly trends and change one thing at a time.",
        "Compare against your own past results.",
      ],
      checklist: [
        "Write down last month's leads, appointments, proposals and wins.",
        "Calculate your close rate.",
        "Pick the weakest step and one change to try this month.",
        "Set a weekly 15-minute numbers review.",
      ],
      tradeNotes: {
        roofing: "Track retail and insurance jobs separately. Their close rates and timelines are very different.",
        concrete: "Watch close rate by job type (flatwork, decorative, foundations). Many concrete contractors find one type is far more profitable per bid.",
        landscaping: "Track how many installs turn into maintenance agreements. That number drives next year's base revenue.",
        painting: "Measure interior and exterior separately, and watch how close rate changes through the season.",
        "interior-remodeling": "Track time from first visit to signed contract. Long gaps usually mean the design or budget conversation came too late.",
        "general-contracting": "Measure close rate by lead source. Referral leads and online leads behave very differently.",
      },
      action: { label: "Open your dashboard", href: "/dashboard", area: "pipeline", why: "See your estimates by stage and track how many turn into signed work." },
      resources: [
        { key: "claudio-metrics", note: "The business metrics contractors should track." },
      ],
      quiz: [
        { q: "You send many proposals but win few. Where should you look first?", options: ["Lead sources", "Presentation, value and follow-up", "Your logo"], answer: 1, explain: "Leaks after the proposal usually come from presentation, value and follow-up." },
      ],
    },
  ],
};
