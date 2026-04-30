import dotenv from 'dotenv';
import mongoose from 'mongoose';

import { Bot, UserEvent, BotRetentionStats } from '../models';
import { computeRetentionData } from '../services/retention';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/cordia';
const MAX_BOTS_PER_RUN = process.env.RETENTION_MAX_BOTS_PER_RUN
  ? Number(process.env.RETENTION_MAX_BOTS_PER_RUN)
  : undefined;

// Retention uses cohorts over the past ~35 days, so we only compute for bots with recent event activity.
const ACTIVE_LOOKBACK_DAYS = Number(process.env.RETENTION_ACTIVE_LOOKBACK_DAYS || 35);

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log(`✅ Connected to MongoDB: ${MONGO_URI}`);

  // Bots with at least one user event in the lookback window.
  const lookbackStart = new Date(Date.now() - ACTIVE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  let botIds = (await UserEvent.distinct('botId', { timestamp: { $gte: lookbackStart } })) as string[];

  // Optional: only compute for verified bots to reduce load.
  const verifiedBotIds = await Bot.distinct('botId', { botId: { $in: botIds }, verified: true } as any);
  botIds = verifiedBotIds;

  if (MAX_BOTS_PER_RUN && botIds.length > MAX_BOTS_PER_RUN) {
    botIds = botIds.slice(0, MAX_BOTS_PER_RUN);
  }

  console.log(`ℹ️ Precomputing retention for ${botIds.length} bots...`);

  let completed = 0;
  for (const botId of botIds) {
    try {
      const retentionData = await computeRetentionData(botId);
      await BotRetentionStats.findOneAndUpdate(
        { botId },
        { $set: { computedAt: new Date(), retentionData } },
        { upsert: true, returnDocument: 'after' }
      );
      completed++;
      if (completed % 5 === 0) console.log(`✅ Completed ${completed}/${botIds.length}`);
    } catch (err) {
      console.error(`❌ Failed retention compute for bot ${botId}:`, err);
    }
  }

  console.log(`✅ Retention precompute finished. Bots completed: ${completed}/${botIds.length}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Fatal retention precompute error:', err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});

