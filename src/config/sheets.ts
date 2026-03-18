export interface SheetConfig {
  envKey: string;
  tabName: string;
  columns: Record<string, string>; // field name → column letter
  headerRow: number;
}

export const SHEETS: Record<string, SheetConfig> = {
  LEAD_MASTER: {
    envKey: 'SHEET_LEAD_MASTER',
    tabName: 'Leads',
    columns: {
      id: 'A',
      timestamp: 'B',
      companyName: 'C',
      contactName: 'D',
      contactEmail: 'E',
      contactTitle: 'F',
      showName: 'G',
      showCity: 'H',
      standSize: 'I',
      budget: 'J',
      industry: 'K',
      leadSource: 'L',
      score: 'M',
      scoreBreakdown: 'N',
      confidence: 'O',
      status: 'P',
      trelloCardId: 'Q',
      enrichmentStatus: 'R',
      dmName: 'S',
      dmTitle: 'T',
      dmLinkedIn: 'U',
      dmEmail: 'V',
      outreachReadiness: 'W',
      language: 'X',
      notes: 'Y',
    },
    headerRow: 1,
  },

  OUTREACH_QUEUE: {
    envKey: 'SHEET_OUTREACH_QUEUE',
    tabName: 'Queue',
    columns: {
      id: 'A',
      leadId: 'B',
      companyName: 'C',
      dmName: 'D',
      dmEmail: 'E',
      showName: 'F',
      readinessScore: 'G',
      sequenceStatus: 'H',
      addedDate: 'I',
      lastAction: 'J',
    },
    headerRow: 1,
  },

  OUTREACH_LOG: {
    envKey: 'SHEET_OUTREACH_LOG',
    tabName: 'Log',
    columns: {
      id: 'A',
      leadId: 'B',
      companyName: 'C',
      emailType: 'D',
      sentDate: 'E',
      status: 'F', // OPENED/CLICKED/REPLIED/BOUNCED
      replyClassification: 'G',
      woodpeckerId: 'H',
      notes: 'I',
    },
    headerRow: 1,
  },

  LESSONS_LEARNED: {
    envKey: 'SHEET_LESSONS_LEARNED',
    tabName: 'Lessons',
    columns: {
      id: 'A',
      projectName: 'B',
      showName: 'C',
      client: 'D',
      outcome: 'E', // WON/LOST
      standSize: 'F',
      budget: 'G',
      whatWentWell: 'H',
      whatWentWrong: 'I',
      costVsBudget: 'J',
      clientFeedback: 'K',
      competitorIntel: 'L',
      docUrl: 'M',
      date: 'N',
    },
    headerRow: 1,
  },

  TECHNICAL_DEADLINES: {
    envKey: 'SHEET_TECHNICAL_DEADLINES',
    tabName: 'Deadlines',
    columns: {
      id: 'A',
      showName: 'B',
      client: 'C',
      portalSubmission: 'D',
      rigging: 'E',
      electrics: 'F',
      designApproval: 'G',
      buildStart: 'H',
      showOpen: 'I',
      breakdown: 'J',
      confidenceLevel: 'K',
      sourceUrl: 'L',
      lastVerified: 'M',
    },
    headerRow: 1,
  },

  CONTRACTOR_DB: {
    envKey: 'SHEET_CONTRACTOR_DB',
    tabName: 'Contractors',
    columns: {
      id: 'A',
      name: 'B',
      company: 'C',
      specialty: 'D',
      region: 'E',
      phone: 'F',
      email: 'G',
      rating: 'H',
      lastBooked: 'I',
      notes: 'J',
    },
    headerRow: 1,
  },

  DRIVE_INDEX: {
    envKey: 'SHEET_DRIVE_INDEX',
    tabName: 'Index',
    columns: {
      fileName: 'A',
      fileId: 'B',
      fileUrl: 'C',
      folderPath: 'D',
      parentFolder: 'E',
      fileType: 'F',
      lastModified: 'G',
      linkedProject: 'H',
      category: 'I',
    },
    headerRow: 1,
  },

  CROSS_AGENT_HUB: {
    envKey: 'SHEET_CROSS_AGENT_HUB',
    tabName: 'Hub',
    columns: {
      timestamp: 'A',
      clientName: 'B',
      showName: 'C',
      salesStatus: 'D',
      designStatus: 'E',
      operationStatus: 'F',
      productionStatus: 'G',
      flags: 'H',
      lastUpdated: 'I',
    },
    headerRow: 1,
  },

  SYSTEM_LOG: {
    envKey: 'SHEET_SYSTEM_LOG',
    tabName: 'Log',
    columns: {
      timestamp: 'A',
      agent: 'B',
      actionType: 'C',
      showName: 'D',
      detail: 'E',
      result: 'F',
      retry: 'G',
      notes: 'H',
    },
    headerRow: 1,
  },

  KNOWLEDGE_BASE: {
    envKey: 'SHEET_KNOWLEDGE_BASE',
    tabName: 'Knowledge',
    columns: {
      id: 'A',
      source: 'B',
      sourceType: 'C',  // drive / trello / sheet / manual
      topic: 'D',       // company / show / contractor / project / general
      tags: 'E',        // comma-separated keywords
      content: 'F',     // the actual knowledge (max ~500 chars)
      lastUpdated: 'G',
    },
    headerRow: 1,
  },

  CAMPAIGN_SALES: {
    envKey: 'SHEET_CAMPAIGN_SALES',
    tabName: 'CampaignSales',
    columns: {
      id: 'A',               // CS-timestamp
      campaignId: 'B',       // Woodpecker campaign ID
      showName: 'C',
      companyName: 'D',
      contactName: 'E',
      contactEmail: 'F',
      woodpeckerId: 'G',     // Woodpecker prospect ID
      status: 'H',           // SENT | OPENED | REPLIED | INTERESTED | NOT_INTERESTED | QUALIFIED | LOST
      classification: 'I',   // AI classification of last reply
      standSize: 'J',        // collected during sales loop
      budget: 'K',
      showDates: 'L',
      phone: 'M',
      requirements: 'N',
      conversationLog: 'O',  // JSON-encoded array of {role, message, date}
      lastReplyDate: 'P',
      lastActionDate: 'Q',
      leadMasterId: 'R',     // set when converted to Lead Master
      notes: 'S',
      website: 'T',          // prospect website — needed for concept brief
      logoUrl: 'U',          // logo/brand asset URL — needed for design
    },
    headerRow: 1,
  },
};
