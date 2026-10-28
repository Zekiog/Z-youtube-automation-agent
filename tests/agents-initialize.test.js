/**
 * Agent initialization smoke tests
 *
 * Verifies that all 7 agents can be loaded and initialize() without
 * throwing. Does not exercise business logic — that requires
 * credentials + network. Run via: `node tests/agents-initialize.test.js`
 */

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const agents = [
  ['ContentStrategy',     '../agents/content-strategy-agent'],
  ['ScriptWriter',        '../agents/script-writer-agent'],
  ['ThumbnailDesigner',   '../agents/thumbnail-designer-agent'],
  ['SEOOptimizer',        '../agents/seo-optimizer-agent'],
  ['ProductionManagement','../agents/production-management-agent'],
  ['PublishingScheduling','../agents/publishing-scheduling-agent'],
  ['AnalyticsOptimization','../agents/analytics-optimization-agent']
];

async function run() {
  let pass = 0, fail = 0;
  const failures = [];

  for (const [name, mod] of agents) {
    try {
      // Stub DB and credentials to avoid network/disk in test
      const stubDb = {
        initialize: async () => {},
        getContentHistory: async () => [],
        getKeywordHistory: async () => [],
        getProductionPipeline: async () => [],
        getPublishQueue: async () => [],
        getAnalyticsHistory: async () => [],
        getUpcomingSchedule: async () => []
      };
      const stubCred = {
        initialize: async () => true,
        getYouTubeClient: () => null,
        getYouTubeAuth: () => ({}),
        validateAll: async () => true
      };

      const mod_exports = require(mod);
      const Cls = mod_exports[name + 'Agent'] || mod_exports.default || Object.values(mod_exports).find(v => typeof v === 'function');
      if (!Cls) throw new Error(`class not exported from ${mod}`);
      const inst = new Cls(stubDb, stubCred);
      await inst.initialize();
      console.log(`  ok  ${name}`);
      pass++;
    } catch (err) {
      console.log(`  FAIL ${name}: ${err.message}`);
      failures.push({ name, error: err.message });
      fail++;
    }
  }

  console.log(`\n${pass}/${pass + fail} agents initialized cleanly`);
  if (fail > 0) {
    console.log('Failures:');
    for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(2);
});
