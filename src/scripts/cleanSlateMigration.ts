import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Bot, CommandEvent, Heartbeat, GuildCount, LegacyStats } from '../models';
import { CommandEventArchive } from '../models/CommandEventArchive';
import { GuildCountArchive } from '../models/GuildCountArchive';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/cordia';

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log(`✅ Connected to MongoDB: ${MONGO_URI}`);
  console.log('🚀 Starting Clean Slate Migration...');

  const bots = await Bot.find({}).lean();
  console.log(`ℹ️ Found ${bots.length} bots to process.`);

  for (const bot of bots) {
    const botId = bot.botId;
    console.log(`\n📦 Processing Bot: ${bot.name} (${botId})`);

    // 1. Calculate Lifetime Totals
    const [totalCommands, uniqueUserIds] = await Promise.all([
      CommandEvent.countDocuments({ botId }),
      CommandEvent.distinct('userId', { botId })
    ]);

    console.log(`   - Lifetime Commands: ${totalCommands}`);
    console.log(`   - Lifetime Unique Users: ${uniqueUserIds.length}`);

    // 2. Save to LegacyStats
    await LegacyStats.findOneAndUpdate(
      { botId },
      { 
        totalCommands, 
        totalUniqueUsers: uniqueUserIds.length,
        migratedAt: new Date()
      },
      { upsert: true }
    );
    console.log(`   ✅ Saved to LegacyStats`);
  }

  // 3. WIPE ALL RAW TELEMETRY
  console.log('\n🗑️ Wiping raw telemetry collections...');
  
  await Promise.all([
    CommandEvent.deleteMany({}),
    Heartbeat.deleteMany({}),
    GuildCount.deleteMany({}),
    CommandEventArchive.deleteMany({}),
    GuildCountArchive.deleteMany({}),
    // UserEvent was already handled in previous cleanup
  ]);

  console.log('✅ Wipe complete.');
  console.log('\n✨ Clean Slate Migration Finished Successfully!');
  
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('❌ Migration failed:', err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
