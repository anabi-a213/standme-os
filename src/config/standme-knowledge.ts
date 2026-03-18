/**
 * StandMe Static Knowledge Base
 *
 * This is the core intelligence layer embedded into ALL agents.
 * It covers:
 *   - StandMe company identity, team, positioning
 *   - Exhibition industry mastery (stand types, costs, timelines, terminology)
 *   - Show-by-show profiles (venues, audiences, key intelligence)
 *   - Sales intelligence (DM patterns, HOT signals, objections, qualification)
 *   - Operational excellence (build process, critical path, common failures)
 *   - Pre-thinking patterns (what to do before being asked)
 *
 * This gets injected directly into the Brain system prompt AND seeded into
 * the Google Sheets KNOWLEDGE_BASE so all 17 agents benefit from it.
 */

// ──────────────────────────────────────────────────────────────
// COMPANY IDENTITY
// ──────────────────────────────────────────────────────────────

export const COMPANY = {
  name: 'StandMe',
  domain: 'standme.de',
  emails: {
    main: 'info@standme.de',
    mo: 'mohammed.anabi@standme.de',
  },
  tagline: 'Exhibition stand design & build — MENA & Europe',
  regions: ['MENA', 'Europe'],
  baseCountry: 'Germany',

  team: {
    Mo: {
      fullName: 'Mohammed Anabi',
      role: 'Owner / Admin',
      telegram: 'MO_TELEGRAM_ID',
      focus: [
        'Final sales decisions and deal approvals',
        'Key client relationships and negotiations',
        'Strategic direction and business development',
        'Agent approvals (outreach, briefs, content)',
        'New lead review and prioritisation',
      ],
    },
    Hadeer: {
      role: 'Operations Lead',
      focus: [
        'Project execution and timeline management',
        'Contractor coordination and booking',
        'Technical deadline tracking',
        'Client communication during build phase',
        'Post-show debriefs and lessons learned',
      ],
    },
    Bassel: {
      role: 'Sub-Admin',
      focus: [
        'Day-to-day operational support',
        'Data entry and sheet management',
        'Monitoring and reporting',
        'Supporting Mo and Hadeer',
      ],
    },
  },

  services: [
    'Custom exhibition stand design (concept → production drawings)',
    'Full stand build and installation at venue',
    'Stand dismantling, storage, and re-use',
    'Large format graphics, signage, and branding',
    'AV integration: LED walls, touchscreens, demo stations',
    'Furniture, flooring, and lighting solutions',
    'Meeting rooms and hospitality areas',
    'Turnkey project management: single point of contact',
    'Technical submission to show organisers',
    'Contractor and labour management on-site',
  ],

  differentiation: [
    'Full-service: design AND build under one roof — clients deal with one team',
    'MENA + Europe dual capability — same team, no confusion',
    'Show-specific expertise built from real project experience',
    'Arabic and European language capability (Arabic, French, German, English)',
    'Speed — leaner structure than large contractors means faster decisions',
    'Relationship-first sales — not chasing volume, chasing the right clients',
  ],

  positioning: `StandMe is a specialist exhibition stand design and build company.
We serve brands who take their exhibition presence seriously — they want a stand that
performs, not just looks good. We operate across MENA and Europe, handling everything
from the first sketch to the last screw. Clients come to us when they want one trusted
team, no middlemen, and real expertise in their specific show.`,

  idealClients: [
    'Pharma/medical companies exhibiting at Arab Health, MEDICA, or Interpack',
    'Food & beverage brands at Gulfood, SIAL, or Anuga',
    'Industrial tech companies at Hannover Messe or Interpack',
    'AV/tech brands at ISE',
    'Energy companies at Intersolar or SNEC',
    'International brands entering MENA for the first time',
    'MENA-based companies expanding to European shows',
    'Companies with 18sqm+ stands who value quality over cheapest price',
  ],
};

// ──────────────────────────────────────────────────────────────
// EXHIBITION INDUSTRY MASTERY
// ──────────────────────────────────────────────────────────────

export const INDUSTRY = {

  standTypes: {
    shellScheme: {
      name: 'Shell Scheme',
      description: 'Basic booth provided by organiser — walls, carpet, fascia. Bare minimum.',
      pros: 'Cheap, zero logistics',
      cons: 'Generic, no brand impact, everyone looks the same',
      bestFor: 'Very small budgets, first-time exhibitors testing the market',
      signal: 'If a prospect mentions shell scheme, they may be under-budgeted or new to exhibiting',
    },
    spaceOnly: {
      name: 'Space Only',
      description: 'Raw floor space — exhibitor builds everything from scratch',
      pros: 'Maximum creative freedom, real brand presence',
      cons: 'More complex, requires competent contractor',
      bestFor: 'Brands who take exhibitions seriously — where StandMe plays',
      signal: 'Space only = serious budget, ask for sqm and budget immediately',
    },
    modular: {
      name: 'Modular / System Build',
      description: 'Reusable aluminium system (Octanorm, Maxima etc.) with swappable graphics',
      pros: 'Reusable across shows, lower cost per use, fast build',
      cons: 'Less bespoke, recognisable system look',
      bestFor: 'Multi-show clients wanting consistency and cost efficiency',
    },
    custom: {
      name: 'Custom Build',
      description: 'Fully designed and built to spec — joinery, special finishes, unique form',
      pros: 'Maximum brand impact, no compromise on vision',
      cons: 'Higher cost, longer lead time, usually single-use or partial reuse',
      bestFor: 'Premium brands, launches, or high-value show appearances',
    },
    doubleDecker: {
      name: 'Double-Decker',
      description: 'Two-storey stand — ground floor exhibition + upper floor meetings/lounge',
      pros: 'Maximum presence, private meeting space, premium brand signal',
      cons: 'Complex engineering, requires structural approval, expensive',
      bestFor: 'Large stands 36sqm+, companies wanting VIP client entertaining',
      signal: 'If client mentions double-decker, budget is likely €100k+',
    },
  },

  sizeGuide: {
    small: { sqm: '9–18 sqm', type: 'Corner or inline', budget: '€10,000–€25,000', signal: 'Entry/test' },
    medium: { sqm: '18–36 sqm', type: 'Island or peninsula', budget: '€25,000–€60,000', signal: 'Serious exhibitor' },
    large: { sqm: '36–72 sqm', type: 'Island', budget: '€60,000–€120,000', signal: 'Major brand or regional HQ' },
    premium: { sqm: '72 sqm+', type: 'Island / DD', budget: '€120,000+', signal: 'Tier-1 brand, needs white-glove' },
  },

  budgetSignals: `
BUDGET READING FROM STAND SIZE:
- Prospect says "9-18 sqm" → €10k–25k range. Small project. Good for pipeline volume.
- Prospect says "18-36 sqm" → €25k–60k. Sweet spot for StandMe.
- Prospect says "36-72 sqm" → €60k–120k. High value. Prioritise.
- Prospect says "72sqm+" → €120k+. Major account. Mo should be involved from day one.
- If budget sounds too low for stated size → flag it. Don't take a project that will lose money.
- If no budget given → ask: "Are you working to a specific number, or should we advise on what's realistic for that size?"
`,

  buildProcess: `
EXHIBITION STAND BUILD PROCESS (full sequence):
1. BRIEF — client provides objectives, brand guidelines, stand size, show details, key requirements
2. CONCEPT — StandMe creates 2-3 concept directions with renders (1-2 weeks)
3. DESIGN APPROVAL — client selects concept, refinements made (1 week)
4. TECHNICAL DRAWINGS — full production drawings for build team (1 week)
5. ORGANISER SUBMISSION — technical drawings filed to show organiser for approval
6. PRODUCTION — fabrication, graphics print, AV procurement (3-6 weeks depending on complexity)
7. PRE-BUILD — optional test assembly at workshop for complex stands
8. LOGISTICS — transport to venue (trucking or air freight for international)
9. BUILD — on-site installation at venue (typically 1-5 days before show opens)
10. SHOW OPEN — support during show if needed
11. STRIP — dismantle and remove within venue deadline (usually 24-48h after show closes)
12. POST-SHOW — storage, lessons learned, debrief with client
`,

  timeline: `
PROJECT TIMELINES:
- Ideal: 5-6 months before show → full custom design, no rush premium
- Normal: 3-4 months before show → manageable, some design constraints
- Short: 6-8 weeks before show → modular or partial custom, rush charges likely
- Crisis: under 6 weeks → possible but high risk, need Mo approval, premium pricing
- Key rule: production typically needs 3-4 weeks minimum. Everything before that is design + approval.
`,

  organisersDeadlines: `
SHOW ORGANISER TECHNICAL DEADLINES (approximate — always verify per show):
- Portal/Registration: 3-4 months before show
- Stand design/layout approval: 6-10 weeks before show
- Rigging plan (if required): 6-8 weeks before show
- Electrical plan: 6-8 weeks before show
- Build start: 3-7 days before show opens (varies hugely by show)
- Strip deadline: 24-72 hours after show closes
- Missing these = fines, delays, or being unable to build
`,

  terminology: `
KEY EXHIBITION TERMINOLOGY:
- Fascia: Name board at top of shell scheme stand
- Drayage: Organiser's charge for moving materials from dock to stand (US shows mostly)
- Rigging: Hanging structures or graphics from ceiling — needs venue/organiser approval
- Shell scheme: Basic booth package from organiser
- Space only: Raw floor space, exhibitor supplies everything
- Build days: Days allocated before show opens for installation
- Strip days: Days allocated after show closes for dismantling
- Sqm / sq ft: Stand size measurement (Europe = sqm, US = sq ft)
- Inline: Stand with walls on two sides (corridor position)
- Corner: Stand open on two sides
- Peninsula: Three sides open
- Island: Fully open stand, all four sides visible
- Double-decker (DD): Two-storey stand
- Organiser contractor: Preferred/official contractor for the show — sometimes mandatory for certain services
`,

  keyRisks: `
COMMON PROJECT RISKS TO WATCH:
- Late brief: Every week of delay at the start removes a week from production
- Design changes after approval: Can cause deadline misses and cost increases
- Organiser deadline miss: Can result in fines or disqualification
- AV not specified early: Long lead times on LED walls, interactive systems
- Budget creep: Rigging, freight, and AV are the three main surprises
- Contractor availability: Book early for peak show season (Jan-Mar MENA, Apr-Jun Europe)
- Show organiser rule changes: Always re-check rules even for shows done before
`,
};

// ──────────────────────────────────────────────────────────────
// SHOW PROFILES (DETAILED)
// ──────────────────────────────────────────────────────────────

export const SHOW_PROFILES: Record<string, {
  name: string; city: string; country: string; venue: string;
  typicalMonth: string; industry: string; visitors: string;
  exhibitors: string; standmeNote: string; idealClients: string;
  deadlineNote: string;
}> = {
  arabHealth: {
    name: 'Arab Health',
    city: 'Dubai',
    country: 'UAE',
    venue: 'Dubai World Trade Centre (DWTC)',
    typicalMonth: 'January (last week)',
    industry: 'Healthcare, pharma, medical devices, hospital equipment',
    visitors: '~55,000 from 170+ countries',
    exhibitors: '3,500+',
    standmeNote: 'Biggest show in our MENA calendar. Heavily competitive for stand builders. Clients plan 4-6 months out. Pharma companies book early, device companies sometimes late.',
    idealClients: 'Pharma companies, medical device manufacturers, hospital equipment brands, diagnostic companies, healthtech startups scaling up',
    deadlineNote: 'DWTC portal opens ~September. Design submission typically November. Build start usually 22-24 January.',
  },
  gulfood: {
    name: 'Gulfood',
    city: 'Dubai',
    country: 'UAE',
    venue: 'Dubai World Trade Centre (DWTC)',
    typicalMonth: 'February',
    industry: 'Food & beverage, ingredients, packaging, hospitality',
    visitors: '~97,000',
    exhibitors: '5,000+',
    standmeNote: 'Largest food show in MENA. Often back-to-back with Arab Health for February pipeline. Clients need strong hospitality areas — product tasting, meeting rooms. Lots of repeat clients.',
    idealClients: 'Food brands (especially MENA/GCC regional), F&B importers/distributors, ingredient suppliers, restaurant chains, hospitality groups',
    deadlineNote: 'Similar DWTC timeline to Arab Health. Build start usually 19-21 February.',
  },
  hannoverMesse: {
    name: 'Hannover Messe',
    city: 'Hannover',
    country: 'Germany',
    venue: 'Hannover Exhibition Grounds (Deutsche Messe)',
    typicalMonth: 'April',
    industry: 'Industrial automation, energy, manufacturing, robotics, digital transformation',
    visitors: '~130,000',
    exhibitors: '4,000+',
    standmeNote: 'One of the world\'s largest trade fairs. Complex stands, high budgets, technical sophistication expected. Clients often want interactive demos. Lead time is critical — start 5-6 months out.',
    idealClients: 'Industrial automation companies, energy tech, manufacturing tech, robotics, IoT/Industry 4.0 companies, MENA industrial companies entering Europe',
    deadlineNote: 'Deutsche Messe requires early technical submission. Design approval often 8-10 weeks before. Build start typically 5-7 days before opening.',
  },
  interpack: {
    name: 'Interpack',
    city: 'Düsseldorf',
    country: 'Germany',
    venue: 'Messe Düsseldorf',
    typicalMonth: 'May (every 3 years)',
    industry: 'Packaging, processing, confectionery, pharmaceuticals',
    visitors: '~170,000',
    exhibitors: '2,800+',
    standmeNote: 'Massive triennial show. Premium packaging and processing brands. Stands are elaborate and engineering-heavy. Bookings happen 12-18 months in advance. Very competitive show for space.',
    idealClients: 'Packaging machine manufacturers, food processing equipment, pharma packaging, confectionery brands, printing and labelling companies',
    deadlineNote: 'Messe Düsseldorf has strict regulations. Rigging and electrics require early certification. Build period typically 5-7 days.',
  },
  medica: {
    name: 'MEDICA',
    city: 'Düsseldorf',
    country: 'Germany',
    venue: 'Messe Düsseldorf',
    typicalMonth: 'November',
    industry: 'Medical devices, diagnostics, digital health, hospital equipment',
    visitors: '~81,000',
    exhibitors: '5,500+',
    standmeNote: 'World\'s largest medical trade fair. End of year European run (MEDICA + Compamed). High-quality stands expected. Many Asian and US brands exhibiting in Europe for the first time.',
    idealClients: 'Medical device manufacturers, diagnostic equipment, healthtech, hospital/clinic suppliers, pharma — especially international brands using MEDICA as their European launch',
    deadlineNote: 'Messe Düsseldorf strict rules. Technical submission 6-8 weeks before. Build start 3-4 days before.',
  },
  ise: {
    name: 'ISE (Integrated Systems Europe)',
    city: 'Barcelona',
    country: 'Spain',
    venue: 'Fira de Barcelona',
    typicalMonth: 'February',
    industry: 'AV technology, smart buildings, digital signage, unified communications',
    visitors: '~90,000',
    exhibitors: '1,400+',
    standmeNote: 'Moved from Amsterdam to Barcelona. Very design-forward stands — lots of LED, interactive. AV companies expect a stand that shows off their own products. Content and demo experience is everything.',
    idealClients: 'AV manufacturers, digital signage companies, smart home/building tech, collaboration tech companies, system integrators',
    deadlineNote: 'Fira Barcelona requires early submission. January deadline for design approval. Build start early February.',
  },
  intersolarEurope: {
    name: 'Intersolar Europe',
    city: 'Munich',
    country: 'Germany',
    venue: 'Messe München',
    typicalMonth: 'June',
    industry: 'Solar energy, storage, energy management',
    visitors: '~90,000',
    exhibitors: '2,500+',
    standmeNote: 'Growing show as solar industry expands. Many Asian manufacturers exhibiting in Europe. Often combined with ees Europe (battery storage). Clean, tech-forward stand aesthetics.',
    idealClients: 'Solar panel manufacturers, inverter companies, energy storage, EV charging, energy management systems',
    deadlineNote: 'Messe München standard submission timelines. Build typically 2-3 days before.',
  },
  sialParis: {
    name: 'SIAL Paris',
    city: 'Paris',
    country: 'France',
    venue: 'Paris Nord Villepinte',
    typicalMonth: 'October (biennial — even years)',
    industry: 'Food & beverage, food innovation, retail food',
    visitors: '~265,000',
    exhibitors: '7,200+',
    standmeNote: 'One of the biggest food shows globally. Biennial. Heavy French and European food culture — aesthetics matter. Country pavilions common. Hospitality and tasting areas essential.',
    idealClients: 'Food brands targeting European retail/distribution, food ingredient companies, MENA food producers expanding to France/Europe',
    deadlineNote: 'Paris Nord Villepinte specific rules. Strong French organiser requirements on fire safety, materials.',
  },
};

// ──────────────────────────────────────────────────────────────
// SALES INTELLIGENCE
// ──────────────────────────────────────────────────────────────

export const SALES_INTEL = {

  hotSignals: `
HOT LEAD SIGNALS (act fast, Mo should know within 24h):
✓ Budget confirmed or clearly implied (e.g. "similar to last year" or states a range)
✓ Decision maker directly in touch (not going through a procurement layer)
✓ Show is 2-5 months away — urgency is real
✓ Stand size 20sqm+ — serious investment, real budget
✓ Previous exhibition experience — they know what they're buying
✓ Competitor left them — opportunity to steal
✓ International brand new to MENA/Europe — needs trusted local partner
✓ Responds quickly and asks specific questions
`,

  warmSignals: `
WARM LEAD SIGNALS (nurture, 2-3 week follow-up cycle):
~ Show is 6-12 months away — planning mode
~ Budget is "being finalised" or "in discussion"
~ Marketing manager involved but DM is above them
~ Has exhibited before but with different contractor
~ Asking general questions about process rather than specific requests
`,

  coldSignals: `
COLD / DISQUALIFY SIGNALS:
✗ Show is 12+ months away AND no urgency signals
✗ Budget clearly too low for stated stand size (e.g. €5k for 30sqm)
✗ No DM access and procurement-only contact
✗ "Just getting quotes" with no intent signals
✗ Competitor-locked (has exclusivity or pre-agreed deal)
✗ Shell scheme — below StandMe's service level
`,

  decisionMakers: `
DECISION MAKER PATTERNS BY INDUSTRY:
- Pharma/Medical: Marketing Director or Exhibition Manager. Budget owner is usually Marketing Director or VP Marketing.
- Food & Beverage: Brand Manager, Marketing Manager, or Head of Trade Marketing.
- Industrial/B2B tech: Marketing Manager or Head of Events. Sometimes the COO at smaller firms.
- AV/Tech: Marketing Director or Product Marketing Manager.
- Energy: Marketing Director or Sustainability/Communications lead.
- Small/family businesses: CEO or Managing Director decides everything.
- Large multinationals: Marketing approves concept, procurement negotiates price. Engage marketing first.

KEY RULE: Always find the person who is judged on the stand's success, not the person who processes the PO.
`,

  qualificationQuestions: `
STANDME QUALIFICATION FRAMEWORK (BANT + Exhibition-specific):
B — Budget: "Are you working to a budget, or would you like us to advise on typical investment for that size?"
A — Authority: "Who will be the main decision maker on the project?" / "Are you the right person to progress this with?"
N — Need: "Have you exhibited at [show] before?" / "What are the main objectives for the stand?"
T — Timeline: "When is the show?" / "When do you need the design concept by?"

EXTRA exhibition-specific questions:
- "What size stand are you looking at?" (Drives budget signal)
- "Is it space only or shell scheme?" (Drives commitment signal)
- "How many staff will be on the stand?" (Drives layout and meeting room needs)
- "Do you have brand guidelines we should follow?"
- "Are there any must-have elements — demo stations, meeting room, storage?"
`,

  objectionHandling: `
COMMON OBJECTIONS AND HOW STANDME HANDLES THEM:

"We already have a supplier."
→ "Understood. Are you happy with them? We find clients often come to us after disappointment with a contractor who couldn't handle both regions or both design and build. Happy to stay in touch in case anything changes."

"Your price is too high."
→ "Let us understand what you're comparing against. If it's shell scheme, we're comparing apples and oranges. If it's another custom builder, let's look at what's included — we don't have hidden extras."

"We don't have budget confirmed yet."
→ "No problem. Let's have a concept conversation now so when budget is approved, we're ready to move fast. Shows fill up quickly."

"It's too early to decide."
→ "For [show name] in [month], we'd ideally start design in [month]. The risk of waiting is production time gets squeezed and you lose design options. We can start with a non-committal brief."

"We design it ourselves / have an agency."
→ "Great — we work with agencies all the time. We can take their designs and handle full production and on-site build. Some of our best projects are agency designs that we bring to life."
`,

  pricingGuide: `
STANDME PRICING SIGNALS (internal — not for client):
- Never quote a price without knowing: size, show, complexity level, timeline, AV requirements
- Per-sqm rough guide (custom build, Europe): €800-1,200 basic, €1,200-1,800 mid, €1,800-3,000+ premium
- Add-ons that significantly increase budget: double-decker (+30-50%), heavy AV (+20-40%), rigging (+10-20%), rush (<8 weeks +15-25%)
- MENA shows (DWTC) tend to be 10-20% less than equivalent European show due to local labour costs
- Always build in Mo's approval before confirming any price to client
`,
};

// ──────────────────────────────────────────────────────────────
// OPERATIONAL INTELLIGENCE
// ──────────────────────────────────────────────────────────────

export const OPS_INTEL = {

  contractorTypes: `
CONTRACTOR TYPES STANDME USES:
- Stand builders: Main contractors who handle carpentry, joinery, structure
- AV technicians: LED wall install, screen mounting, cabling
- Electricians: Power distribution, lighting rigs — must be organiser-approved at many venues
- Riggers: Specialist for hanging structures — requires certification, venue approval
- Graphic installers: Large format print application to stands
- Forklift/drayage: Heavy item movement on-site — often venue controlled
- Interpreters: On-site support for shows in non-English markets
`,

  criticalPath: `
PROJECT CRITICAL PATH:
1. Signed contract / deposit → project starts
2. Brief confirmed → design begins (do not start design without written brief)
3. Concept approved → technical drawings begin
4. Technical drawings approved → organiser submission
5. Organiser approval → production starts (NO production without organiser approval)
6. Production complete → graphics ordered (check lead time: 7-10 days for large format)
7. Logistics booked → truck/air freight confirmed
8. On-site build → follow-up daily with Hadeer
9. Show opens → client contact confirmed
10. Show closes → strip within venue deadline

RULE: Each step cannot begin without the previous step signed off. Delays compound.
`,

  lessonsPatterns: `
WHAT COMMONLY GOES WRONG (patterns from past projects):
- Client changes design AFTER organiser submission → emergency re-submission, risk of fine
- AV not specified in brief → client adds it late, budget and timeline blow up
- Freight delayed at customs for international shows → always allow extra day, have contingency
- Client sends wrong brand files (low res, wrong colours) → always ask for brand guidelines on day one
- Stand size changes after design starts → common, always include size confirmation in contract
- Contractor no-show → always have backup contractor for critical skills (electrical especially)
- Post-show storage not arranged → costs client storage fees, handle proactively
`,

  clientExperience: `
WHAT MAKES CLIENTS COME BACK:
1. No surprises — they knew the budget, the timeline, and what they were getting
2. One point of contact throughout — they didn't have to chase anyone
3. The stand looked exactly like the render (or better)
4. Build was on time — they didn't arrive to an unfinished stand
5. Problems were solved before they knew there was a problem
6. Post-show debrief and storage handled without being asked

WHAT LOSES CLIENTS:
1. Budget overrun without warning
2. Design changes not communicated or charged unexpectedly
3. Stand not ready when show opened
4. Had to manage contractors themselves on-site
5. Post-show chaos (leftover materials, no storage plan)
`,
};

// ──────────────────────────────────────────────────────────────
// PRE-THINKING PATTERNS (for Brain agent)
// ──────────────────────────────────────────────────────────────

export const PRE_THINKING = `
PROACTIVE INTELLIGENCE — what to notice and say before being asked:

WHEN reviewing leads:
→ If a lead score is 7+ and no brief has been generated → suggest /brief
→ If show is <90 days away and lead is still in "Qualifying" → flag urgency to Mo
→ If a lead has no DM info and readiness <7 → suggest /enrich before outreach

WHEN reviewing pipeline:
→ If a card has been in the same stage for 14+ days → flag as stuck, suggest action
→ If "Negotiation" stage has cards → ask Mo if any need a push
→ If "Concept Brief" stage has multiple cards → check if briefs are generated

WHEN reviewing deadlines:
→ If a show is <30 days away and build start hasn't been logged → escalate immediately
→ If organiser portal deadline is <2 weeks → remind team, check submission status
→ If multiple shows overlap → flag contractor availability risk

WHEN processing a new lead:
→ Check if the show is in VERIFIED_SHOWS — if not, research before proceeding
→ Check if the company already exists in the pipeline (duplicate check)
→ Consider what the DM title would be based on their industry
→ Think about whether this is a first-time exhibitor or experienced — changes the approach

WHEN asked a question that touches another agent:
→ Don't just answer the question — think about what the next step should be
→ E.g. "how's the Pharma Corp pipeline?" → answer PLUS suggest: "Do you want me to move them or generate their brief?"
`;

// ──────────────────────────────────────────────────────────────
// COMBINED CONTEXT STRING (for direct injection into prompts)
// ──────────────────────────────────────────────────────────────

/**
 * Returns a compact but information-dense context string for injection
 * into any agent's system prompt or AI call.
 * Use `full=true` for Brain agent, `full=false` for other agents.
 */
export function getStaticKnowledge(full = false): string {
  const core = `
=== STANDME COMPANY KNOWLEDGE ===
Company: StandMe — exhibition stand design & build, MENA & Europe
Base: Germany (standme.de) | Email: info@standme.de
Team: Mo (owner/admin, sales & approvals), Hadeer (ops lead, execution), Bassel (sub-admin, support)
Services: Custom stand design, full build & installation, graphics, AV, furniture, project management
Sweet spot: Space-only stands, 18-72sqm, custom builds, shows in MENA (Arab Health, Gulfood) and Europe (Hannover Messe, Interpack, MEDICA, ISE, Intersolar, SIAL)
Ideal client: Serious brand, 18sqm+, confirmed budget, show within 6 months, wants full-service partner

=== EXHIBITION INDUSTRY KNOWLEDGE ===
Stand types: Shell scheme (organiser box, avoid), Space only (our world), Modular (reusable), Custom build (premium), Double-decker (72sqm+, €100k+)
Budget guide: 9-18sqm = €10-25k | 18-36sqm = €25-60k | 36-72sqm = €60-120k | 72sqm+ = €120k+
Build timeline: Brief → Concept (1-2w) → Approval → Technical drawings (1w) → Production (3-6w) → Logistics → Build → Show → Strip
Timeline risk zones: <8 weeks = rush premium | <4 weeks = crisis, needs Mo approval
Key DM titles: Marketing Director, Brand Manager, Head of Events, Marketing Manager, Exhibition Manager
`;

  if (!full) return core;

  return core + `
=== SALES INTELLIGENCE ===
HOT signals: confirmed budget, DM direct contact, show 2-5 months, 20sqm+, previous exhibitor, competitor left them
WARM signals: 6-12 months to show, budget in progress, marketing manager contact (not final DM)
COLD/DQ: 12+ months, budget too low for size, procurement-only, shell scheme only, just-getting-quotes
BANT+: Budget → Authority → Need (objectives, past experience) → Timeline → Stand size → Staff count → Must-haves
Common objections: "have a supplier" / "too expensive" / "budget not confirmed" / "too early" / "we have our own design"
Smart response to "we have a supplier": "Are you happy with them? We often hear from brands after disappointment at their first MENA/Europe show."

=== SHOW CALENDAR (key) ===
January: Arab Health (Dubai, DWTC) — healthcare/pharma/medical
February: Gulfood (Dubai, DWTC) — food/beverage | ISE (Barcelona) — AV/tech
April: Hannover Messe (Hannover) — industrial/automation
May: Interpack (Düsseldorf, triennial) — packaging/pharma
June: Intersolar Europe (Munich) — solar/energy
October: SIAL Paris (biennial, even years) — food/beverage
November: MEDICA (Düsseldorf) — medical devices/healthtech

=== OPERATIONAL PATTERNS ===
Critical path: Signed contract → Brief confirmed → Concept approved → Technical drawings → Organiser approval → Production → Logistics → Build
Never start production without organiser approval. Never start design without confirmed brief.
Biggest budget surprises: AV additions, rigging, freight/customs, last-minute design changes
What clients remember: No surprises, one point of contact, stand looked like the render, build was on time

=== PRE-THINKING TRIGGERS ===
Lead score 7+ with no brief → suggest /brief
Show <90 days + lead in Qualifying → flag urgency
Card stuck in same stage 14+ days → flag + suggest action
Organiser portal deadline <2 weeks → remind + check
Multiple shows overlapping → contractor availability risk
New lead mentions show → check VERIFIED_SHOWS + check for duplicates in pipeline
`;
}

// ──────────────────────────────────────────────────────────────
// SEED DATA for Google Sheets KNOWLEDGE_BASE
// ──────────────────────────────────────────────────────────────

export interface SeedEntry {
  source: string;
  sourceType: string;
  topic: string;
  tags: string;
  content: string;
}

export const KNOWLEDGE_SEED: SeedEntry[] = [
  // ─── COMPANY ───
  {
    source: 'StandMe Company Profile',
    sourceType: 'manual',
    topic: 'company',
    tags: 'standme, identity, positioning, services, team',
    content: 'StandMe is a full-service exhibition stand design & build company operating across MENA and Europe. Services: custom stand design, build, installation, graphics, AV, furniture, project management. Base: Germany (standme.de). Team: Mo (owner), Hadeer (ops), Bassel (sub-admin).',
  },
  {
    source: 'StandMe Differentiation',
    sourceType: 'manual',
    topic: 'company',
    tags: 'differentiation, value proposition, positioning, competitive advantage',
    content: 'StandMe differentiators: (1) Full-service design AND build — one team, no middlemen. (2) MENA + Europe dual capability. (3) Show-specific expertise. (4) Arabic and European languages. (5) Speed — leaner than large contractors. (6) Relationship-first sales approach.',
  },
  {
    source: 'StandMe Target Clients',
    sourceType: 'manual',
    topic: 'company',
    tags: 'target clients, ideal customer, ICP, industries, pharma, food, industrial, AV',
    content: 'Ideal StandMe client: space-only stand 18sqm+, confirmed budget, show within 6 months, wants full-service partner. Top industries: pharma/medical (Arab Health, MEDICA), food/beverage (Gulfood, SIAL), industrial (Hannover Messe, Interpack), AV/tech (ISE), energy (Intersolar). International brands entering MENA or MENA brands going to Europe.',
  },
  {
    source: 'StandMe Team Roles',
    sourceType: 'manual',
    topic: 'company',
    tags: 'team, Mo, Hadeer, Bassel, roles, responsibilities',
    content: 'Mo (Mohammed Anabi): owner/admin — final sales decisions, key client relationships, agent approvals, strategic direction. Hadeer: ops lead — project execution, contractor coordination, timeline, technical deadlines. Bassel: sub-admin — day-to-day support, data management, reporting.',
  },
  // ─── INDUSTRY ───
  {
    source: 'Exhibition Stand Types Guide',
    sourceType: 'manual',
    topic: 'industry',
    tags: 'stand types, shell scheme, space only, modular, custom, double-decker',
    content: 'Stand types: Shell scheme = organiser basic box (avoid, below StandMe level). Space only = raw floor, we build everything (our market). Modular = reusable aluminium system, good for multi-show. Custom build = fully bespoke, maximum impact. Double-decker = 2 floors, premium (36sqm+, €100k+).',
  },
  {
    source: 'Stand Size and Budget Guide',
    sourceType: 'manual',
    topic: 'industry',
    tags: 'budget, size, sqm, pricing, investment, cost',
    content: 'Budget guide by size: 9-18sqm → €10-25k (entry). 18-36sqm → €25-60k (sweet spot). 36-72sqm → €60-120k (major brand). 72sqm+ → €120k+ (tier-1, Mo direct). Per sqm: €800-1,200 basic, €1,200-1,800 mid, €1,800-3,000+ premium. Add-ons: double-decker +30-50%, heavy AV +20-40%, rush (<8wks) +15-25%.',
  },
  {
    source: 'Exhibition Build Process',
    sourceType: 'manual',
    topic: 'industry',
    tags: 'build process, timeline, production, design approval, brief, concept',
    content: 'Build sequence: Brief → Concept design (1-2wk) → Design approval → Technical drawings (1wk) → Organiser submission → Production (3-6wk) → Logistics → On-site build (1-5 days) → Show → Strip. Total minimum from brief to show: 8-10 weeks. Ideal: 5-6 months. Rush under 6 weeks = premium + risk.',
  },
  {
    source: 'Exhibition Project Timelines',
    sourceType: 'manual',
    topic: 'industry',
    tags: 'timeline, planning, lead time, rush, urgency, months',
    content: 'Timeline guide: 5-6 months before show = ideal, full options. 3-4 months = normal, manageable. 6-8 weeks = short, modular/partial custom, rush charges. Under 6 weeks = crisis level, needs Mo approval, premium pricing. Key: production needs 3-4 weeks minimum regardless.',
  },
  {
    source: 'Exhibition Key Terminology',
    sourceType: 'manual',
    topic: 'industry',
    tags: 'terminology, glossary, rigging, drayage, shell scheme, fascia, island, double-decker',
    content: 'Exhibition terms: Fascia=name board on shell scheme. Drayage=organiser charge for moving items. Rigging=hanging from ceiling, needs approval. Shell scheme=basic organiser booth. Space only=bare floor. Inline=2 walls. Corner=2 sides open. Peninsula=3 sides. Island=4 sides open. Strip days=dismantling period after show.',
  },
  {
    source: 'Organiser Technical Deadlines',
    sourceType: 'manual',
    topic: 'industry',
    tags: 'deadlines, organiser, portal, rigging plan, electrical, design approval, submission',
    content: 'Typical organiser deadlines (verify per show): Portal registration 3-4 months before. Stand design/layout approval 6-10 weeks before. Rigging plan 6-8 weeks. Electrical plan 6-8 weeks. Build start 3-7 days before opening. Strip 24-72h after close. Missing = fines or inability to build.',
  },
  // ─── SHOWS ───
  {
    source: 'Arab Health Show Profile',
    sourceType: 'manual',
    topic: 'show',
    tags: 'arab health, dubai, DWTC, healthcare, pharma, medical, january, MENA',
    content: 'Arab Health: January, Dubai World Trade Centre. 55,000+ visitors, 3,500+ exhibitors. Healthcare/pharma/medical devices. Largest medical show in MENA. Key for StandMe — plan 4-6 months out. Portal opens September. Design submission November. Build start ~22-24 January.',
  },
  {
    source: 'Gulfood Show Profile',
    sourceType: 'manual',
    topic: 'show',
    tags: 'gulfood, dubai, DWTC, food, beverage, february, MENA, hospitality',
    content: 'Gulfood: February, Dubai World Trade Centre. 97,000+ visitors, 5,000+ exhibitors. Food & beverage, ingredients, packaging. Largest food show in MENA. Clients need hospitality/tasting areas. Often back-to-back with Arab Health in February pipeline. Build start ~19-21 February.',
  },
  {
    source: 'Hannover Messe Show Profile',
    sourceType: 'manual',
    topic: 'show',
    tags: 'hannover messe, germany, hannover, industrial, automation, energy, april, europe',
    content: 'Hannover Messe: April, Hannover. 130,000+ visitors, 4,000+ exhibitors. Industrial automation, energy, manufacturing, robotics. One of world largest trade fairs. Complex stands, high budgets, interactive demos expected. Start 5-6 months out. Technical submission 8-10 weeks before. Build start 5-7 days before.',
  },
  {
    source: 'Interpack Show Profile',
    sourceType: 'manual',
    topic: 'show',
    tags: 'interpack, düsseldorf, packaging, pharmaceutical, may, triennial, europe',
    content: 'Interpack: May, Düsseldorf (triennial — every 3 years). 170,000 visitors, 2,800+ exhibitors. Packaging, processing, pharma packaging, confectionery. Premium elaborate stands. Bookings 12-18 months in advance. Very competitive for stand space. Messe Düsseldorf strict regulations.',
  },
  {
    source: 'MEDICA Show Profile',
    sourceType: 'manual',
    topic: 'show',
    tags: 'medica, düsseldorf, medical, devices, healthtech, november, europe',
    content: 'MEDICA: November, Düsseldorf. 81,000 visitors, 5,500+ exhibitors. Medical devices, diagnostics, digital health, hospital equipment. World largest medical trade fair. Many Asian/US brands doing European launch here. Combined with Compamed. Build start 3-4 days before show.',
  },
  {
    source: 'ISE Show Profile',
    sourceType: 'manual',
    topic: 'show',
    tags: 'ISE, barcelona, AV, technology, smart buildings, february, europe',
    content: 'ISE (Integrated Systems Europe): February, Barcelona (Fira de Barcelona). 90,000+ visitors. AV technology, smart buildings, digital signage, unified comms. Very design-forward — lots of LED, interactive. AV companies want stand to show off their own products. Demo experience is everything.',
  },
  {
    source: 'Intersolar Europe Show Profile',
    sourceType: 'manual',
    topic: 'show',
    tags: 'intersolar, munich, solar, energy, storage, june, europe',
    content: 'Intersolar Europe: June, Munich (Messe München). 90,000+ visitors, 2,500+ exhibitors. Solar energy, storage, energy management, EV charging. Growing show. Many Asian manufacturers exhibiting in Europe. Often combined with ees Europe (battery storage). Clean, tech-forward aesthetics.',
  },
  {
    source: 'SIAL Paris Show Profile',
    sourceType: 'manual',
    topic: 'show',
    tags: 'SIAL, paris, food, beverage, october, biennial, france, europe',
    content: 'SIAL Paris: October, Paris Nord Villepinte (biennial — even years). 265,000+ visitors, 7,200+ exhibitors. Food & beverage, food innovation, retail food. One of biggest food shows globally. French aesthetics matter. Country pavilions common. Hospitality and tasting essential. Strong fire safety requirements.',
  },
  // ─── SALES ───
  {
    source: 'StandMe Lead Qualification Framework',
    sourceType: 'manual',
    topic: 'sales',
    tags: 'qualification, BANT, hot, warm, cold, decision maker, budget, timeline',
    content: 'Qualify with BANT+: Budget (stated or implied?), Authority (are they the DM?), Need (objectives, past exhibiting?), Timeline (show date, start date), Size (drives budget signal), Staff count (layout), Must-haves (AV, meeting room, demo). HOT = confirmed budget + DM direct + show 2-5 months + 20sqm+. WARM = 6-12 months, budget in discussion. COLD = 12+ months or budget too low.',
  },
  {
    source: 'Decision Maker Patterns by Industry',
    sourceType: 'manual',
    topic: 'sales',
    tags: 'decision maker, DM, title, industry, pharma, food, industrial, AV, marketing director',
    content: 'DM by industry: Pharma/Medical = Marketing Director or Exhibition Manager. Food/Bev = Brand Manager or Head of Trade Marketing. Industrial B2B = Marketing Manager or Head of Events (COO for small firms). AV/Tech = Marketing Director or Product Marketing. Energy = Marketing Director. Large corps = marketing approves, procurement negotiates price. Find the person judged on the stand success.',
  },
  {
    source: 'StandMe Objection Handling',
    sourceType: 'manual',
    topic: 'sales',
    tags: 'objections, supplier, price, budget, too early, agency, handling',
    content: 'Key objections: "Have a supplier" → "Happy with them? We often hear from brands after MENA/Europe disappointment." "Too expensive" → "Let\'s compare what\'s included — no hidden extras." "Budget not confirmed" → "Start concept now so we\'re ready when approved — shows fill fast." "Too early" → "For [show] in [month], design needs to start [date] to make production." "Have agency" → "We work with agencies — we take their design and build it."',
  },
  {
    source: 'Stand Size to Budget Conversion',
    sourceType: 'manual',
    topic: 'sales',
    tags: 'size, sqm, budget, pricing, conversion, estimate',
    content: 'Size to budget quick read: 9-18sqm = €10-25k. 18-36sqm = €25-60k (StandMe sweet spot). 36-72sqm = €60-120k (high value, prioritise). 72sqm+ = €120k+ (Mo direct). If prospect states size and budget feels too low → flag gently. If no budget given → "Are you working to a number, or should we advise what\'s realistic for that size?"',
  },
  // ─── OPERATIONS ───
  {
    source: 'Project Critical Path',
    sourceType: 'manual',
    topic: 'project',
    tags: 'critical path, project management, steps, order, sequence, approval',
    content: 'Critical path: (1) Signed contract + deposit → project starts. (2) Written brief confirmed → design begins. (3) Concept approved → technical drawings. (4) Technical drawings approved → organiser submission. (5) Organiser approval → production starts. (6) Production complete → graphics ordered (7-10 days lead). (7) Logistics booked. (8) On-site build. Rule: Each step requires previous step signed off.',
  },
  {
    source: 'Common Project Failure Patterns',
    sourceType: 'manual',
    topic: 'project',
    tags: 'risks, failures, warnings, AV, design change, customs, brand files, size change',
    content: 'Common failures: (1) Design change after organiser submission → emergency re-submission, fine risk. (2) AV added late → budget and timeline blow up. (3) Freight delayed at customs → always allow extra day buffer. (4) Wrong/low-res brand files received → get brand guidelines day one. (5) Stand size changes after design starts → confirm size in contract. (6) Contractor no-show → always have backup especially for electrical.',
  },
  {
    source: 'Client Retention Patterns',
    sourceType: 'manual',
    topic: 'project',
    tags: 'client experience, retention, repeat business, what works, satisfaction',
    content: 'Clients come back when: (1) No surprises on budget or timeline. (2) One contact throughout — no chasing. (3) Stand matched the render (or better). (4) Build was on time. (5) Problems solved before client knew. (6) Post-show debrief + storage handled proactively. Clients leave when: budget overrun without warning, stand not ready at opening, had to manage contractors themselves.',
  },
  {
    source: 'Contractor Types and When to Use',
    sourceType: 'manual',
    topic: 'contractor',
    tags: 'contractors, types, builders, AV, electricians, riggers, graphics, specialists',
    content: 'Contractor types: Stand builders (carpentry, joinery, structure — main contractor role). AV technicians (LED walls, screens, cabling). Electricians (power distribution, lighting — often must be organiser-approved). Riggers (certified, venue approval required for ceiling work). Graphic installers (large format print application). Always book early for peak season: Jan-Mar MENA, Apr-Jun Europe.',
  },
];
