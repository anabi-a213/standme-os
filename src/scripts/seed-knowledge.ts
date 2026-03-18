/**
 * Knowledge Base Seed Script
 *
 * Populates the Google Sheets KNOWLEDGE_BASE tab with curated StandMe +
 * exhibition industry knowledge so ALL 17 agents start with deep context.
 *
 * Run with:
 *   npx ts-node src/scripts/seed-knowledge.ts
 *
 * Or trigger via Telegram: /brain seed the knowledge base
 * (Brain agent has a /seedknowledge admin command)
 *
 * Safe to re-run — it checks for existing entries by source name to avoid duplicates.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../../.env') });

import { saveKnowledge, searchKnowledge } from '../services/knowledge';
import { KNOWLEDGE_SEED } from '../config/standme-knowledge';

async function seedKnowledgeBase(): Promise<void> {
  console.log(`\n🧠 StandMe Knowledge Base Seeder`);
  console.log(`   Seeding ${KNOWLEDGE_SEED.length} curated knowledge entries...\n`);

  let added = 0;
  let skipped = 0;

  for (const entry of KNOWLEDGE_SEED) {
    try {
      // Check if an entry from this source already exists (avoid duplicates)
      const existing = await searchKnowledge(entry.source, 1);
      const alreadyExists = existing.some(e => e.source === entry.source);

      if (alreadyExists) {
        console.log(`   ⏭  SKIP: "${entry.source}" already in KB`);
        skipped++;
        continue;
      }

      await saveKnowledge(entry);
      console.log(`   ✅ ADDED: [${entry.topic}] ${entry.source}`);
      added++;

      // Small delay to avoid hitting API rate limits
      await new Promise(resolve => setTimeout(resolve, 300));

    } catch (err: any) {
      console.error(`   ❌ FAILED: "${entry.source}": ${err.message}`);
    }
  }

  console.log(`\n📊 Seed complete:`);
  console.log(`   Added:   ${added} entries`);
  console.log(`   Skipped: ${skipped} (already existed)`);
  console.log(`   Total:   ${KNOWLEDGE_SEED.length} entries in seed file\n`);

  if (added > 0) {
    console.log(`✅ Knowledge base seeded. All 17 agents now have deep StandMe + industry context.`);
  } else {
    console.log(`ℹ️  Nothing new to add — knowledge base is already up to date.`);
  }
}

// Run it
seedKnowledgeBase().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
