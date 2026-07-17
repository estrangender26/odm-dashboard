import { config } from 'dotenv';
config();

import { eq, and, lt } from 'drizzle-orm';
import { db } from '../api/queries/connection';
import { storageUploadIntents } from '../db/schema';
import { getSupabaseStorageAdmin } from '../api/supabase-storage';

const DRY_RUN = process.env.DRY_RUN === 'true';
const GRACE_PERIOD_HOURS = parseInt(process.env.GRACE_PERIOD_HOURS || '24', 10);

async function runCleanup() {
  console.log(`[cleanup] Starting ${DRY_RUN ? 'DRY RUN' : 'LIVE'} cleanup`);
  console.log(`[cleanup] Grace period: ${GRACE_PERIOD_HOURS} hours`);
  
  const cutoff = new Date(Date.now() - GRACE_PERIOD_HOURS * 60 * 60 * 1000);
  
  // Find expired pending intents
  const expiredIntents = await db.select()
    .from(storageUploadIntents)
    .where(and(
      eq(storageUploadIntents.status, 'pending'),
      lt(storageUploadIntents.expiresAt, cutoff)
    ))
    .limit(100);
  
  console.log(`[cleanup] Found ${expiredIntents.length} expired intents`);
  
  let deleted = 0;
  let failed = 0;
  let skipped = 0;
  
  for (const intent of expiredIntents) {
    try {
      if (DRY_RUN) {
        console.log(`[cleanup] DRY RUN: Would process intent ${intent.id}`);
        skipped++;
      } else if (intent.expectedBucket && intent.expectedPath) {
        const { error } = await getSupabaseStorageAdmin()
          .storage.from(intent.expectedBucket)
          .remove([intent.expectedPath]);
          
        if (error) {
          console.error(`[cleanup] Failed to delete ${intent.expectedPath}: ${error.message}`);
          failed++;
          continue;
        }
        deleted++;
      }
      
      if (!DRY_RUN) {
        await db.update(storageUploadIntents)
          .set({ 
            status: 'abandoned',
            abandonedAt: new Date(),
            failureReason: 'Expired and cleaned up by cron'
          })
          .where(eq(storageUploadIntents.id, intent.id));
      }
    } catch (err) {
      console.error(`[cleanup] Error processing intent ${intent.id}:`, err);
      failed++;
    }
  }
  
  console.log(`[cleanup] Complete: ${deleted} deleted, ${failed} failed, ${skipped} dry-run`);
  
  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runCleanup().catch(err => {
  console.error('[cleanup] Fatal error:', err);
  process.exit(1);
});
