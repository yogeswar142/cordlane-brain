import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cron from 'node-cron';
import app from './app';
import { startShardMonitor } from './services/shardMonitor';
import { runDailyAggregation } from './scripts/aggregateDaily';

// Load environment variables from .env
dotenv.config();

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/cordia';

const startServer = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGO_URI);
    console.log(`✅ Connected to MongoDB at ${MONGO_URI}`);

    // Start Express listener
    app.listen(PORT, () => {
      console.log(`🚀 Cordia API server is running on http://localhost:${PORT}`);
    });

    // ─── BACKGROUND TASKS ───

    // 1. Start the background shard health monitor for webhook alerts
    startShardMonitor();

    // 2. Schedule Nightly Aggregation & Cleanup (Runs at 00:05 every night)
    cron.schedule('5 0 * * *', async () => {
      console.log('⏰ Running Nightly Aggregation & Cleanup...');
      try {
        await runDailyAggregation();
        console.log('✅ Nightly Aggregation completed successfully.');
      } catch (err) {
        console.error('❌ Nightly Aggregation failed:', err);
      }
    });

    console.log('📅 Nightly Aggregation scheduled for 00:05 AM');

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

