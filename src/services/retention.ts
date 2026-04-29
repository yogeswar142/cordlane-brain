import { UserEvent } from '../models';
import type { RetentionCohortRow } from '../models/BotRetentionStats';

type ComputeRetentionOptions = {
  now?: Date;
};

// Compute 5 weekly retention cohorts (w=4..0) for a single bot.
// This logic used to live inside `getBotSummary` request path.
export async function computeRetentionData(
  botId: string,
  options: ComputeRetentionOptions = {}
): Promise<RetentionCohortRow[]> {
  const now = options.now ?? new Date();
  const retentionData: RetentionCohortRow[] = [];

  // w = 4..0 => 5 cohorts
  for (let w = 4; w >= 0; w--) {
    const cohortStart = new Date(now.getTime() - (w + 1) * 7 * 24 * 60 * 60 * 1000);
    const cohortEnd = new Date(now.getTime() - w * 7 * 24 * 60 * 60 * 1000);
    const cohortLabel = cohortStart.toISOString().split('T')[0];

    // Users first seen within the cohort window (week)
    const firstSeenPipeline = await UserEvent.aggregate([
      { $match: { botId, timestamp: { $gte: cohortStart, $lt: cohortEnd } } },
      { $group: { _id: '$userId', firstSeen: { $min: '$timestamp' } } },
      { $match: { firstSeen: { $gte: cohortStart, $lt: cohortEnd } } },
    ]);

    const cohortUsers: string[] = firstSeenPipeline.map((u: any) => u._id);
    const totalUsers = cohortUsers.length;

    if (totalUsers === 0) {
      retentionData.push({ cohort: cohortLabel, totalUsers: 0, day1: 0, day7: 0, day30: 0 });
      continue;
    }

    const [day1Returned, day7Returned, day30Returned] = await Promise.all([
      UserEvent.distinct('userId', {
        botId,
        userId: { $in: cohortUsers },
        timestamp: { $gte: cohortEnd, $lt: new Date(cohortEnd.getTime() + 24 * 60 * 60 * 1000) },
      }),
      UserEvent.distinct('userId', {
        botId,
        userId: { $in: cohortUsers },
        timestamp: {
          $gte: new Date(cohortEnd.getTime() + 6 * 24 * 60 * 60 * 1000),
          $lt: new Date(cohortEnd.getTime() + 8 * 24 * 60 * 60 * 1000),
        },
      }),
      UserEvent.distinct('userId', {
        botId,
        userId: { $in: cohortUsers },
        timestamp: {
          $gte: new Date(cohortEnd.getTime() + 29 * 24 * 60 * 60 * 1000),
          $lt: new Date(cohortEnd.getTime() + 31 * 24 * 60 * 60 * 1000),
        },
      }),
    ]);

    retentionData.push({
      cohort: cohortLabel,
      totalUsers,
      day1: Math.round((day1Returned.length / totalUsers) * 100),
      day7: Math.round((day7Returned.length / totalUsers) * 100),
      day30: Math.round((day30Returned.length / totalUsers) * 100),
    });
  }

  return retentionData;
}

