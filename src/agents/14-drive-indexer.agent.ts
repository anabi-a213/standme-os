import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { appendRow, readSheet, objectToRow } from '../services/google/sheets';
import { listAllPersonalFiles, listSharedDrives, listSharedDriveFiles, readFileContent, buildFolderMap, resolveFullPath, searchFiles, DriveFile } from '../services/google/drive';
import { generateText } from '../services/ai/client';
import { saveKnowledge, searchKnowledge, buildKnowledgeContext } from '../services/knowledge';
import { sendToMo, formatType2 } from '../services/telegram/bot';
import { logger } from '../utils/logger';

export class DriveIndexerAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Drive Indexer',
    id: 'agent-14',
    description: 'Index all Google Drive files (personal + shared) with content understanding and growing knowledge base',
    commands: ['/indexdrive', '/findfile', '/readfile', '/knowledge'],
    schedule: '0 8 * * 1',
    requiredRole: UserRole.OPS_LEAD,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    if (ctx.command === '/findfile') return this.findFile(ctx);
    if (ctx.command === '/readfile') return this.readFile(ctx);
    if (ctx.command === '/knowledge') return this.queryKnowledge(ctx);
    return this.indexDrive(ctx);
  }

  private async indexDrive(ctx: AgentContext): Promise<AgentResponse> {
    await this.respond(ctx.chatId, '🔍 Building full folder tree and indexing all drives (personal + shared)...');

    try {
      // 1. Build complete folder map first (one pass, used for all path resolution)
      await this.respond(ctx.chatId, '📂 Mapping folder structure...');
      const folderMap = await buildFolderMap();
      logger.info(`[Drive] Folder map built: ${folderMap.size} folders`);

      const allFiles: DriveFile[] = [];

      // 2. Personal Drive — all files, paginated
      const personalFiles = await listAllPersonalFiles();
      allFiles.push(...personalFiles);
      logger.info(`[Drive] Personal drive: ${personalFiles.length} files`);

      // 3. Shared Drives — all files in each, paginated
      const sharedDrives = await listSharedDrives();
      for (const drive of sharedDrives) {
        try {
          const driveFiles = await listSharedDriveFiles(drive.id);
          allFiles.push(...driveFiles);
          logger.info(`[Drive] Shared drive "${drive.name}": ${driveFiles.length} files`);
        } catch (err: any) {
          logger.warn(`[Drive] Could not index shared drive "${drive.name}": ${err.message}`);
        }
      }

      // Skip folders — only index actual files
      const actualFiles = allFiles.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');

      await this.respond(ctx.chatId, `Found ${actualFiles.length} files across ${1 + sharedDrives.length} drives. Reading and learning...`);

      // 4. Read existing leads for project matching
      const leads = await readSheet(SHEETS.LEAD_MASTER);
      const companyNames = leads.slice(1).map(r => (r[2] || '').toLowerCase()).filter(Boolean);

      let indexed = 0;
      let withContent = 0;
      let knowledgeSaved = 0;

      for (const file of actualFiles) {
        try {
          const category = this.categorizeFile(file);
          const linkedProject = this.matchToProject(file, companyNames);
          // Resolve full path using pre-built folder map (no API calls per file)
          const folderPath = resolveFullPath(file.parents?.[0], folderMap);

          // Read content for docs, sheets, PDFs
          let contentSummary = '';
          const isReadable = [
            'application/vnd.google-apps.document',
            'application/vnd.google-apps.spreadsheet',
            'application/pdf',
          ].includes(file.mimeType);

          if (isReadable) {
            try {
              const rawContent = await readFileContent(file);
              if (rawContent && rawContent.length > 50) {
                // Generate summary for index
                contentSummary = await generateText(
                  `Summarize this file content in 1-2 sentences for a business context index. File: "${file.name}"\n\nContent:\n${rawContent.slice(0, 3000)}`,
                  'You summarize documents for a business index. Be extremely concise — max 150 characters.',
                  80
                );
                withContent++;

                // Extract and save knowledge to the knowledge base
                const knowledge = await this.extractKnowledge(file, rawContent, linkedProject, folderPath);
                if (knowledge) {
                  await saveKnowledge(knowledge);
                  knowledgeSaved++;
                }
              }
            } catch { /* content read failed, continue */ }
          } else {
            // Even for non-readable files (images, videos, folders, CAD files, etc.)
            // we can still save metadata knowledge based on filename + folder context
            const metaKnowledge = this.extractMetadataKnowledge(file, linkedProject, folderPath, category);
            if (metaKnowledge) {
              await saveKnowledge(metaKnowledge);
              knowledgeSaved++;
            }
          }

          await appendRow(SHEETS.DRIVE_INDEX, objectToRow(SHEETS.DRIVE_INDEX, {
            fileName: file.name,
            fileId: file.id,
            fileUrl: file.webViewLink,
            folderPath,
            parentFolder: file.parents?.[0] || file.driveId || '',
            fileType: this.friendlyType(file.mimeType),
            lastModified: file.modifiedTime,
            linkedProject: linkedProject || '',
            category,
          }));

          indexed++;
        } catch (err: any) {
          logger.warn(`[Drive] Failed to index "${file.name}": ${err.message}`);
        }
      }

      const summary = `✅ Indexed ${indexed}/${actualFiles.length} files (${withContent} with content, ${knowledgeSaved} knowledge entries) across ${1 + sharedDrives.length} drives. Folder tree: ${folderMap.size} folders mapped.`;
      await sendToMo(formatType2('Drive Index Complete', summary));
      await this.respond(ctx.chatId, summary);

      return { success: true, message: summary, confidence: 'HIGH' };

    } catch (err: any) {
      await this.respond(ctx.chatId, `Failed to index Drive: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }
  }

  // ---- Extract structured knowledge from readable file content ----

  private async extractKnowledge(
    file: DriveFile,
    rawContent: string,
    linkedProject: string | null,
    folderPath: string
  ): Promise<{ source: string; sourceType: string; topic: string; tags: string; content: string } | null> {
    try {
      const extracted = await generateText(
        `File: "${file.name}" (in folder: ${folderPath})\n\nContent:\n${rawContent.slice(0, 4000)}\n\n` +
        `Extract the most important business knowledge from this file. Return a JSON object with:\n` +
        `- topic: the main entity (company name, show name, project name, or "general")\n` +
        `- tags: 3-6 comma-separated keywords\n` +
        `- content: 1-3 sentence summary of the key facts, decisions, or actionable info (max 400 chars)\n` +
        `\nReturn ONLY valid JSON, no other text.`,
        'You extract structured business knowledge from documents. Return only valid JSON.',
        200
      );

      const parsed = JSON.parse(extracted);
      if (!parsed.content) return null;

      return {
        source: file.webViewLink || file.name,
        sourceType: 'drive',
        topic: parsed.topic || linkedProject || 'general',
        tags: parsed.tags || '',
        content: String(parsed.content).slice(0, 500),
      };
    } catch {
      // If AI extraction fails, save a basic entry with the filename + category
      return {
        source: file.webViewLink || file.name,
        sourceType: 'drive',
        topic: linkedProject || 'general',
        tags: `${this.categorizeFile(file)}, ${this.friendlyType(file.mimeType)}`,
        content: `File "${file.name}" in ${folderPath} — ${this.categorizeFile(file)} document.`,
      };
    }
  }

  // ---- Extract metadata knowledge from non-readable files (images, CAD, video, etc.) ----

  private extractMetadataKnowledge(
    file: DriveFile,
    linkedProject: string | null,
    folderPath: string,
    category: string
  ): { source: string; sourceType: string; topic: string; tags: string; content: string } | null {
    // Only save if there's something meaningful to know
    if (file.mimeType === 'application/vnd.google-apps.folder') return null; // skip folders

    const mime = file.mimeType.toLowerCase();
    const name = file.name.toLowerCase();

    let typeLabel = this.friendlyType(file.mimeType);
    let extraContext = '';

    if (mime.includes('image')) {
      extraContext = 'Visual asset — may be a stand photo, render, design, or site image.';
    } else if (mime.includes('video')) {
      extraContext = 'Video file — may be a project walkthrough, site recording, or stand tour.';
    } else if (name.includes('.skp') || name.includes('3d') || name.includes('cad')) {
      extraContext = '3D/CAD design file — stand design model.';
    } else if (name.includes('.zip') || name.includes('.rar')) {
      extraContext = 'Archive file — may contain project assets.';
    } else {
      // Not interesting enough to save
      if (!linkedProject && category === 'Other') return null;
    }

    return {
      source: file.webViewLink || file.name,
      sourceType: 'drive',
      topic: linkedProject || category,
      tags: `${category}, ${typeLabel}, ${folderPath}`,
      content: `${typeLabel} file "${file.name}" in ${folderPath}. Modified: ${file.modifiedTime?.split('T')[0] || '?'}. ${extraContext}`.slice(0, 500),
    };
  }

  // ---- /findfile command ----

  private async findFile(ctx: AgentContext): Promise<AgentResponse> {
    const query = ctx.args.trim();
    if (!query) {
      await this.respond(ctx.chatId, 'Usage: /findfile [search term]');
      return { success: false, message: 'No query', confidence: 'LOW' };
    }

    // Search index first (fast)
    const index = await readSheet(SHEETS.DRIVE_INDEX);
    const matches = index.slice(1).filter(r =>
      r.some(cell => cell?.toLowerCase().includes(query.toLowerCase()))
    ).slice(0, 8);

    // Also search Drive directly for fresh results
    let liveMatches: DriveFile[] = [];
    try {
      liveMatches = await searchFiles(query);
    } catch { /* silent */ }

    if (matches.length === 0 && liveMatches.length === 0) {
      await this.respond(ctx.chatId, `No files found matching "${query}".`);
      return { success: true, message: 'No matches', confidence: 'HIGH' };
    }

    let response = `*Files matching "${query}":*\n\n`;

    if (matches.length > 0) {
      response += matches.map(r =>
        `📄 *${r[0] || '?'}*\n   Type: ${r[5] || '?'} | ${r[7] ? `Project: ${r[7]}` : 'Unlinked'}\n   ${r[2] || 'No URL'}`
      ).join('\n\n');
    }

    if (liveMatches.length > 0 && matches.length === 0) {
      response += liveMatches.map(f =>
        `📄 *${f.name}*\n   ${f.webViewLink}`
      ).join('\n\n');
      response += '\n\n_Run /indexdrive to cache these for faster future searches._';
    }

    await this.respond(ctx.chatId, response);
    return { success: true, message: `${matches.length + liveMatches.length} files found`, confidence: 'HIGH' };
  }

  // ---- /readfile command ----

  private async readFile(ctx: AgentContext): Promise<AgentResponse> {
    const query = ctx.args.trim();
    if (!query) {
      await this.respond(ctx.chatId, 'Usage: /readfile [file name or search term]');
      return { success: false, message: 'No query', confidence: 'LOW' };
    }

    await this.respond(ctx.chatId, `Reading "${query}"...`);

    try {
      const files = await searchFiles(query);
      if (files.length === 0) {
        await this.respond(ctx.chatId, `No file found matching "${query}".`);
        return { success: true, message: 'Not found', confidence: 'HIGH' };
      }

      const file = files[0];
      const content = await readFileContent(file);

      if (!content) {
        await this.respond(ctx.chatId, `*${file.name}*\n\nCan't read content (binary or unsupported format).\n${file.webViewLink}`);
        return { success: true, message: 'Unreadable', confidence: 'MEDIUM' };
      }

      const summary = await generateText(
        `File: "${file.name}"\n\nContent:\n${content.slice(0, 6000)}\n\nProvide a clear, detailed summary of what this document contains and its key information.`,
        'You are StandMe Brain reading a business document. Extract the key facts, decisions, and actionable info.',
        800
      );

      // Save this reading to the knowledge base
      const knowledge = await this.extractKnowledge(file, content, null, '');
      if (knowledge) await saveKnowledge(knowledge);

      await this.respond(ctx.chatId, `📄 *${file.name}*\n${file.webViewLink}\n\n${summary}`);
      return { success: true, message: `Read ${file.name}`, confidence: 'HIGH' };

    } catch (err: any) {
      await this.respond(ctx.chatId, `Failed to read file: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }
  }

  // ---- /knowledge command — query the knowledge base ----

  private async queryKnowledge(ctx: AgentContext): Promise<AgentResponse> {
    const query = ctx.args.trim();
    if (!query) {
      await this.respond(ctx.chatId, 'Usage: /knowledge [search term]\n\nSearches the knowledge base built from all Drive files, Trello, and other sources.');
      return { success: false, message: 'No query', confidence: 'LOW' };
    }

    const entries = await searchKnowledge(query, 10);

    if (entries.length === 0) {
      await this.respond(ctx.chatId, `No knowledge found for "${query}". Run /indexdrive to build the knowledge base.`);
      return { success: true, message: 'No results', confidence: 'HIGH' };
    }

    let response = `*Knowledge base results for "${query}":*\n\n`;
    response += entries.map(e =>
      `🧠 *${e.topic}* [${e.sourceType}]\n${e.content}\n_Tags: ${e.tags}_`
    ).join('\n\n');

    await this.respond(ctx.chatId, response);
    return { success: true, message: `${entries.length} knowledge entries found`, confidence: 'HIGH' };
  }

  // ---- Helpers ----

  private categorizeFile(file: DriveFile): string {
    const name = file.name.toLowerCase();
    const mime = file.mimeType.toLowerCase();

    if (name.includes('brief') || name.includes('concept')) return 'Brief';
    if (name.includes('proposal') || name.includes('quote') || name.includes('offer')) return 'Proposal';
    if (name.includes('contract') || name.includes('agreement')) return 'Contract';
    if (name.includes('contractor') || name.includes('supplier')) return 'Contractor';
    if (name.includes('lesson') || name.includes('review') || name.includes('debrief')) return 'Lessons Learned';
    if (name.includes('design') || name.includes('render') || name.includes('3d')) return 'Design';
    if (name.includes('invoice') || name.includes('payment') || name.includes('finance')) return 'Finance';
    if (name.includes('photo') || name.includes('image') || name.includes('stand')) return 'Portfolio';
    if (name.includes('manual') || name.includes('guide') || name.includes('info')) return 'Organiser Info';
    if (mime.includes('pdf')) return 'PDF Document';
    if (mime.includes('spreadsheet') || mime.includes('excel')) return 'Spreadsheet';
    return 'Other';
  }

  private friendlyType(mimeType: string): string {
    const map: Record<string, string> = {
      'application/vnd.google-apps.document': 'Google Doc',
      'application/vnd.google-apps.spreadsheet': 'Google Sheet',
      'application/vnd.google-apps.presentation': 'Google Slides',
      'application/vnd.google-apps.folder': 'Folder',
      'application/pdf': 'PDF',
      'image/jpeg': 'Image',
      'image/png': 'Image',
    };
    return map[mimeType] || mimeType.split('/').pop() || 'File';
  }

  private matchToProject(file: DriveFile, companyNames: string[]): string | null {
    const fileName = file.name.toLowerCase();
    for (const company of companyNames) {
      if (company && company.length > 2 && fileName.includes(company)) {
        return company;
      }
    }
    return null;
  }
}
