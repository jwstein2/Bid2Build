/**
 * Built2Bid Sales Academy (James, 2026-11-19): internal training for the sales team, organized by topic.
 * Each lesson is our own summary of ideas popularized by five teachers, with credit and links to their
 * official books, sites and YouTube channels. Videos play through YouTube's own embed player (nothing
 * is downloaded or re-hosted). Every video id was checked against the teacher's official channel and
 * YouTube's embed endpoint on 2026-11-19. The "why it's here" notes describe why we picked the video,
 * not a transcript of it.
 */

export type MentorId = "hormozi" | "miner" | "gordon" | "voss" | "sandler";

export interface Mentor {
  id: MentorId; name: string; knownFor: string; site: { label: string; url: string };
  book?: { title: string; url: string }; channel: { label: string; url: string };
}

export const MENTORS: Record<MentorId, Mentor> = {
  hormozi: {
    id: "hormozi", name: "Alex Hormozi", knownFor: "Offers and value: the value equation and the \"grand slam\" offer",
    site: { label: "Acquisition.com", url: "https://www.acquisition.com" }, book: { title: "$100M Offers", url: "https://www.acquisition.com/books" },
    channel: { label: "@AlexHormozi", url: "https://www.youtube.com/@AlexHormozi" },
  },
  miner: {
    id: "miner", name: "Jeremy Miner", knownFor: "NEPQ: question-led selling that lets prospects persuade themselves",
    site: { label: "7th Level", url: "https://7thlevelhq.com" }, channel: { label: "@JeremyMiner", url: "https://www.youtube.com/@JeremyMiner" },
  },
  gordon: {
    id: "gordon", name: "Cole Gordon", knownFor: "Repeatable phone-sales process, setting and closing, sales team habits",
    site: { label: "Closers.io", url: "https://closers.io" }, channel: { label: "@colethomasgordon", url: "https://www.youtube.com/@colethomasgordon" },
  },
  voss: {
    id: "voss", name: "Chris Voss", knownFor: "Tactical empathy: labels, mirrors, calibrated and no-oriented questions",
    site: { label: "The Black Swan Group", url: "https://www.blackswanltd.com" }, book: { title: "Never Split the Difference", url: "https://www.blackswanltd.com" },
    channel: { label: "@NegotiationMastery", url: "https://www.youtube.com/@NegotiationMastery" },
  },
  sandler: {
    id: "sandler", name: "Sandler Training", knownFor: "Up-front contracts, the pain funnel, qualifying hard and selling like you don't need the deal",
    site: { label: "Sandler", url: "https://sandler.com" }, channel: { label: "@SandlerWorldwide", url: "https://www.youtube.com/@SandlerWorldwide" },
  },
};

export interface Video { id: string; mentor: MentorId; title: string; why: string }
export interface Principle { mentor: MentorId; text: string }
export interface QuizQuestion { q: string; options: string[]; answer: number; explain: string }
export interface Topic {
  id: string; title: string; goal: string; principles: Principle[]; tryIt: string; videos: Video[]; quiz: QuizQuestion[];
}

export const TOPICS: Topic[] = [
  {
    id: "prospecting", title: "Prospecting and cold calling",
    goal: "Get a busy contractor to give you two minutes, and book the next step.",
    principles: [
      { mentor: "sandler", text: "The goal of a prospecting call is an appointment, not a sale. Ask for a short, specific next step." },
      { mentor: "miner", text: "Most cold calls fail because they sound like every other pitch. Lower the pressure and lead with a question about them, not a speech about you." },
      { mentor: "hormozi", text: "Volume and consistency win. A few calls tell you nothing; judge your outreach over enough attempts to matter." },
      { mentor: "voss", text: "Name what they're probably feeling (\"this probably sounds like another sales call\") before they say it. It disarms the reflex to hang up." },
      { mentor: "gordon", text: "Have a simple, repeatable opener and track results so you improve the script, not just your mood." },
    ],
    tryIt: "\"Hi Mike, it's Sam with Built2Bid. I know you weren't expecting my call, so I'll be quick. Would it be crazy to ask how you're putting together bids right now?\"",
    videos: [
      { id: "x7a0UQKWM2M", mentor: "sandler", title: "Sandler Rule #8: When Prospecting, Go for the Appointment", why: "Why the only goal of a cold call is the next meeting." },
      { id: "myp_KKEToGo", mentor: "miner", title: "The REAL Reason Most People SUCK at Cold Calling", why: "What makes cold calls sound like every other pitch, and how to avoid it." },
      { id: "AL8wyrBQKxM", mentor: "voss", title: "The BEST Way To Cold Call People", why: "A tactical-empathy angle on opening a cold call." },
      { id: "E0txxecMmPI", mentor: "hormozi", title: "Try This Hook For Cold Calls", why: "A short example of a cold-call hook." },
      { id: "FRRwqz1_zec", mentor: "gordon", title: "How to cold call the RIGHT way", why: "A quick take on cold-call structure." },
    ],
    quiz: [
      { q: "What is the main goal of a first cold call to a contractor?", options: ["Close the sale on the call", "Book a short, specific next step", "Read the full feature list", "Get their credit card"], answer: 1, explain: "Sandler: prospecting is for appointments. Selling happens in the meeting." },
      { q: "A prospect sounds annoyed you called. What's the best first move?", options: ["Talk faster", "Name it: \"Sounds like I caught you at a bad time\"", "Ignore it and pitch", "Hang up"], answer: 1, explain: "Labeling the emotion (Voss) lowers resistance." },
      { q: "How should you judge whether your call script works?", options: ["After 3 calls", "By how you feel", "Over enough calls to see a real pattern, tracked", "Never change it"], answer: 2, explain: "Hormozi and Gordon: measure over real volume, then adjust." },
      { q: "Which opener fits a low-pressure approach?", options: ["\"Do you have 30 minutes for a demo?\"", "\"Would it be crazy to ask how you're doing bids today?\"", "\"You need our software.\"", "\"Are you the decision maker?\""], answer: 1, explain: "A question about them, asked softly, keeps the door open (Miner)." },
    ],
  },
  {
    id: "openers", title: "Openers and setting the agenda",
    goal: "Start every call with trust and a clear, agreed plan.",
    principles: [
      { mentor: "sandler", text: "Use an up-front contract: agree on time, purpose, what each side wants, and that \"no\" is an okay outcome." },
      { mentor: "voss", text: "Avoid openers that sound scripted or needy. Your tone matters more than your words; slow, calm and friendly wins." },
      { mentor: "miner", text: "Connection questions about their situation build trust faster than compliments or small talk." },
      { mentor: "gordon", text: "Set the frame at the start of every call so the prospect knows where it's going and you stay in control." },
      { mentor: "hormozi", text: "Tell them what will happen on the call and get a quick yes. People relax when they know the plan." },
    ],
    tryIt: "\"Thanks for the time. Here's what I was thinking: I'll ask a few questions about how you bid jobs, and if it looks like Built2Bid can help, I'll show you. If not, just tell me, and that's totally fine. Fair?\"",
    videos: [
      { id: "kKAbuUmrwHU", mentor: "sandler", title: "What Is An Upfront Contract?", why: "The core Sandler tool for starting meetings." },
      { id: "XiSGB8AAvXU", mentor: "voss", title: "The WORST Opening Line On Phone Calls", why: "Which openers trigger resistance." },
      { id: "Zc4u8TE78go", mentor: "hormozi", title: "Start Your Intro Sales Calls Like This", why: "Setting expectations at the start of a call." },
      { id: "6YmvdGWkRX4", mentor: "gordon", title: "ALWAYS Do This at the Beginning of Every Sales Call", why: "Framing the call before anything else." },
      { id: "OD8pKjPhPKE", mentor: "miner", title: "TOP Connection Questions to Disarm Prospects", why: "Questions that build trust early." },
    ],
    quiz: [
      { q: "What belongs in an up-front contract?", options: ["Price and discount", "Time, purpose, what each side wants, and that no is okay", "Only the demo", "A signed agreement"], answer: 1, explain: "Sandler's up-front contract sets the rules of the meeting." },
      { q: "Why tell a prospect that \"no\" is an acceptable outcome?", options: ["It's a trick", "It lowers pressure so they speak honestly", "It ends calls faster", "It's required by law"], answer: 1, explain: "Removing pressure gets the truth sooner (Sandler, Voss)." },
      { q: "Which builds trust faster?", options: ["Complimenting their website", "Questions about how they work today", "A long company history", "Talking about your quota"], answer: 1, explain: "Connection questions (Miner) show interest in them." },
      { q: "What matters most in how an opener lands?", options: ["Speed", "Tone: calm, slow, friendly", "Using their name 5 times", "Jargon"], answer: 1, explain: "Voss: tone carries the message." },
    ],
  },
  {
    id: "discovery", title: "Discovery questions",
    goal: "Find the real problem, what it costs them, and why it matters now.",
    principles: [
      { mentor: "miner", text: "Ask questions that help the prospect see their own problem. People believe what they say, not what you tell them." },
      { mentor: "sandler", text: "Go below the surface: from the problem, to its impact on the business, to how they feel about it (the pain funnel)." },
      { mentor: "voss", text: "Use calibrated \"how\" and \"what\" questions. They invite thinking instead of a defensive yes or no." },
      { mentor: "gordon", text: "One great question about what they want, and what's stopping them, is worth ten feature explanations." },
      { mentor: "sandler", text: "Qualify budget and decision process early so you don't present to someone who can't buy." },
    ],
    tryIt: "\"How long does a typical bid take you right now?\" Then \"What happens to jobs you don't get bids out for in time?\" Then \"How does that sit with you?\"",
    videos: [
      { id: "dDGX95UkV10", mentor: "miner", title: "What Questions To Ask Prospects During The Sales Discovery Process", why: "A walk-through of discovery questions." },
      { id: "1fjqLbojaos", mentor: "miner", title: "5 Sales Questions That Unlock Hidden Pain", why: "Questions that surface the real problem." },
      { id: "wQtYDah8qks", mentor: "sandler", title: "Digging Deeper into Pain Points", why: "Going past the first answer, Sandler style." },
      { id: "bIYzB9BddxI", mentor: "voss", title: "Reject Them Gently (Using No-Oriented & Calibrated Questions)", why: "How calibrated and no-oriented questions sound." },
      { id: "JBQvYyaerSo", mentor: "gordon", title: "1 Simple Question to 2X Your 1-Call Closes", why: "One high-leverage question during discovery." },
    ],
    quiz: [
      { q: "Which is a calibrated question?", options: ["\"Do you like your software?\"", "\"How are you handling bids when you're on a job site?\"", "\"Want to save time?\"", "\"Is price a problem?\""], answer: 1, explain: "\"How/what\" questions invite real answers (Voss)." },
      { q: "In the pain funnel, after the surface problem you ask about…", options: ["Price", "Its impact on the business and how they feel about it", "Their competitors", "Your features"], answer: 1, explain: "Sandler goes from problem, to impact, to personal cost." },
      { q: "Why let the prospect describe the problem in their words?", options: ["It saves you effort", "People trust conclusions they reach themselves", "It's polite", "It fills time"], answer: 1, explain: "Miner: self-persuasion is stronger than your pitch." },
      { q: "When should you learn who makes the buying decision?", options: ["After the demo", "Early, during discovery", "At contract", "Never"], answer: 1, explain: "Sandler: qualify decision and budget early." },
    ],
  },
  {
    id: "offers", title: "Offers and value",
    goal: "Present Built2Bid so the value clearly outweighs the price.",
    principles: [
      { mentor: "hormozi", text: "Value goes up with the dream outcome and how sure they are to get it, and goes down with the time and effort it takes. Sell to all four." },
      { mentor: "hormozi", text: "Turn an okay offer into a great one by removing obstacles: fast setup, help getting started, and risk reversal like no long-term contract." },
      { mentor: "sandler", text: "Build value before you talk price. Price only feels high when the value isn't clear yet." },
      { mentor: "hormozi", text: "Tie the offer to the specific problem they told you about, in their words." },
    ],
    tryIt: "\"You said bids take you three nights a week. With Built2Bid most contractors send a professional bid in about 15 minutes from their phone. It's $19.99 a month, no long-term contract, and you can export everything anytime.\"",
    videos: [
      { id: "EQnylAlCzZI", mentor: "hormozi", title: "Turn a 5/10 Offer Into a 10/10 Offer", why: "Improving an offer by stacking value and removing friction." },
      { id: "Cc1luSYiCSw", mentor: "hormozi", title: "This Is How I Make A 10/10 Offer", why: "How Hormozi builds a strong offer." },
      { id: "BTkFfb-2bQ0", mentor: "hormozi", title: "$10K Offer VS $10M Offer", why: "What separates an ordinary offer from a great one." },
      { id: "-CUewe3YmSk", mentor: "sandler", title: "The Art of the Sale: Focus on Value Before Price", why: "Why value comes before price." },
    ],
    quiz: [
      { q: "In the value equation, what lowers perceived value?", options: ["A bigger dream outcome", "More certainty", "More time and effort to get results", "A guarantee"], answer: 2, explain: "Hormozi: time delay and effort reduce value." },
      { q: "Which is honest risk reversal for Built2Bid?", options: ["\"Guaranteed to double your jobs\"", "\"No long-term contract, export your data anytime\"", "\"Free forever\"", "\"Refunds anytime\""], answer: 1, explain: "Our real policy: no long-term contracts, export anytime. Paid periods are non-refundable, so never promise refunds." },
      { q: "When should price come up?", options: ["First thing", "After the value for their problem is clear", "Never", "Only by email"], answer: 1, explain: "Sandler: value before price." },
      { q: "What makes an offer land?", options: ["A long feature list", "Tying it to the problem they described, in their words", "Talking fast", "Discounts"], answer: 1, explain: "Specific beats generic (Hormozi)." },
    ],
  },
  {
    id: "objections", title: "Objection handling",
    goal: "Treat objections as questions, find what's really behind them, and keep the conversation honest.",
    principles: [
      { mentor: "voss", text: "Label the concern first (\"sounds like timing is tight right now\"). Feeling heard comes before being persuaded." },
      { mentor: "miner", text: "Clarify before you answer. \"Too expensive compared to what?\" often reveals the real issue." },
      { mentor: "gordon", text: "Use one simple framework for every objection: acknowledge, ask what's behind it, solve the real issue, then ask again." },
      { mentor: "hormozi", text: "\"I need to think about it\" usually means a specific doubt. Help them name it so you can deal with it now." },
      { mentor: "sandler", text: "Bring up likely objections early yourself. Then they can't ambush the close." },
    ],
    tryIt: "Prospect: \"It's too expensive.\" You: \"Totally fair. When you say expensive, compared to what you're doing now, or compared to the jobs you might win back?\"",
    videos: [
      { id: "Xg0UekY7IJA", mentor: "gordon", title: "Handle ANY Sales Objection with this Simple Framework", why: "One repeatable framework for objections." },
      { id: "9vcERdTYHFw", mentor: "gordon", title: "\"That's Too Much Money\" - Objection Handling Masterclass", why: "A deep dive on the price objection." },
      { id: "GJqblRVm9cc", mentor: "miner", title: "Prospect Says This Is Too Expensive", why: "Clarifying the price objection." },
      { id: "IGErEpmmGOs", mentor: "hormozi", title: "How to Respond to \"I Need to Think About It\"", why: "Handling the most common stall." },
      { id: "e80c06jGmMI", mentor: "hormozi", title: "My favorite way to overcome sales objections", why: "Hormozi's go-to approach." },
      { id: "gQ8WtlZA_Z0", mentor: "sandler", title: "How To Handle Objections In Sales: The Early & Late Process", why: "Handling objections early versus late." },
      { id: "ThQ8xPGg-QQ", mentor: "voss", title: "Labeling Emotions Will Change Their Perception Of You", why: "How labeling works." },
    ],
    quiz: [
      { q: "A prospect says \"It's too expensive.\" Best first response?", options: ["Offer a discount", "Clarify: \"Compared to what?\"", "Argue the price is low", "Move on"], answer: 1, explain: "Miner: clarify before answering." },
      { q: "What does labeling sound like?", options: ["\"You're wrong\"", "\"It sounds like you've been burned by software before\"", "\"Calm down\"", "\"Trust me\""], answer: 1, explain: "Voss: name the feeling to defuse it." },
      { q: "\"I need to think about it\" usually means…", options: ["They will call back", "There's a specific doubt they haven't said", "They're sold", "Send more info"], answer: 1, explain: "Hormozi: help them name the doubt." },
      { q: "Why bring up common objections early?", options: ["To scare them", "So they don't derail the close later", "To fill time", "It's not useful"], answer: 1, explain: "Sandler: deal with objections before the close." },
    ],
  },
  {
    id: "negotiation", title: "Negotiation",
    goal: "Protect the price and the relationship. Win-win, not split-the-difference.",
    principles: [
      { mentor: "voss", text: "Tactical empathy: understand their position out loud before asking for anything." },
      { mentor: "voss", text: "Don't rush to negotiate price. Ask calibrated questions like \"How am I supposed to do that?\" and let them solve it with you." },
      { mentor: "sandler", text: "Cutting price to close cuts your credibility. Trade, don't give: if something changes, something else changes." },
      { mentor: "sandler", text: "When price comes up, go back to value and the problem you're solving." },
    ],
    tryIt: "Prospect: \"Can you do $10 a month?\" You: \"I hear you, every dollar counts when you're running jobs. How would I justify a lower price when the plan already pays for itself with one extra job?\"",
    videos: [
      { id: "PYjNDQgBSGw", mentor: "voss", title: "Why You NEVER Negotiate Price!", why: "Voss on avoiding price fights." },
      { id: "yTy6NiJgk_w", mentor: "voss", title: "What is Tactical Empathy?", why: "The foundation of Voss's approach." },
      { id: "vXMJHFY1yxc", mentor: "sandler", title: "Cut Your Price. Cut Your Throat", why: "Why discounting hurts the sale." },
      { id: "_qfWKwddj-M", mentor: "sandler", title: "How Do You Negotiate Your Price?", why: "Sandler on price conversations." },
    ],
    quiz: [
      { q: "Which is a calibrated question for a discount request?", options: ["\"No.\"", "\"How am I supposed to do that?\"", "\"Fine, half off.\"", "\"Why are you cheap?\""], answer: 1, explain: "Voss: make them help you solve it." },
      { q: "Can a rep change Built2Bid pricing on a call?", options: ["Yes, any amount", "No: offer only published plans and approved promotions", "Only on Fridays", "If the customer insists"], answer: 1, explain: "Reps can't invent discounts. Use published prices and owner-approved offers only." },
      { q: "What does Sandler say about cutting price to close?", options: ["Always do it", "It damages credibility; trade instead of giving", "It's required", "Only at month end"], answer: 1, explain: "\"Cut your price, cut your throat.\"" },
      { q: "What comes before asking for anything in a negotiation?", options: ["A deadline", "Showing you understand their position", "A threat", "Silence"], answer: 1, explain: "Tactical empathy first (Voss)." },
    ],
  },
  {
    id: "closing", title: "Closing",
    goal: "Ask clearly for the decision once they've told you it fits.",
    principles: [
      { mentor: "sandler", text: "Qualify hard, close easy. If discovery was honest, the close is just the next logical step." },
      { mentor: "miner", text: "Good questions let prospects close themselves: \"Do you feel this could be the answer for you?\"" },
      { mentor: "hormozi", text: "Summarize what they told you, confirm it's right, then ask for the decision plainly." },
      { mentor: "voss", text: "Aim for \"that's right\" (they feel understood), not a pressured \"yes\"." },
      { mentor: "gordon", text: "Follow the same process every time so your close rate is predictable, and review your calls." },
    ],
    tryIt: "\"So bids are eating your nights, you're losing jobs to faster competitors, and you want something you can use from the truck. Did I get that right? Then the next step is to start your account; it takes about five minutes. Want to do it together now?\"",
    videos: [
      { id: "kAIsmpo5wUI", mentor: "sandler", title: "Sandler Rule #45: Qualify Hard, Close Easy", why: "Why closing starts in discovery." },
      { id: "KCu1EyMxHcE", mentor: "miner", title: "4 Sales Questions So Good Prospects Will Close Themselves", why: "Question-led closing." },
      { id: "Xw08guwadh0", mentor: "hormozi", title: "How to Close the Sale", why: "Hormozi on asking for the decision." },
      { id: "pxNwYTXkooU", mentor: "voss", title: "The BEST Things To Say To Close A Deal", why: "Voss on closing language." },
      { id: "ix1qdS5a26Y", mentor: "gordon", title: "Steal My Exact Sales Process", why: "A complete call structure from open to close." },
    ],
    quiz: [
      { q: "What does \"qualify hard, close easy\" mean?", options: ["Push harder at the end", "Honest discovery makes the close natural", "Skip discovery", "Close on the first call always"], answer: 1, explain: "Sandler: the work happens before the close." },
      { q: "Which response shows the prospect feels understood?", options: ["\"Yes\"", "\"That's right\"", "\"Maybe\"", "\"Send info\""], answer: 1, explain: "Voss: \"that's right\" signals real agreement." },
      { q: "Before asking for the decision you should…", options: ["Offer a discount", "Summarize their problem and confirm it", "Talk about your commission", "Wait for them to ask"], answer: 1, explain: "Summarize, confirm, then ask (Hormozi)." },
      { q: "Which closing behavior is NOT allowed at Built2Bid?", options: ["Asking plainly for the decision", "False urgency or made-up deadlines", "Helping them sign up on the call", "Summarizing their needs"], answer: 1, explain: "No fake urgency, no false claims." },
    ],
  },
  {
    id: "follow-up", title: "Follow-up",
    goal: "Stay in touch in a way that adds value and gets a real answer.",
    principles: [
      { mentor: "miner", text: "Never open with \"just following up.\" Reference what they told you and ask a question that moves things forward." },
      { mentor: "gordon", text: "When prospects go quiet, make it easy to reply, even with a no. Silence is not a decision." },
      { mentor: "sandler", text: "The first answer isn't always the final answer. Follow up with purpose and a clear next step." },
      { mentor: "gordon", text: "Re-closing a \"no\" starts with understanding what changed, not pushing harder." },
      { mentor: "sandler", text: "Close the sale or close the file: don't let deals sit in limbo forever." },
    ],
    tryIt: "\"Hi Mike, last time you mentioned bids take three nights a week. Is that still the case, or have you found something that works? Either answer is fine.\"",
    videos: [
      { id: "MYgXS_zTfdo", mentor: "miner", title: "Never Say \"Just Following Up\" (Say This Instead)", why: "Better follow-up openers." },
      { id: "janQTa3ay5w", mentor: "miner", title: "How to Follow Up Without Being Annoying", why: "Follow-up that adds value." },
      { id: "AnstN0YZwLo", mentor: "gordon", title: "Prospects ghosting your follow up call? Watch this", why: "Handling prospects who go quiet." },
      { id: "WhoCzbnSKCY", mentor: "gordon", title: "How to RE-CLOSE someone when they tell you no", why: "Reopening a lost deal respectfully." },
      { id: "1hF1Eg8pGnM", mentor: "sandler", title: "The Art of Follow-Up: Why the First Answer Isn't Always the Best", why: "Sandler on purposeful follow-up." },
    ],
    quiz: [
      { q: "Which follow-up opener is best?", options: ["\"Just following up!\"", "\"Last time you said bids take 3 nights; is that still true?\"", "\"Did you get my email?\"", "\"Checking in\""], answer: 1, explain: "Reference their words and ask a real question (Miner)." },
      { q: "A prospect has gone quiet for two weeks. Best move?", options: ["Message daily", "Make it easy to reply, even with a no", "Give up silently", "Call their spouse"], answer: 1, explain: "Gordon: make a reply easy." },
      { q: "\"Close the sale or close the file\" means…", options: ["Never close files", "Get to a clear yes or no; don't let deals drift", "Delete leads", "Always discount"], answer: 1, explain: "Sandler rule for pipeline hygiene." },
      { q: "A lead asks you to stop contacting them. You…", options: ["Try once more next month", "Stop, and mark them Do Not Contact", "Switch to texting", "Ask a teammate to call"], answer: 1, explain: "Respect opt-outs every time. It's the law and our policy." },
    ],
  },
  {
    id: "mindset", title: "Mindset",
    goal: "Handle rejection, stay consistent, and sell from a place of service.",
    principles: [
      { mentor: "sandler", text: "Sell like you don't need the business. Neediness leaks into your voice and pushes people away." },
      { mentor: "hormozi", text: "Choose rejection over regret. A no costs you a minute; not asking costs you the deal." },
      { mentor: "miner", text: "Top performers detach from the outcome and focus on helping the prospect decide what's right for them." },
      { mentor: "gordon", text: "Fear of sales fades with reps. Rewire it by doing the work daily and reviewing calls." },
      { mentor: "sandler", text: "You don't have to like prospecting; you just have to do it." },
    ],
    tryIt: "Before your call block: \"My job is to find out if Built2Bid helps this contractor. Either answer is a win.\"",
    videos: [
      { id: "YWzSbGKpUmw", mentor: "sandler", title: "Sandler Rule #8: Sell Like You Don't Need The Business", why: "Why neediness hurts." },
      { id: "t3YXp4KVAwc", mentor: "hormozi", title: "Do You Want Rejection Or Regret?", why: "Reframing rejection." },
      { id: "M9ShVdOrQgs", mentor: "miner", title: "The Mindset Shift That Separates the Top 1% in Sales", why: "Detaching from the outcome." },
      { id: "wTHySDJtD4U", mentor: "gordon", title: "Sales Was Scary Until I Rewired My Brain", why: "Getting past fear of selling." },
      { id: "550nUorNRoM", mentor: "sandler", title: "Sandler Rule #7: You Don't Have to Like Prospecting", why: "Discipline over motivation." },
    ],
    quiz: [
      { q: "What does \"sell like you don't need the business\" protect against?", options: ["Low prices", "Neediness that pushes prospects away", "Taxes", "Long calls"], answer: 1, explain: "Sandler: detachment builds trust." },
      { q: "Rejection vs regret: which costs more?", options: ["Rejection", "Regret from not asking", "They're the same", "Neither"], answer: 1, explain: "Hormozi: a no is cheap; not asking is expensive." },
      { q: "What reduces fear of cold calling most?", options: ["Waiting until you feel ready", "Doing it daily and reviewing calls", "Reading more", "Only emailing"], answer: 1, explain: "Gordon: reps rewire fear." },
      { q: "A good definition of a successful call:", options: ["Only a sale", "A clear, honest answer either way", "Talking the longest", "Avoiding no"], answer: 1, explain: "Miner and Sandler: clarity is the win." },
    ],
  },
  {
    id: "product-rules", title: "Built2Bid product and selling rules",
    goal: "Know what Built2Bid does, what it costs, and the rules every rep follows.",
    principles: [
      { mentor: "hormozi", text: "Know the product cold: fast bids with trade calculators, e-signatures, scheduling, invoices and job financials, from $19.99 a month." },
      { mentor: "sandler", text: "Only promise what's true: no long-term contracts and export anytime. Paid subscription periods are non-refundable." },
      { mentor: "voss", text: "Honesty builds trust faster than hype. Never invent numbers, reviews or results." },
      { mentor: "gordon", text: "Follow the rules on every call: respect Do Not Call and opt-outs, call only during allowed hours, and never record without consent." },
    ],
    tryIt: "\"Straight answer: it's $19.99 a month or $199 a year, no long-term contract, and you can export all your data anytime.\"",
    videos: [],
    quiz: [
      { q: "Built2Bid's monthly plan starts at…", options: ["$9.99", "$19.99", "$49", "Free only"], answer: 1, explain: "$19.99/month or $199/year." },
      { q: "Which promise is allowed?", options: ["\"Full refund anytime\"", "\"No long-term contract, export anytime\"", "\"Guaranteed more jobs\"", "\"Cheapest on the market\""], answer: 1, explain: "Paid periods are non-refundable; never promise refunds or results." },
      { q: "A number is on the Do Not Call list. You…", options: ["Call once", "Don't call it", "Text instead", "Call after hours"], answer: 1, explain: "Do Not Call and opt-outs are always respected." },
      { q: "Can you record a call without telling the other person?", options: ["Yes", "No, never without consent", "Only in Minnesota", "Only if it's short"], answer: 1, explain: "Consent first, every time." },
    ],
  },
];

export const PASS_SCORE = 3; // of 4 per topic
export const topicById = (id: string) => TOPICS.find((t) => t.id === id) ?? null;

/** Grade answers on the server. Returns the score and which were right. */
export function gradeQuiz(topic: Topic, answers: (number | null)[]): { score: number; total: number; passed: boolean; correct: boolean[] } {
  const correct = topic.quiz.map((q, i) => answers[i] === q.answer);
  const score = correct.filter(Boolean).length;
  return { score, total: topic.quiz.length, passed: score >= Math.min(PASS_SCORE, topic.quiz.length), correct };
}

/** Certified to sell = every topic quiz passed. */
export const isCertified = (passed: string[]) => TOPICS.every((t) => passed.includes(t.id));
