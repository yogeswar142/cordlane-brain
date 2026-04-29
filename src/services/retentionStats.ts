import { BotRetentionStats } from '../models';
import { computeRetentionData } from './retention';

type GetRetentionDataOptions = {
  freshnessMs: number;
};

export async function getRetentionData(
  botId: string,
  options: GetRetentionDataOptions
) {
  const { freshnessMs } = options;
  const now = Date.now();

  const existing = await BotRetentionStats.findOne({ botId }).lean();
  if (existing?.retentionData && existing?.computedAt) {
    const ageMs = now - new Date(existing.computedAt).getTime();
    if (ageMs >= 0 && ageMs <= freshnessMs) {
      return existing.retentionData as any[];
    }
  }

  const retentionData = await computeRetentionData(botId);

  // Best-effort persistence (don't fail request path if write fails).
  try {
    await BotRetentionStats.findOneAndUpdate(
      { botId },
      { $set: { computedAt: new Date(), retentionData } },
      { upsert: true, new: true }
    );
  } catch {
    // ignore
  }

  return retentionData as any[];
}

