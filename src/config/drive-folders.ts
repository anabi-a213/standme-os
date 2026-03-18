/**
 * StandMe OS — Google Drive Folder Structure
 *
 * This file defines the canonical folder tree for the StandMe Google Drive.
 * Folder IDs are loaded from environment variables after the `/setupdrive`
 * command has been run once.
 *
 * TREE STRUCTURE:
 * /StandMe_OS  (root — STANDME_ROOT already in drive.ts)
 *   /00_Admin
 *     /Approvals_Log
 *     /Templates_Master
 *     /Pricing_Model
 *     /Finance
 *       /Invoices
 *       /Payments
 *       /Job_Costing
 *       /Supplier_Invoices
 *   /01_Sales
 *     /Leads
 *       /Inbound
 *       /Outbound
 *       /Qualified
 *       /Lost
 *     /Proposals
 *     /Offer_Sheets
 *     /Contracts_Templates
 *     /Outreach_Assets
 *   /02_Projects
 *     /ACTIVE    ← code creates per-project folders here automatically
 *     /ARCHIVE
 *   /03_Events_And_Venues  ← code creates per-show folders here automatically
 *   /04_Contractors        ← code creates per-contractor folders here automatically
 *   /05_Design_References
 *     /By_Industry
 *     /By_Style
 *     /By_Stand_Type
 *   /06_Lessons_Learned
 *     /Won_Deals
 *     /Lost_Deals
 *     /Delivery_Issues
 *     /Process_Improvements
 *
 * DYNAMIC FOLDERS (created automatically by code):
 *   /02_Projects/ACTIVE/[ProjectID]_[Client]_[Show]_[YYYY-MM]/
 *     /00_Brief, /01_Concept, /02_3D_Design, /03_Shop_Drawings, /04_Graphics,
 *     /05_Client_Approvals, /06_Contractor_Pack, /07_Venue_Portal_Deadlines,
 *     /08_Logistics_Install, /09_Delivery_Photos, /10_Closeout
 *   /03_Events_And_Venues/[ShowName]_[YYYY]/
 *     /Portal_Docs, /Deadlines, /Rules_Regulations, /Rigging_Electrical_Orders
 *   /04_Contractors/[ContractorName]/
 *     /Contacts, /Rates, /Past_Projects, /Performance_Notes
 */

import { logger } from '../utils/logger';

// ──────────────────────────────────────────────────────────────
// STATIC FOLDER ID MAP (populated from env after /setupdrive)
// ──────────────────────────────────────────────────────────────

export const DRIVE_FOLDERS = {
  // Root (already exists — used as STANDME_ROOT in drive.ts)
  ROOT: '19FU-EKvNdpiOjjUBWafQWVoo2YTGDZsl',

  ADMIN: {
    _id: () => process.env.DRIVE_FOLDER_ADMIN || '',
    APPROVALS_LOG: () => process.env.DRIVE_FOLDER_APPROVALS_LOG || '',
    TEMPLATES_MASTER: () => process.env.DRIVE_FOLDER_TEMPLATES_MASTER || '',
    PRICING_MODEL: () => process.env.DRIVE_FOLDER_PRICING_MODEL || '',
    FINANCE: {
      _id: () => process.env.DRIVE_FOLDER_FINANCE || '',
      INVOICES: () => process.env.DRIVE_FOLDER_INVOICES || '',
      PAYMENTS: () => process.env.DRIVE_FOLDER_PAYMENTS || '',
      JOB_COSTING: () => process.env.DRIVE_FOLDER_JOB_COSTING || '',
      SUPPLIER_INVOICES: () => process.env.DRIVE_FOLDER_SUPPLIER_INVOICES || '',
    },
  },

  SALES: {
    _id: () => process.env.DRIVE_FOLDER_SALES || '',
    LEADS: {
      _id: () => process.env.DRIVE_FOLDER_LEADS || '',
      INBOUND: () => process.env.DRIVE_FOLDER_LEADS_INBOUND || '',
      OUTBOUND: () => process.env.DRIVE_FOLDER_LEADS_OUTBOUND || '',
      QUALIFIED: () => process.env.DRIVE_FOLDER_LEADS_QUALIFIED || '',
      LOST: () => process.env.DRIVE_FOLDER_LEADS_LOST || '',
    },
    PROPOSALS: () => process.env.DRIVE_FOLDER_PROPOSALS || '',
    OFFER_SHEETS: () => process.env.DRIVE_FOLDER_OFFER_SHEETS || '',
    CONTRACTS_TEMPLATES: () => process.env.DRIVE_FOLDER_CONTRACTS_TEMPLATES || '',
    OUTREACH_ASSETS: () => process.env.DRIVE_FOLDER_OUTREACH_ASSETS || '',
  },

  PROJECTS: {
    _id: () => process.env.DRIVE_FOLDER_PROJECTS || '',
    ACTIVE: () => process.env.DRIVE_FOLDER_PROJECTS_ACTIVE || '',
    ARCHIVE: () => process.env.DRIVE_FOLDER_PROJECTS_ARCHIVE || '',
  },

  EVENTS: {
    _id: () => process.env.DRIVE_FOLDER_EVENTS || '',
  },

  CONTRACTORS: {
    _id: () => process.env.DRIVE_FOLDER_CONTRACTORS || '',
  },

  DESIGN_REFS: {
    _id: () => process.env.DRIVE_FOLDER_DESIGN_REFS || '',
    BY_INDUSTRY: () => process.env.DRIVE_FOLDER_DESIGN_BY_INDUSTRY || '',
    BY_STYLE: () => process.env.DRIVE_FOLDER_DESIGN_BY_STYLE || '',
    BY_STAND_TYPE: () => process.env.DRIVE_FOLDER_DESIGN_BY_STAND_TYPE || '',
  },

  LESSONS_LEARNED: {
    _id: () => process.env.DRIVE_FOLDER_LESSONS || '',
    WON_DEALS: () => process.env.DRIVE_FOLDER_LESSONS_WON || '',
    LOST_DEALS: () => process.env.DRIVE_FOLDER_LESSONS_LOST || '',
    DELIVERY_ISSUES: () => process.env.DRIVE_FOLDER_LESSONS_DELIVERY || '',
    PROCESS_IMPROVEMENTS: () => process.env.DRIVE_FOLDER_LESSONS_PROCESS || '',
  },
};

// ──────────────────────────────────────────────────────────────
// DYNAMIC FOLDER TEMPLATES
// ──────────────────────────────────────────────────────────────

/** 11 subfolders created inside every project folder */
export const PROJECT_SUBFOLDERS = [
  '00_Brief',
  '01_Concept',
  '02_3D_Design',
  '03_Shop_Drawings',
  '04_Graphics',
  '05_Client_Approvals',
  '06_Contractor_Pack',
  '07_Venue_Portal_Deadlines',
  '08_Logistics_Install',
  '09_Delivery_Photos',
  '10_Closeout',
] as const;

export type ProjectSubfolder = typeof PROJECT_SUBFOLDERS[number];

/** 4 subfolders created inside every show/event folder */
export const SHOW_SUBFOLDERS = [
  'Portal_Docs',
  'Deadlines',
  'Rules_Regulations',
  'Rigging_Electrical_Orders',
] as const;

/** 4 subfolders created inside every contractor folder */
export const CONTRACTOR_SUBFOLDERS = [
  'Contacts',
  'Rates',
  'Past_Projects',
  'Performance_Notes',
] as const;

// ──────────────────────────────────────────────────────────────
// FOLDER NAME GENERATOR
// ──────────────────────────────────────────────────────────────

/** Generates a canonical project folder name: P001_ClientName_ShowName_2025-03 */
export function makeProjectFolderName(projectId: string, client: string, show: string, date?: Date): string {
  const d = date || new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const safeName = (s: string) => s.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_').slice(0, 30);
  return `${projectId}_${safeName(client)}_${safeName(show)}_${yyyy}-${mm}`;
}

/** Generates a canonical show folder name: Arab_Health_2025 */
export function makeShowFolderName(showName: string, year?: number): string {
  const y = year || new Date().getFullYear();
  return `${showName.replace(/\s+/g, '_')}_${y}`;
}

// ──────────────────────────────────────────────────────────────
// STATIC FOLDER TREE DEFINITION
// (used by setupDriveFolderTree in drive.ts)
// ──────────────────────────────────────────────────────────────

/** Flat list of folders to create under the root, in order (parent before children). */
export const STATIC_FOLDER_TREE: Array<{
  name: string;
  envKey: string;         // .env key where the folder ID is stored
  parentEnvKey: string;   // envKey of parent (or 'ROOT')
  adminOnly?: boolean;
}> = [
  // ─── Level 1 (direct children of root) ───
  { name: '00_Admin', envKey: 'DRIVE_FOLDER_ADMIN', parentEnvKey: 'ROOT', adminOnly: true },
  { name: '01_Sales', envKey: 'DRIVE_FOLDER_SALES', parentEnvKey: 'ROOT' },
  { name: '02_Projects', envKey: 'DRIVE_FOLDER_PROJECTS', parentEnvKey: 'ROOT' },
  { name: '03_Events_And_Venues', envKey: 'DRIVE_FOLDER_EVENTS', parentEnvKey: 'ROOT' },
  { name: '04_Contractors', envKey: 'DRIVE_FOLDER_CONTRACTORS', parentEnvKey: 'ROOT' },
  { name: '05_Design_References', envKey: 'DRIVE_FOLDER_DESIGN_REFS', parentEnvKey: 'ROOT' },
  { name: '06_Lessons_Learned', envKey: 'DRIVE_FOLDER_LESSONS', parentEnvKey: 'ROOT' },

  // ─── 00_Admin children ───
  { name: 'Approvals_Log', envKey: 'DRIVE_FOLDER_APPROVALS_LOG', parentEnvKey: 'DRIVE_FOLDER_ADMIN', adminOnly: true },
  { name: 'Templates_Master', envKey: 'DRIVE_FOLDER_TEMPLATES_MASTER', parentEnvKey: 'DRIVE_FOLDER_ADMIN', adminOnly: true },
  { name: 'Pricing_Model', envKey: 'DRIVE_FOLDER_PRICING_MODEL', parentEnvKey: 'DRIVE_FOLDER_ADMIN', adminOnly: true },
  { name: 'Finance', envKey: 'DRIVE_FOLDER_FINANCE', parentEnvKey: 'DRIVE_FOLDER_ADMIN', adminOnly: true },

  // ─── Finance children ───
  { name: 'Invoices', envKey: 'DRIVE_FOLDER_INVOICES', parentEnvKey: 'DRIVE_FOLDER_FINANCE', adminOnly: true },
  { name: 'Payments', envKey: 'DRIVE_FOLDER_PAYMENTS', parentEnvKey: 'DRIVE_FOLDER_FINANCE', adminOnly: true },
  { name: 'Job_Costing', envKey: 'DRIVE_FOLDER_JOB_COSTING', parentEnvKey: 'DRIVE_FOLDER_FINANCE', adminOnly: true },
  { name: 'Supplier_Invoices', envKey: 'DRIVE_FOLDER_SUPPLIER_INVOICES', parentEnvKey: 'DRIVE_FOLDER_FINANCE', adminOnly: true },

  // ─── 01_Sales children ───
  { name: 'Leads', envKey: 'DRIVE_FOLDER_LEADS', parentEnvKey: 'DRIVE_FOLDER_SALES' },
  { name: 'Proposals', envKey: 'DRIVE_FOLDER_PROPOSALS', parentEnvKey: 'DRIVE_FOLDER_SALES' },
  { name: 'Offer_Sheets', envKey: 'DRIVE_FOLDER_OFFER_SHEETS', parentEnvKey: 'DRIVE_FOLDER_SALES' },
  { name: 'Contracts_Templates', envKey: 'DRIVE_FOLDER_CONTRACTS_TEMPLATES', parentEnvKey: 'DRIVE_FOLDER_SALES' },
  { name: 'Outreach_Assets', envKey: 'DRIVE_FOLDER_OUTREACH_ASSETS', parentEnvKey: 'DRIVE_FOLDER_SALES' },

  // ─── Leads children ───
  { name: 'Inbound', envKey: 'DRIVE_FOLDER_LEADS_INBOUND', parentEnvKey: 'DRIVE_FOLDER_LEADS' },
  { name: 'Outbound', envKey: 'DRIVE_FOLDER_LEADS_OUTBOUND', parentEnvKey: 'DRIVE_FOLDER_LEADS' },
  { name: 'Qualified', envKey: 'DRIVE_FOLDER_LEADS_QUALIFIED', parentEnvKey: 'DRIVE_FOLDER_LEADS' },
  { name: 'Lost', envKey: 'DRIVE_FOLDER_LEADS_LOST', parentEnvKey: 'DRIVE_FOLDER_LEADS' },

  // ─── 02_Projects children ───
  { name: 'ACTIVE', envKey: 'DRIVE_FOLDER_PROJECTS_ACTIVE', parentEnvKey: 'DRIVE_FOLDER_PROJECTS' },
  { name: 'ARCHIVE', envKey: 'DRIVE_FOLDER_PROJECTS_ARCHIVE', parentEnvKey: 'DRIVE_FOLDER_PROJECTS' },

  // ─── 05_Design_References children ───
  { name: 'By_Industry', envKey: 'DRIVE_FOLDER_DESIGN_BY_INDUSTRY', parentEnvKey: 'DRIVE_FOLDER_DESIGN_REFS' },
  { name: 'By_Style', envKey: 'DRIVE_FOLDER_DESIGN_BY_STYLE', parentEnvKey: 'DRIVE_FOLDER_DESIGN_REFS' },
  { name: 'By_Stand_Type', envKey: 'DRIVE_FOLDER_DESIGN_BY_STAND_TYPE', parentEnvKey: 'DRIVE_FOLDER_DESIGN_REFS' },

  // ─── 06_Lessons_Learned children ───
  { name: 'Won_Deals', envKey: 'DRIVE_FOLDER_LESSONS_WON', parentEnvKey: 'DRIVE_FOLDER_LESSONS' },
  { name: 'Lost_Deals', envKey: 'DRIVE_FOLDER_LESSONS_LOST', parentEnvKey: 'DRIVE_FOLDER_LESSONS' },
  { name: 'Delivery_Issues', envKey: 'DRIVE_FOLDER_LESSONS_DELIVERY', parentEnvKey: 'DRIVE_FOLDER_LESSONS' },
  { name: 'Process_Improvements', envKey: 'DRIVE_FOLDER_LESSONS_PROCESS', parentEnvKey: 'DRIVE_FOLDER_LESSONS' },
];

// ──────────────────────────────────────────────────────────────
// HELPER: Get best folder ID for a given file type
// Falls back gracefully if env not set yet.
// ──────────────────────────────────────────────────────────────

export type FileCategory =
  | 'brief'
  | 'proposal'
  | 'lessons-won'
  | 'lessons-lost'
  | 'lessons-delivery'
  | 'lessons-process'
  | 'marketing'
  | 'outreach'
  | 'contractor'
  | 'design-ref';

const ROOT = '19FU-EKvNdpiOjjUBWafQWVoo2YTGDZsl';

export function getFolderIdForCategory(category: FileCategory): string {
  const map: Record<FileCategory, string> = {
    'brief': DRIVE_FOLDERS.SALES.PROPOSALS() || DRIVE_FOLDERS.SALES._id() || ROOT,
    'proposal': DRIVE_FOLDERS.SALES.PROPOSALS() || DRIVE_FOLDERS.SALES._id() || ROOT,
    'lessons-won': DRIVE_FOLDERS.LESSONS_LEARNED.WON_DEALS() || DRIVE_FOLDERS.LESSONS_LEARNED._id() || ROOT,
    'lessons-lost': DRIVE_FOLDERS.LESSONS_LEARNED.LOST_DEALS() || DRIVE_FOLDERS.LESSONS_LEARNED._id() || ROOT,
    'lessons-delivery': DRIVE_FOLDERS.LESSONS_LEARNED.DELIVERY_ISSUES() || DRIVE_FOLDERS.LESSONS_LEARNED._id() || ROOT,
    'lessons-process': DRIVE_FOLDERS.LESSONS_LEARNED.PROCESS_IMPROVEMENTS() || DRIVE_FOLDERS.LESSONS_LEARNED._id() || ROOT,
    'marketing': DRIVE_FOLDERS.SALES.OUTREACH_ASSETS() || DRIVE_FOLDERS.SALES._id() || ROOT,
    'outreach': DRIVE_FOLDERS.SALES.OUTREACH_ASSETS() || DRIVE_FOLDERS.SALES._id() || ROOT,
    'contractor': DRIVE_FOLDERS.CONTRACTORS._id() || ROOT,
    'design-ref': DRIVE_FOLDERS.DESIGN_REFS._id() || ROOT,
  };

  const id = map[category];
  if (!id || id === ROOT) {
    logger.warn(`[Drive] Folder not configured for category "${category}" — using root. Run /setupdrive to fix.`);
  }
  return id || ROOT;
}
