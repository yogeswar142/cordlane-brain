import dotenv from 'dotenv';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { Bot, AuditLog } from '../models';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/cordia';

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log(`✅ Connected to MongoDB`);
  console.log('🚀 Starting Global API Key Reset...');

  const bots = await Bot.find({}).lean();
  console.log(`ℹ️ Found ${bots.length} bots to reset.`);

  for (const bot of bots) {
    const botId = bot.botId;
    // Generate new secure key: cordia_ + 48 hex characters
    const newApiKey = "cordia_" + crypto.randomBytes(24).toString("hex");

    console.log(`📦 Resetting Bot: ${bot.name} (${botId})`);

    await Bot.updateOne(
      { botId },
      { 
        $set: { 
          apiKey: newApiKey,
          apiKeyLastGenerated: new Date()
        } 
      }
    );

    // Log the reset event
    await AuditLog.create({
      actorId: 'SYSTEM',
      actorType: 'system',
      action: 'api_key_reset_forced',
      targetType: 'bot',
      targetId: botId,
      metadata: { reason: 'Mandatory architectural upgrade to v1.2.2' }
    });

    console.log(`   ✅ New key generated and logged.`);
  }

  console.log('\n✨ Global API Key Reset Finished Successfully!');
  console.log('⚠️ IMPORTANT: All existing bot integrations are now DISCONNECTED until their owners update their keys.');
  
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('❌ Reset failed:', err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
