export const TRELLO_CONFIG = {
  // Pipeline stages on Sales Pipeline board (the only writable board)
  pipelineStages: [
    '01 — New Inquiry',
    '02 — Qualifying',
    '03 — Concept Brief',
    '04 — Proposal Sent',
    '05 — In Negotiation',
    '06 — Won',
    '07 — Lost / Delayed',
  ] as const,

  // Board keys mapped to env var names
  boards: {
    SALES_PIPELINE: 'TRELLO_BOARD_SALES_PIPELINE', // standme-sales-pipeline — READ + WRITE
    SALES: 'TRELLO_BOARD_SALES',                   // sales            — READ ONLY
    DESIGN: 'TRELLO_BOARD_DESIGN',                 // design           — READ ONLY
    OPERATION: 'TRELLO_BOARD_OPERATION',           // operation        — READ ONLY
    PRODUCTION: 'TRELLO_BOARD_PRODUCTION',         // production       — READ ONLY
  } as const,

  // Only SALES_PIPELINE can have cards created/moved/modified
  writableBoards: ['TRELLO_BOARD_SALES_PIPELINE'],

  // All other boards are read-only (collect data, never touch)
  readOnlyBoards: [
    'TRELLO_BOARD_SALES',
    'TRELLO_BOARD_DESIGN',
    'TRELLO_BOARD_OPERATION',
    'TRELLO_BOARD_PRODUCTION',
  ],
};

export type PipelineStage = typeof TRELLO_CONFIG.pipelineStages[number];
