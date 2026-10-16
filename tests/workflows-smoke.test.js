/**
 * Workflow stub smoke tests
 *
 * Verifies that the new workflows/ stubs are importable and their
 * exported functions are callable. Does NOT run them end-to-end
 * (that requires credentials); just checks the API surface.
 */

const path = require('path');
process.chdir(path.join(__dirname, '..'));

let pass = 0, fail = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    pass++;
  } catch (err) {
    console.log(`  FAIL ${name}: ${err.message}`);
    fail++;
  }
}

check('daily-content-pipeline exports runDailyPipeline', () => {
  const m = require('../workflows/daily-content-pipeline');
  if (typeof m.runDailyPipeline !== 'function') throw new Error('runDailyPipeline not a function');
});

check('weekly-strategy-review exports runWeeklyReview', () => {
  const m = require('../workflows/weekly-strategy-review');
  if (typeof m.runWeeklyReview !== 'function') throw new Error('runWeeklyReview not a function');
});

check('MCP server file exists and is non-empty', () => {
  const fs = require('fs');
  const p = path.join(__dirname, '..', 'agents', 'content-strategy-agent-mcp.js');
  const s = fs.statSync(p);
  if (s.size < 100) throw new Error('MCP server file too small');
});

check('MCP manifest path in JSON is valid', () => {
  const m = require('../mcp/content-strategy-agent.mcp.json');
  if (!m.capabilities || !m.capabilities.tools) throw new Error('no capabilities.tools');
  if (!Array.isArray(m.capabilities.tools)) throw new Error('tools not an array');
  if (m.capabilities.tools.length !== 5) throw new Error(`expected 5 tools, got ${m.capabilities.tools.length}`);
});

console.log(`\n${pass}/${pass + fail} workflow checks passed`);
process.exit(fail > 0 ? 1 : 0);
