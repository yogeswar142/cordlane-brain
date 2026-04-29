import dotenv from 'dotenv';
import mongoose from 'mongoose';

import { CommandEvent, UserEvent, GuildCount } from '../models';
import { CommandEventArchive } from '../models/CommandEventArchive';
import { UserEventArchive } from '../models/UserEventArchive';
import { GuildCountArchive } from '../models/GuildCountArchive';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/cordia';

// TTL windows are configured on the hot collections:
// - Heartbeat: 48h (no archiving)
// - CommandEvent/UserEvent/GuildCount: 90d
const TTL_SECONDS = process.env.TELEMETRY_TTL_SECONDS
  ? Number(process.env.TELEMETRY_TTL_SECONDS)
  : 7776000; // 90d

// Grace factor to ensure we copy just before TTL makes items eligible for deletion.
const GRACE_HOURS = process.env.TELEMETRY_ARCHIVE_GRACE_HOURS ? Number(process.env.TELEMETRY_ARCHIVE_GRACE_HOURS) : 6;

const BATCH_SIZE = process.env.TELEMETRY_ARCHIVE_BATCH_SIZE ? Number(process.env.TELEMETRY_ARCHIVE_BATCH_SIZE) : 2000;
const DRY_RUN = process.env.TELEMETRY_ARCHIVE_DRY_RUN === 'true';

const cutoff = new Date(Date.now() - (TTL_SECONDS * 1000 - GRACE_HOURS * 60 * 60 * 1000));

async function archiveInBatches<TSource extends { _id: any; createdAt?: Date }>(
  sourceModel: any,
  archiveModel: any,
  query: any
) {
  while (true) {
    const docs: TSource[] = await sourceModel
      .find(query)
      .sort({ createdAt: 1 })
      .limit(BATCH_SIZE)
      .lean();

    if (!docs.length) break;

    const now = new Date();
    const docsToArchive = docs.map((d: any) => ({
      ...d,
      archivedAt: now,
    }));

    if (!DRY_RUN) {
      let shouldDeleteFromSource = true;
      try {
        await archiveModel.insertMany(docsToArchive, { ordered: false });
      } catch (err: any) {
        // Common case: already archived batches => duplicate key errors on _id.
        const message = String(err?.message ?? '');
        const looksLikeDuplicate = err?.code === 11000 || /duplicate key/i.test(message);
        console.warn(
          `[Archive] insertMany warning: ${err?.code || err?.name || 'unknown'}${looksLikeDuplicate ? ' (duplicates ok)' : ''};`
        );

        // Only delete from the hot collection if the insert failure is due to duplicates/idempotency.
        shouldDeleteFromSource = looksLikeDuplicate;
      }

      if (shouldDeleteFromSource) {
        const ids = docs.map((d: any) => d._id);
        await sourceModel.deleteMany({ _id: { $in: ids } });
      } else {
        throw new Error(`[Archive] insertMany failed for non-duplicate reasons; aborting batch for safety.`);
      }
    }

    console.log(`[Archive] ${archiveModel.modelName}: moved ${docs.length} docs`);
  }
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log(`✅ Connected to MongoDB: ${MONGO_URI}`);
  console.log(`ℹ️ Archiving docs with createdAt < ${cutoff.toISOString()} (TTL=${TTL_SECONDS}s, grace=${GRACE_HOURS}h)`);
  console.log(`ℹ️ DRY_RUN=${DRY_RUN}`);

  const baseQuery = { createdAt: { $lt: cutoff } };

  await archiveInBatches(CommandEvent, CommandEventArchive, baseQuery);
  await archiveInBatches(UserEvent, UserEventArchive, baseQuery);
  await archiveInBatches(GuildCount, GuildCountArchive, baseQuery);

  console.log('✅ Telemetry archiving finished.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Fatal archiving error:', err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});

