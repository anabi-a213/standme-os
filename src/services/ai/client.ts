import Anthropic from '@anthropic-ai/sdk';
import { retry } from '../../utils/retry';

let _client: Anthropic | null = null;

function getAIClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

export async function generateText(prompt: string, systemPrompt?: string, maxTokens = 2000, timeoutMs = 30000): Promise<string> {
  return retry(async () => {
    const response = await getAIClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: 'user', content: prompt }],
    }, { timeout: timeoutMs });

    const block = response.content[0];
    return block.type === 'text' ? block.text : '';
  }, 'generateText');
}

/**
 * Multi-turn conversation with proper message history.
 * Use this instead of generateText when you have a real conversation to continue.
 * The last message in the array must have role 'user'.
 */
export async function generateChat(
  messages: { role: 'user' | 'assistant'; content: string }[],
  systemPrompt?: string,
  maxTokens = 2000
): Promise<string> {
  return retry(async () => {
    const response = await getAIClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages,
    }, { timeout: 30000 });

    const block = response.content[0];
    return block.type === 'text' ? block.text : '';
  }, 'generateChat');
}

export async function classifyIntent(message: string): Promise<string> {
  const intents = [
    'status_check', 'lead_query', 'project_query', 'deadline_query',
    'contractor_query', 'file_search', 'outreach_query', 'lessons_query',
    'show_validation', 'approval_action', 'rejection_action', 'marketing_request',
    'analytics_request', 'reconciliation', 'team_management', 'content_request',
    'drive_search', 'cross_board_check', 'general_query',
  ];

  const result = await generateText(
    `Classify this message into exactly one intent category.\n\nMessage: "${message}"\n\nCategories: ${intents.join(', ')}\n\nRespond with ONLY the category name, nothing else.`,
    'You are an intent classifier for a business operating system. Respond with only the category name.',
    50
  );

  const cleaned = result.trim().toLowerCase();
  return intents.includes(cleaned) ? cleaned : 'general_query';
}

export async function detectLanguage(text: string): Promise<'ar' | 'en' | 'franco'> {
  const arabicRegex = /[\u0600-\u06FF]/;
  const francoRegex = /[23456789]+[a-zA-Z]+|[a-zA-Z]+[23456789]+/;

  if (arabicRegex.test(text)) return 'ar';
  if (francoRegex.test(text)) return 'franco';
  return 'en';
}

// Stand type spatial constraints for renders-ready briefs
const STAND_TYPE_CONSTRAINTS: Record<string, string> = {
  'island':      'ISLAND stand (4 open sides): maximum visibility from all aisles. Prioritise central focal point, equal brand presence on all 4 faces, and clear traffic flow through the stand.',
  'peninsula':   'PENINSULA stand (3 open sides): strong front + 2 side faces. Back wall anchors the space. Traffic enters from 3 directions — design to capture all.',
  'inline':      'INLINE stand (1 open side): one aisle face, back and side walls. Depth is your tool — draw visitors in. Use depth zones: front (visible), middle (engage), back (close).',
  'corner':      'CORNER stand (2 open sides at 90°): two aisle faces. Corner position = higher traffic. Anchor the corner, give both faces equal weight.',
};

export async function generateBrief(context: {
  clientName: string;
  showName: string;
  showCity: string;
  standSize: string;
  budget: string;
  industry: string;
  tier?: 1 | 2 | 3;
  standType?: string;
  openSides?: string;
  mainGoal?: string;
  staffCount?: string;
  mustHaveElements?: string;
  brandColours?: string;
  previousExperience?: string;
  brandGuidelines?: string;
  lessonsLearned?: string;
}): Promise<string> {
  const tier = context.tier || 2;
  const standConstraint = context.standType
    ? STAND_TYPE_CONSTRAINTS[context.standType.toLowerCase()] || ''
    : '';

  // Tier 1: basic single-concept brief with explicit assumptions
  const assumptionsBlock = tier === 1
    ? `\nASSUMPTIONS (not confirmed by client — flag each one):
- Stand size: ASSUMED ~36 sqm (typical for this industry at this show)
- Budget: ASSUMED mid-range (confirm before proceeding)
- Stand type: ASSUMED inline or corner
Mark each assumption clearly in the brief with [ASSUMED].`
    : '';

  const conceptsToWrite = tier === 1 ? 1 : 2;

  // Exhibition stand anatomy reference — injected into every concept instruction
  // so Claude writes stand specs, not interior design or marketing copy.
  const standAnatomyGuide = `
EXHIBITION STAND ANATOMY — write every concept using these building blocks:

STRUCTURE & FLOOR PLAN
- Floor: raised platform (50–100mm MDF deck) or flat with vinyl/carpet
- Walls: back wall, side walls (for corner/inline/peninsula), open aisle faces
- Overhead: fascia header sign, suspended truss, fabric canopy (if venue allows rigging), or none
- Ceiling: only fabric canopy or branded truss — never a solid ceiling

ZONES (assign each sqm a purpose)
- Reception / welcome counter: first touch-point from the main aisle
- Product / service display area: shelving, plinths, demo screens, product stands
- Meeting / consultation area: enclosed or semi-open pod, 2–4 seat table
- Brand hero wall: largest graphic surface, dominant brand colour + logo
- Optional: demo station, bar/sampling counter, storage room

MATERIALS (name real ones — never write "premium" or "high-quality")
  Walls: tension fabric with dye-sublimation print, MDF with vinyl wrap, timber slat cladding,
         laminate panels, painted MDF, LED lightbox panels
  Floors: laminate on raised platform, vinyl with print, carpet tile, polished concrete effect
  Structure: powder-coated aluminium extrusion, timber frame, steel tube
  Furniture: reception counter (backlit or solid), bar stools, meeting chairs, display plinths
  Lighting: LED spotlights on track, LED strip behind frosted acrylic, LED lightbox headers,
            pendant lights over sampling bars, uplighting on back wall

VISITOR JOURNEY
Describe the stand from the visitor's perspective walking past the main aisle:
1. Approach (10m away): what catches their eye — header sign, hero graphic, lighting
2. Stop (3m): what makes them pause — product, person, activity, open invitation
3. Enter: what draws them in — counter position, open floor plan, demo activity
4. Stay: meeting pod, product interaction, sampling, consultation`;

  const conceptsInstruction = tier === 1
    ? `${standAnatomyGuide}

## Design Concept A: [Give it a descriptive name, e.g. "The Open Forum" or "Brand Fortress"]
Write a single buildable exhibition stand concept using the anatomy guide above.
Cover: floor plan zones, back wall treatment, flooring, overhead (if any), reception counter,
key display element, meeting solution, lighting, hero graphic.
Mark any assumptions with [ASSUMED]. Note what changes once size/budget are confirmed.`
    : `${standAnatomyGuide}

## Design Concept A: The Refined Direction — [Give it a descriptive name]
A clean, confident exhibition stand. Write as a stand designer briefing the build team.
Cover all anatomy elements:
- Floor plan: how the ${context.standSize || '[size]'} sqm is divided into zones
- Back wall / hero graphic: material, colour, graphic treatment
- Flooring: material and finish
- Overhead: fascia, truss, or none — and why
- Reception: counter position, material, backlit or solid
- Display: how the product/service is shown (plinths, shelves, screens)
- Meeting: enclosed pod or open meeting corner, capacity
- Lighting: track spots, LED strips, lightbox, pendant — where and why
- One signature detail that makes this stand memorable at this show

## Design Concept B: The Bold Direction — [Give it a descriptive name]
Same footprint and budget. Meaningfully different design language — not just a colour swap.
Use the same anatomy structure. The difference must be in the spatial logic or the hero element:
choose ONE bold move (full-height LED video wall, dramatic truss with suspended canopy,
bold colour-block geometry on all wall faces, or a product activation as the central
architectural feature). Every other element must still be 100% buildable and budgeted.`;

  const freepikPrompts = tier >= 2
    ? `\n## Render Prompts (for Freepik AI — follow every rule exactly)

You are writing prompts that will be sent directly to the Freepik Mystic
photorealistic AI model to generate the client's first visual impression
of their exhibition stand. These must describe a stand that is:
  - REAL and BUILDABLE — no floating structures, no impossible geometry,
    no fantasy materials. Everything described must be physically
    constructable with real exhibition stand materials and budgets wood in many difrent finshes .
  - CLIENT-SPECIFIC — built entirely from the actual data provided above.
    Never use generic descriptions.
  - VISUALLY IMPRESSIVE — wow-factor comes from great design , not fantasy.
    Drama through lighting, materials, spatial hierarchy, and brand colour.

═══════════════════════════════════════
BUILDABILITY RULES — never violate these:
═══════════════════════════════════════
- Stand must sit on the floor. No suspended platforms, no floating walls.
- All walls and structures must be supported (no unsupported cantilevers
  over 1.5m).
- Use only real exhibition materials: wood  in paint or any finsh ,
  tension fabric graphic walls, modular display panels, timber or
  laminate flooring on raised platform, acrylic or tempered glass,
  powder-coated steel, LED lightboxes, fabric-stretch graphics,
  MDF/laminate cladding, modular meeting pods, LED strip lighting.
- Meeting rooms: enclosed or semi-enclosed pods with clear or frosted
  glass walls — not open "zones".
- LED walls are allowed but must be mounted on a solid back wall or
  structural frame, not floating.
- when requaerd Ceiling structures: fabric canopy or fascia signage suspended from
  truss — not solid ceilings unless stand is in a venue with rigging.
- For budget signals: low budget = smart fabric graphics + standard
  wood painted  + vinyl flooring. High budget = premium timber, glass, LED,
  custom fabrication.

═══════════════════════════════════════
PROMPT CONSTRUCTION RULES:
═══════════════════════════════════════
Required anchor phrase (always include):
"photorealistic architectural visualisation, exhibition stand,
trade show floor, professional even lighting, ultra sharp,
4K, wide establishing shot showing the full stand in context,
Canon 24mm lens, f/8 aperture"

Always include people:
"business visitors browsing the stand, staff in branded uniforms
at the counter, busy trade show atmosphere, visitors walking past"

Always name real materials — never write "premium materials" or
"high-end finishes". Say: "brushed aluminium frame, white tension
fabric graphic walls, light oak laminate flooring on 10cm raised
platform, frosted glass meeting pod, LED lightbox header panel"

Never use these words: modern, sleek, innovative, futuristic,
cutting-edge, stunning, impressive, unique, state-of-the-art.
Describe what you see, not how it feels.

Stand type composition rules (use the client's actual stand type):
  - island: "four open sides, central product display plinth,
    360-degree fabric graphic walls, open traffic flow from all aisles"
  - corner: "two open aisle faces at 90 degrees, corner header sign,
    reception counter facing main aisle, display wall on back"
  - peninsula: "three open sides, solid back wall with hero graphic,
    open front and two sides, raised platform perimeter"
  - inline: "single aisle-facing open side, back wall as hero brand
    graphic, side walls with product display shelving,
    depth zones drawing visitors from aisle to consultation area"

═══════════════════════════════════════
CONCEPT RULES:
═══════════════════════════════════════
Use ALL of this client data:
  - Company name: ${context.clientName}
  - Industry: ${context.industry}
  - Show: ${context.showName}, ${context.showCity}
  - Stand size: ${context.standSize} sqm
  - Stand type: ${context.standType || 'island'}
  - Client goal: ${context.mainGoal || 'brand awareness and lead generation'}
  - Brand colours: ${context.brandColours || 'unknown — infer from industry'}
  - Must-have elements: ${context.mustHaveElements || 'none specified'}
  - Budget signal: ${context.budget || 'mid-range'}
  - Staff count: ${context.staffCount || '4-6 staff'}

CONCEPT A — The Refined Direction:
  Calm, confident brand statement. Clean spatial layout.
  Premium materials for the budget level. Warm or cool lighting
  that matches brand colours. One clear hero visual element
  (large format graphic wall, backlit logo panel, or product display).
  The stand looks expensive but achievable.
  Format: "[ClientName] exhibition stand at [ShowName] [City],
  [sqm] [type] stand, [brand colour] tension fabric back wall,
  [material] flooring on raised platform, [specific feature],
  [meeting solution], [lighting], staff in [brand colour] uniforms,
  busy trade show atmosphere, [anchor phrase]"

CONCEPT B — The Bold Direction:
  Same stand footprint and type, but a meaningfully different
  design language. One strong hero element that stops foot traffic —
  choose ONE of: full-height LED video wall on back panel,
  bold contrasting colour block geometry, dramatic overhead truss
  with suspended fabric canopy and brand logo, or product hero
  display as the central architectural feature.
  Must still be 100% buildable. Bolder, not bigger.
  Same data used, different visual story.

Both prompts must be a SINGLE LINE with no line breaks.
Output exactly:
FREEPIK_PROMPT_A: [full prompt]
FREEPIK_PROMPT_B: [full prompt]

BAD (do not do this):
FREEPIK_PROMPT_A: Modern sleek stand for tech company with innovative design

GOOD:
FREEPIK_PROMPT_A: Star Box Coffee exhibition stand at Gulfood Dubai 2025, 50sqm island stand, four open sides, warm coffee-brown tension fabric graphic walls with cream brand logo, light oak laminate flooring on 10cm raised platform, central circular coffee sampling bar with brass pendant lighting overhead, baristas in black branded uniforms serving espresso samples, LED lightbox header panel with tagline, branded cup display shelf on side panel, business visitors at the bar, busy trade show floor, photorealistic architectural visualisation, exhibition stand, professional even lighting, ultra sharp, 4K, wide establishing shot, Canon 24mm lens`
    : '';

  const prompt = `You are writing a Tier ${tier} concept brief for an exhibition stand project at StandMe.

CLIENT: ${context.clientName}
SHOW: ${context.showName}, ${context.showCity}
${context.standSize ? `STAND SIZE: ${context.standSize} sqm` : 'STAND SIZE: [not confirmed — use assumption]'}
${context.budget ? `BUDGET: ${context.budget}` : 'BUDGET: [not confirmed — use assumption]'}
INDUSTRY: ${context.industry || 'unknown'}
${context.standType ? `STAND TYPE: ${context.standType}` : ''}
${context.openSides ? `OPEN SIDES: ${context.openSides}` : ''}
${context.mainGoal ? `CLIENT GOAL: ${context.mainGoal}` : ''}
${context.staffCount ? `STAFF COUNT: ${context.staffCount}` : ''}
${context.mustHaveElements ? `MUST-HAVE ELEMENTS: ${context.mustHaveElements}` : ''}
${context.brandColours ? `BRAND COLOURS: ${context.brandColours}` : ''}
${context.previousExperience ? `PREVIOUS STAND EXPERIENCE: ${context.previousExperience}` : ''}
${context.brandGuidelines ? `BRAND GUIDELINES: ${context.brandGuidelines}` : ''}
${assumptionsBlock}
${standConstraint ? `SPATIAL CONSTRAINTS:\n${standConstraint}` : ''}
${context.lessonsLearned ? `PAST LESSONS FROM SIMILAR PROJECTS:\n${context.lessonsLearned}` : ''}

Write a concept brief using this exact structure. Be specific and visual. No filler sentences:

---

# Concept Brief: ${context.clientName} at ${context.showName}

## Show Context
2-3 sentences on what this show is about, who attends, what the competitive environment looks like on the floor, and why it matters for this client specifically.

## Client Objectives
What does a company in the ${context.industry || 'exhibition'} sector want to achieve at this show? Sharp and specific.

${conceptsInstruction}

## Key Constraints
${context.standSize ? `- ${context.standSize} sqm: what that space actually allows (traffic flow, zones, meeting area)` : '- Stand size not confirmed — base on [ASSUMED] footprint'}
${context.budget ? `- Budget reality: what ${context.budget} enables and what it rules out` : '- Budget not confirmed — note in brief as [ASSUMED]'}
${standConstraint ? `- Stand type: ${standConstraint}` : ''}
- Show-specific rules or typical restrictions at ${context.showName}
${freepikPrompts}

## Recommended Next Step
One specific action for the next 48 hours.

---

Write with confidence. Every sentence earns its place. No em dashes. No filler.`;

  return generateText(
    prompt,
    'You are StandMe\'s senior creative director. You have 15 years designing exhibition stands across MENA and Europe. You write briefs that win projects. Your language is precise, visual, and confident. Never use em dashes. Never use corporate filler.',
    tier === 1 ? 2000 : 4500,
    60000,
  );
}

export async function generateOutreachEmail(context: {
  companyName: string;
  contactName: string;
  showName: string;
  industry: string;
  standSize?: string;
  emailNumber: number;
}): Promise<{ subject: string; body: string }> {

  const hooks: Record<number, string> = {
    1: `First outreach. Open with something specific about their company or show presence. One sharp observation, one clear value, one low-friction ask. Show you have done your homework.`,
    2: `Follow-up after no reply. Different angle completely. Do not reference the first email. Lead with insight, value, or a question they cannot ignore. Not "just following up."`,
    3: `Final touch. Short. Human. The kind of email a real person sends on a Friday afternoon. No pressure. Easy to reply yes or no.`,
  };

  const prompt = `Write a cold outreach email for StandMe.

ABOUT STANDME: We design and build custom exhibition stands. MENA and Europe. Shows like Arab Health, Gulfood, Hannover Messe, ISE, MEDICA, Interpack. Our work is creative, fast, and built to perform on the floor.

TARGET:
Company: ${context.companyName}
Contact: ${context.contactName}
Show: ${context.showName}
Industry: ${context.industry}
${context.standSize ? `Stand Size: ${context.standSize} sqm` : ''}

EMAIL TYPE: ${hooks[context.emailNumber] || hooks[1]}

RULES (non-negotiable):
- Never use: "I hope this email finds you well", "I wanted to reach out", "I am writing to", "Please do not hesitate", "synergy", "leverage", "touch base"
- Never use em dashes
- Subject: specific, not generic. Not "Partnership Opportunity." Something they will open.
- Body: maximum 5 lines. One clear value statement. One CTA.
- Tone: direct, warm, confident. Like a smart colleague, not a sales robot.
- Sign off as: Mo / StandMe

Return in this exact format:
SUBJECT: [subject line]
BODY:
[email body]`;

  const result = await generateText(
    prompt,
    'You write outreach emails that get replies. You know the exhibition industry. Your emails feel human, specific, and worth reading. No em dashes. No fluff. No corporate speak.',
    500
  );

  const subjectMatch = result.match(/SUBJECT:\s*(.+)/);
  const bodyMatch = result.match(/BODY:\s*([\s\S]+)/);

  return {
    subject: subjectMatch?.[1]?.trim() || `Your stand at ${context.showName}`,
    body: bodyMatch?.[1]?.trim() || result,
  };
}

export async function analyzeShow(showName: string, driveContent: string, knowledgeContext: string): Promise<{
  summary: string;
  industries: string[];
  targetProfile: string;
  painPoints: string;
  standMeAngle: string;
  buyingTriggers: string;
  typicalTimeline: string;
  commonObjections: string;
}> {
  const prompt = `You are a senior sales strategist who has personally sold exhibition stands at every major trade show in MENA and Europe for 15 years. You know the psychology of exhibitors: the budget pressure, the fear of looking smaller than competitors, the technical deadline anxiety, the internal approval chains.

SHOW TO ANALYSE: ${showName}

KNOWLEDGE BASE (from past projects and files):
${knowledgeContext || 'No existing knowledge — rely on industry expertise.'}

DRIVE FILES:
${driveContent || 'No Drive files found — rely on industry expertise.'}

Analyse this show as a sales target for StandMe. Return this exact JSON:
{
  "summary": "2-3 sentences: what the show is, who really attends, the competitive pressure on the show floor that makes stand quality matter",
  "industries": ["primary industry", "secondary", "tertiary"],
  "targetProfile": "The ideal company to target: size, role of the person signing off on the stand budget, what they care about most at this show, what makes them switch suppliers",
  "painPoints": "The 3-4 real pain points exhibitors have at this show. Not generic — specific to this show's format, location, organiser rules, and typical exhibitor profile",
  "standMeAngle": "Our strongest sales angle for this show specifically. What problem do we solve that no generic local contractor can? What proof point resonates most here?",
  "buyingTriggers": "What makes a company at this show pick up the phone to book a stand designer RIGHT NOW? What event, deadline, or realisation triggers the decision?",
  "typicalTimeline": "When do companies at this show start making stand decisions? How long does the sales cycle typically run? What are the key dates?",
  "commonObjections": "The 2-3 most common objections we will face from companies at this show and how to handle them as StandMe"
}

Return ONLY valid JSON. Be specific, not generic. Your analysis will directly drive email copy and sales conversations.`;

  const result = await generateText(prompt, 'You are a world-class sales strategist specialising in exhibition stands. You return only valid JSON. Your insights are specific, actionable, and grounded in real exhibition industry dynamics.', 900);

  try {
    return JSON.parse(result);
  } catch {
    return {
      summary: `${showName} is a major trade show where exhibitor stand quality directly impacts brand perception and lead generation.`,
      industries: ['General'],
      targetProfile: 'Mid-to-large companies with custom stand requirements and allocated exhibition budget',
      painPoints: 'Last-minute design changes, local contractor reliability, cost overruns, technical deadline stress',
      standMeAngle: 'Custom stand design and build with proven delivery across MENA and Europe, fixed-price proposals',
      buyingTriggers: 'Competitor doing a bigger stand, bad experience with previous supplier, upcoming show registration deadline',
      typicalTimeline: '4-6 months before show. Decision made 3 months out. Brief required 10 weeks before build.',
      commonObjections: 'We already have a supplier | Budget is not confirmed yet | Too early to think about it',
    };
  }
}

export async function generateCampaignEmail(context: {
  companyName: string;
  contactName: string;
  showName: string;
  showSummary: string;
  standMeAngle: string;
  painPoints: string;
  buyingTriggers: string;
  commonObjections: string;
  companyContext: string;
  industry: string;
  emailNumber: number;
  pastEmailExamples?: string;
}): Promise<{ subject: string; body: string }> {

  const strategies: Record<number, string> = {
    1: `STRATEGY: Pattern interrupt. Most cold emails from stand designers open with "We design exhibition stands." Don't. Open with the show, a specific pressure this company faces there, or something about their industry at that moment. Make them think "this person gets it." One sharp observation. One clear StandMe value statement. One low-friction CTA (a question, not a meeting request).`,
    2: `STRATEGY: Different angle, new value. Never reference the first email. Lead with a specific case study, a result from a similar company at a similar show, or a counterintuitive insight about exhibiting at ${context.showName}. Create curiosity. Make them feel they are missing something.`,
    3: `STRATEGY: Short, human, time-bound. The show is coming. Something that would take 90 seconds to read and 10 seconds to reply yes or no. Reference the timeline pressure without being pushy. Feel like a message from a real person on a real day, not a sequence.`,
  };

  const prompt = `You are Mo from StandMe — 15 years designing and building exhibition stands across MENA and Europe. You have closed deals with exhibitors at Arab Health, Gulfood, Hannover Messe, ISE, MEDICA, Interpack, and dozens more. You know the floor. You know the pressure. You know what makes companies pick up the phone.

WRITE A COLD EMAIL TO:
Company: ${context.companyName}
Contact: ${context.contactName}
Show: ${context.showName}
Industry: ${context.industry}
${context.companyContext ? `\nWHAT WE KNOW ABOUT THIS COMPANY:\n${context.companyContext}` : ''}

SHOW INTELLIGENCE (use this, do not say it explicitly):
${context.showSummary}

OUR STRONGEST ANGLE AT THIS SHOW:
${context.standMeAngle}

WHAT TRIGGERS DECISIONS:
${context.buyingTriggers}

COMMON OBJECTIONS WE'LL FACE:
${context.commonObjections}
${context.pastEmailExamples ? `\nSUCCESSFUL EMAIL EXAMPLES FROM PAST CAMPAIGNS (learn the style and what works):\n${context.pastEmailExamples}` : ''}

${strategies[context.emailNumber] || strategies[1]}

RULES:
- Never start with "I hope", "I wanted to reach out", "just following up", "touching base"
- Never use em dashes, "synergy", "leverage", "value proposition"
- Subject: makes them open it. Specific. Not "Your stand at ${context.showName}." Something earned.
- Body: 4-5 lines maximum. Every line earns its place. One CTA at the end.
- The CTA should be easy to say yes to: a question, a 15-minute call, a quick response
- Tone: Mo is direct, warm, confident. He knows the industry. Not a salesperson — a trusted expert.
- Sign as: Mo / StandMe

Return in this exact format:
SUBJECT: [subject line]
BODY:
[email body]`;

  const result = await generateText(
    prompt,
    'You are Mo from StandMe. Senior, credible, direct. You write cold emails that land because they are specific and human. No em dashes. No filler. No corporate speak. Every word earns its place.',
    700
  );

  const subjectMatch = result.match(/SUBJECT:\s*(.+)/);
  const bodyMatch = result.match(/BODY:\s*([\s\S]+)/);

  return {
    subject: subjectMatch?.[1]?.trim() || `${context.showName} — quick question`,
    body: bodyMatch?.[1]?.trim() || result,
  };
}

export async function generateSalesReply(context: {
  companyName: string;
  contactName: string;
  showName: string;
  prospectMessage: string;
  conversationHistory: string;
  collectedInfo: Record<string, string>;
  missingInfo: string[];
  knowledgeContext?: string;
}): Promise<{ reply: string; classification: string; extractedInfo: Record<string, string>; urgencyUsed: boolean }> {

  const missingPriority: Record<string, number> = {
    standSize: 1,
    showDates: 2,
    budget: 3,
    phone: 4,
    website: 5,
    requirements: 6,
    logoUrl: 7,
  };

  const topMissing = context.missingInfo
    .sort((a, b) => (missingPriority[a] || 9) - (missingPriority[b] || 9))
    .slice(0, 2);

  const collectedSummary = Object.entries(context.collectedInfo)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' | ') || 'none yet';

  const prompt = `You are Mo from StandMe. You have 15 years closing exhibition stand deals. You know how to read a prospect's reply and respond in a way that moves the deal forward without being pushy.

DEAL IN PROGRESS:
Company: ${context.companyName} (${context.contactName})
Show: ${context.showName}
Collected so far: ${collectedSummary}
Still need: ${topMissing.join(', ') || 'nothing — we have all key info'}

${context.knowledgeContext ? `KNOWLEDGE BASE CONTEXT:\n${context.knowledgeContext}\n` : ''}

CONVERSATION SO FAR:
${context.conversationHistory || 'This is the first reply.'}

THEIR LATEST MESSAGE:
${context.prospectMessage}

YOUR SALES INTELLIGENCE:
- If they show ANY interest, the deal is alive. Move to qualify (size, budget, dates) without interrogating.
- Ask for ONE thing at a time. Two questions = no answer.
- If they mention a competitor or existing supplier, acknowledge it then differentiate (speed, quality, specific show experience).
- If they mention budget concerns, don't drop price — reframe value. Offer a site visit or concept sketch.
- If they give you stand size and show dates, propose a call or initial concept meeting immediately.
- If they seem ready to talk, offer a specific time slot, not "let me know when works."
- READY_TO_CLOSE means: they have confirmed interest + have the key info OR have agreed to a call/meeting.
- Create natural urgency only if real: show registration deadlines, technical submission dates, build crew availability.
- Once stand size and budget are confirmed, naturally ask for their website — we use it as a design reference and to understand their brand before we start sketching concepts. This is standard practice.
- If they send a logo or mention brand guidelines, note the URL/link in logoUrl.

TASK:
1. Classify: INTERESTED | QUESTION | NOT_INTERESTED | MORE_INFO_NEEDED | READY_TO_CLOSE
2. Extract new info from their message: stand size, budget, show dates, phone, their website URL, logo or brand asset URL/link, requirements, decision timeline
3. Write a reply that advances the deal. Short (3-5 lines). Warm. Expert. Human.

Return ONLY this JSON:
{
  "classification": "INTERESTED|QUESTION|NOT_INTERESTED|MORE_INFO_NEEDED|READY_TO_CLOSE",
  "extractedInfo": { "standSize": "...", "budget": "...", "showDates": "...", "phone": "...", "website": "...", "logoUrl": "...", "requirements": "...", "decisionTimeline": "..." },
  "urgencyUsed": false,
  "reply": "Full reply text. Signed: Mo / StandMe"
}`;

  const result = await generateText(
    prompt,
    'You are Mo from StandMe. Expert sales professional. You read prospects like a book and write replies that move deals forward. You are warm, direct, and specific. Return only valid JSON.',
    800
  );

  try {
    const parsed = JSON.parse(result);
    return {
      classification: parsed.classification || 'QUESTION',
      extractedInfo: parsed.extractedInfo || {},
      urgencyUsed: parsed.urgencyUsed || false,
      reply: parsed.reply || `Thanks for your message. Could you share the stand size you're working with for ${context.showName}?\n\nBest,\nMo / StandMe`,
    };
  } catch {
    return {
      classification: 'QUESTION',
      extractedInfo: {},
      urgencyUsed: false,
      reply: `Thanks for your message.\n\nHappy to help with your stand at ${context.showName}. To put together the right approach, could you share the stand size?\n\nBest,\nMo / StandMe`,
    };
  }
}

export async function extractCompaniesFromText(text: string, showName: string): Promise<string[]> {
  const prompt = `Extract a list of company names from this text. These are exhibitors or potential exhibitors at ${showName}.

TEXT:
${text.slice(0, 5000)}

Return ONLY a JSON array of company name strings. No duplicates. No explanations. Example: ["Company A", "Company B"]`;

  const result = await generateText(prompt, 'You extract company names from text. Return only a JSON array of strings.', 400);

  try {
    const parsed = JSON.parse(result);
    if (Array.isArray(parsed)) return parsed.filter(c => typeof c === 'string' && c.length > 1);
  } catch { /* ignore */ }
  return [];
}

export async function generateMarketingContent(type: string, topic: string, context?: string): Promise<string> {

  const typeInstructions: Record<string, string> = {
    post: `Write a LinkedIn post. This should stop the scroll. Open with a statement or question that hits. No "I am excited to share." No fluff opener. Get to the point in line 1. Use short paragraphs. End with one strong insight or call to reflect. 150-250 words. No em dashes.`,

    caption: `Write an Instagram caption for StandMe. Energy, personality, visual. Open line must pull people in immediately. 3-4 short punchy lines. One hashtag block at the end (8-12 relevant hashtags: #exhibitiondesign #tradeshow #standdesign #MENA #Gulfood etc). No em dashes.`,

    campaign: `Design a 3-email campaign sequence. Each email is different in angle and tone. Email 1: awareness and hook. Email 2: proof and value. Email 3: low-friction CTA. For each, write full subject + body. Max 5 lines per email. No em dashes. No corporate speak.`,

    casestudy: `Write a case study in story format. Structure: Challenge (what the client needed and why it was difficult), Approach (how StandMe thought about it and what was designed), Result (what happened on the show floor, visitor response, client outcome). Specific numbers where possible. 400-500 words. Write it like a story, not a brochure. No em dashes.`,

    portfolio: `Write a portfolio entry for a StandMe project. Describe the stand as if the reader is standing in front of it: what they see, how they move through it, what makes it different. Include: the brief challenge, the design solution, the standout detail. 200-300 words. Confident and visual. No em dashes.`,

    insight: `Write an industry insight post. StandMe's point of view on a trend, challenge, or shift in the exhibition world. Take a real position. Not "there are pros and cons." What do we actually think? Reference real shows, real industry dynamics in MENA and Europe. 300-400 words. No em dashes.`,

    contentplan: `Create a 5-day LinkedIn content calendar (Monday to Friday). Each day: one post idea with a clear angle, the opening line, and 2 visual suggestions (what to photograph or design). Themes should rotate: project showcase, industry insight, behind the scenes, client story, thought leadership. Make every day feel different. No em dashes.`,
  };

  const instruction = typeInstructions[type] || `Write ${type} marketing content about the topic.`;

  const prompt = `${instruction}

TOPIC: ${topic}
${context ? `CONTEXT / REFERENCE MATERIAL:\n${context}` : ''}

BRAND: StandMe. Exhibition stand design and build. Operating across MENA and Europe. Key shows: Arab Health, Gulfood, Interpack, Hannover Messe, ISE, MEDICA, Big 5, Automechanika. Our voice is confident, creative, and grounded. We know the floor. We know what works.

Write it now. No preamble, no "here is your content." Just the content itself.`;

  return generateText(
    prompt,
    'You are StandMe\'s brand voice. You know the exhibition industry inside out: the pressure of build week, what it feels like when a stand draws a crowd, the difference between a shell scheme and a custom build. Your writing is specific, energetic, and human. Never use em dashes. Never use corporate filler. Make every word count.',
    2500
  );
}
