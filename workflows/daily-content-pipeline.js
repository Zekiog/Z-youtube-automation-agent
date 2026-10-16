/**
 * Daily Content Pipeline Workflow
 *
 * Orchestrates the 6-agent content pipeline (strategy -> script ->
 * thumbnail -> SEO -> production -> publish) for one video per run.
 * Called by schedules/daily-automation.js at 06:00 daily and can
 * also be triggered manually: `npm run workflow:daily`
 */

const { Logger } = require('../utils/logger');
const { YouTubeAutomationAgent } = require('../index');

const log = new Logger('DailyWorkflow');

async function runDailyPipeline(options = {}) {
  const topic = options.topic || process.env.DAILY_TOPIC || null;
  const style = options.style || process.env.DAILY_STYLE || 'explainer';

  log.info(`Starting daily content pipeline (topic=${topic || 'auto'}, style=${style})`);

  const agent = new YouTubeAutomationAgent();
  const ok = await agent.initialize();
  if (!ok) {
    log.error('Initialization failed. Run: npm run credentials:setup');
    return { ok: false, reason: 'init_failed' };
  }

  try {
    const result = await agent.generateContent(topic, style);
    log.info(`Pipeline complete: ${result.title} (id=${result.contentId})`);
    return { ok: true, result };
  } catch (err) {
    log.error('Pipeline failed:', err);
    return { ok: false, reason: 'pipeline_error', error: err.message };
  }
}

if (require.main === module) {
  runDailyPipeline().then(r => {
    process.exit(r.ok ? 0 : 1);
  });
}

module.exports = { runDailyPipeline };
