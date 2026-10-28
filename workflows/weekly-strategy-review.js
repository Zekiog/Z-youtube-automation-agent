/**
 * Weekly Strategy Review Workflow
 *
 * Pulls the past 7 days of analytics, ranks videos by performance,
 * and emits a recommendations list to the database + log. Called by
 * schedules/daily-automation.js on Sundays at 08:00.
 *
 * Trigger manually: `npm run workflow:weekly`
 */

const { Logger } = require('../utils/logger');
const { Database } = require('../database/db');
const { AnalyticsOptimizationAgent } = require('../agents/analytics-optimization-agent');
const { CredentialManager } = require('../utils/credential-manager');

const log = new Logger('WeeklyWorkflow');

async function runWeeklyReview() {
  log.info('Starting weekly strategy review');

  const db = new Database();
  await db.initialize();
  const credentials = new CredentialManager();
  await credentials.initialize();
  const analytics = new AnalyticsOptimizationAgent(db, credentials);
  await analytics.initialize();

  const history = await db.getAnalyticsHistory({ days: 7 });
  if (!history || history.length === 0) {
    log.warn('No analytics history in the past 7 days; skipping review');
    return { ok: true, videosReviewed: 0 };
  }

  let reviewed = 0;
  for (const record of history) {
    try {
      await analytics.analyzeVideoPerformance(record.videoId);
      reviewed++;
    } catch (err) {
      log.error(`Failed to analyze ${record.videoId}: ${err.message}`);
    }
  }

  log.info(`Weekly review complete: ${reviewed} video(s) analyzed`);
  return { ok: true, videosReviewed: reviewed };
}

if (require.main === module) {
  runWeeklyReview().then(r => {
    process.exit(r.ok ? 0 : 1);
  });
}

module.exports = { runWeeklyReview };
