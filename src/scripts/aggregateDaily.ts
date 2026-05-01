import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Bot, CommandEvent, Heartbeat, GuildCount, DailySummary } from '../models';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/cordia';
const SAFETY_WINDOW_HOURS = 48; // Keep raw data for 48 hours

async function aggregateForBot(botId: string, date: Date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  const dateStr = startOfDay.toISOString().split('T')[0];

  console.log(`   - Aggregating for ${dateStr}`);

  // 1. Core Counts
  const [commands, uniqueUserIds] = await Promise.all([
    CommandEvent.countDocuments({ botId, timestamp: { $gte: startOfDay, $lte: endOfDay } }),
    CommandEvent.distinct('userId', { botId, timestamp: { $gte: startOfDay, $lte: endOfDay } })
  ]);

  if (commands === 0) {
    console.log(`     (No activity found)`);
    return;
  }

  // 2. Distributions (Top 10 Servers & Top 10 Commands)
  const [topCommandsAgg, topServersAgg, localesAgg] = await Promise.all([
    CommandEvent.aggregate([
      { $match: { botId, timestamp: { $gte: startOfDay, $lte: endOfDay } } },
      { $group: { _id: '$command', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]),
    CommandEvent.aggregate([
      { $match: { botId, timestamp: { $gte: startOfDay, $lte: endOfDay } } },
      { $group: { _id: '$guildId', name: { $first: '$guildName' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]),
    CommandEvent.aggregate([
      { $match: { botId, timestamp: { $gte: startOfDay, $lte: endOfDay } } },
      { $group: { _id: '$locale', count: { $sum: 1 } } }
    ])
  ]);

  // 3. Uptime
  const heartbeats = await Heartbeat.countDocuments({ botId, timestamp: { $gte: startOfDay, $lte: endOfDay } });
  // Expected heartbeats in 24h (1 every 30s) = 2880
  const uptime = Math.min(100, (heartbeats / 2880) * 100);

  // 4. Locales Record
  const localeMap: Record<string, number> = {};
  localesAgg.forEach(l => {
    if (l._id) localeMap[l._id] = l.count;
  });

  // 5. Upsert Summary
  await DailySummary.findOneAndUpdate(
    { botId, date: dateStr },
    {
      commands,
      dau: uniqueUserIds.length,
      topCommands: topCommandsAgg.map(c => ({ command: c._id, count: c.count })),
      topServers: topServersAgg.map(s => ({ guildId: s._id, name: s.name || 'Unknown Server', count: s.count })),
      locales: localeMap,
      uptime
    },
    { upsert: true }
  );

  console.log(`     ✅ Summary saved.`);
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log(`✅ Connected to MongoDB`);

  // Target "Yesterday"
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const bots = await Bot.find({}).lean();
  console.log(`🚀 Starting Daily Aggregation for ${bots.length} bots...`);

  for (const bot of bots) {
    console.log(`\n📦 Bot: ${bot.name} (${bot.botId})`);
    await aggregateForBot(bot.botId, yesterday);
  }

  // 🗑️ CLEANUP: Remove old raw data
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - SAFETY_WINDOW_HOURS);

  console.log(`\n🗑️ Cleaning up raw telemetry older than ${SAFETY_WINDOW_HOURS}h...`);
  const delRes = await Promise.all([
    CommandEvent.deleteMany({ timestamp: { $lt: cutoff } }),
    Heartbeat.deleteMany({ timestamp: { $lt: cutoff } }),
    GuildCount.deleteMany({ timestamp: { $lt: cutoff } })
  ]);
  
  console.log(`   ✅ Deleted ${delRes[0].deletedCount} commands, ${delRes[1].deletedCount} heartbeats.`);

  console.log('\n✨ Nightly Aggregation Finished.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('❌ Aggregation failed:', err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
