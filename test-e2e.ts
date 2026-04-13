import { CordiaClient } from 'cordia';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { CommandEvent } from './src/models/CommandEvent';
import { UserEvent } from './src/models/UserEvent';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || '';
const BOT_ID = '987654321098765432';
const API_KEY = 'cordia_a63ab22964580bb8eb2fdf8c63761cb374ac8ca86ce94bcd';

const testCordia = async () => {
  console.log('🔄 1. Connecting to DB directly to verify later...');
  await mongoose.connect(MONGO_URI);
  
  // Wipe old test data
  await CommandEvent.deleteMany({ botId: BOT_ID });
  await UserEvent.deleteMany({ botId: BOT_ID });
  
  console.log(`✅ DB wiped. Proceeding with SDK test on botId: ${BOT_ID}\n`);

  // Initialize the SDK targeting the API currently running!
  console.log('🔄 2. Initializing Cordia SDK...');
  const cordia = new CordiaClient({
    apiKey: API_KEY,
    botId: BOT_ID,
    baseUrl: 'https://cordlane-brain.onrender.com/api/v1', // Pointing SDK here!
    batchSize: 2,           // Force small batches for fast sending
    flushInterval: 2000,    // Force 2 second flushes
    autoHeartbeat: true     // Ping heartbeat!
  });

  console.log('✅ SDK Initialized!');
  
  console.log('\n🔄 3. Tracking test events...');
  
  // Fake User interaction
  cordia.trackUser({
    userId: '123_user',
    action: 'message_sent'
  });

  // Fake Command execution
  cordia.trackCommand({
    command: 'test-command',
    userId: '123_user',
    metadata: { flag: 'debug_mode' }
  });

  // Manually force a push to the localhost server
  console.log('🔄 4. Force flushing queue to localhost:5000...');
  await cordia.flush();
  
  console.log('✅ SDK Queue flushed!');
  
  // Wait a second for Express and Mongoose to capture data
  await new Promise(r => setTimeout(r, 1500));

  console.log('\n🔄 5. Checking MongoDB Database for traces of SDK data...');
  const commands = await CommandEvent.countDocuments();
  const users = await UserEvent.countDocuments();
  
  if (commands >= 1 && users >= 1) {
    console.log(`\n🎉 E2E TEST PASSED SUCCESS!`);
    console.log(`✅ API successfully received data from the SDK and saved to MongoDB.`);
  } else {
    console.log(`\n❌ TEST FAILED. API did not save everything.`);
    console.log(`Commands found: ${commands}, Users found: ${users}`);
  }

  // Graceful shutdown
  await cordia.destroy();
  await mongoose.disconnect();
  console.log('Test process exit.');
  process.exit(0);
};

testCordia();
