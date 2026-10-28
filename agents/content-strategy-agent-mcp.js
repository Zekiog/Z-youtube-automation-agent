/**
 * Content Strategy Agent — MCP Server
 *
 * Exposes the content-strategy-agent capabilities as MCP tools so
 * any MCP-compatible client (Claude Desktop, IDE plugins, other
 * agents) can call them via JSON-RPC over stdio.
 *
 * Tools (declared in mcp/content-strategy-agent.mcp.json):
 *   - analyze_trends(region?, category?)
 *   - generate_strategy(topic?, targetAudience?)
 *   - analyze_competitors(channelIds[])
 *   - predict_performance(topic, publishTime?)
 *   - get_content_calendar(days?)
 *
 * Usage from the manifest:
 *   "command": "node", "args": ["../agents/content-strategy-agent-mcp.js"]
 *
 * Owner gate: YouTube Data API v3 credentials must be configured
 * via `npm run credentials:setup` for live data. Without creds,
 * the server boots but tools return graceful empty results.
 */

const path = require('path');

// stdout is reserved exclusively for JSON-RPC messages (MCP stdio transport).
// Every application log line has to go to stderr, otherwise an MCP client
// reads log output as protocol messages and fails to initialize.
process.env.LOG_CONSOLE_STREAM = 'stderr';

// MCP stdio transport: read JSON-RPC from stdin, write to stdout
// Lines are newline-delimited JSON objects.
function readStdin() {
  return require('readline').createInterface({ input: process.stdin });
}

// MCP tool results use the `content` array format. A tool execution failure is
// reported with `isError: true` (MCP protocol version 2024-11-05).
function toToolResult(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  const result = { content: [{ type: 'text', text }] };
  if (payload && payload.ok === false) result.isError = true;
  return result;
}

async function bootstrap() {
  // Lazy-load heavy deps only when MCP server actually runs
  const { ContentStrategyAgent } = require('./content-strategy-agent');
  const { Database } = require('../database/db');
  const { CredentialManager } = require('../utils/credential-manager');
  const { Logger } = require('../utils/logger');

  const log = new Logger('MCP-ContentStrategy');
  const db = new Database();
  await db.initialize();
  const credentials = new CredentialManager();
  await credentials.initialize();
  const agent = new ContentStrategyAgent(db, credentials);
  await agent.initialize();

  const tools = {
    analyze_trends: async ({ region, category } = {}) => {
      let youtube;
      try {
        // getYouTubeClient() throws when credentials or tokens are missing.
        youtube = credentials.getYouTubeClient();
      } catch (err) {
        return { ok: false, error: 'youtube_credentials_missing', message: err.message, trends: [] };
      }
      if (!youtube) {
        return { ok: false, error: 'youtube_credentials_missing', trends: [] };
      }
      const r = await youtube.videos.list({
        part: 'snippet,statistics',
        chart: 'mostPopular',
        maxResults: 50,
        regionCode: region || process.env.YOUTUBE_REGION || 'US'
      });
      let items = (r.data.items || []).map(v => ({
        title: v.snippet.title,
        viewCount: parseInt(v.statistics.viewCount || '0', 10),
        category: v.snippet.categoryId,
        publishedAt: v.snippet.publishedAt
      }));
      if (category) items = items.filter(i => i.category === category);
      return { ok: true, count: items.length, trends: items };
    },

    generate_strategy: async ({ topic, targetAudience } = {}) => {
      const strategy = await agent.generateContentStrategy(topic);
      if (targetAudience) strategy.target_audience = targetAudience;
      return { ok: true, strategy };
    },

    analyze_competitors: async ({ channelIds } = {}) => {
      if (!Array.isArray(channelIds) || channelIds.length === 0) {
        return { ok: false, error: 'channelIds_required' };
      }
      const results = [];
      for (const id of channelIds) {
        try {
          const analysis = await agent.analyzeCompetitors([id]);
          results.push({ channelId: id, analysis });
        } catch (err) {
          results.push({ channelId: id, error: err.message });
        }
      }
      return { ok: true, results };
    },

    predict_performance: async ({ topic, publishTime } = {}) => {
      if (!topic) return { ok: false, error: 'topic_required' };
      // Lightweight heuristic: trending-topic overlap with topic keywords
      const trends = await tools.analyze_trends({});
      if (!trends.ok) return trends;
      const keywords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const overlap = trends.trends.filter(t =>
        keywords.some(k => t.title.toLowerCase().includes(k))
      ).length;
      return {
        ok: true,
        topic,
        publishTime: publishTime || null,
        predictedScore: Math.min(100, Math.round((overlap / Math.max(1, trends.trends.length)) * 100 * 4)),
        trendingOverlap: overlap,
        totalTrends: trends.trends.length
      };
    },

    get_content_calendar: async ({ days } = {}) => {
      const n = Math.max(1, Math.min(30, days || 7));
      const calendar = await agent.getContentCalendar(n);
      return { ok: true, days: n, calendar };
    }
  };

  const rl = readStdin();
  log.info('MCP content-strategy server ready (stdio JSON-RPC)');

  rl.on('line', async (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const { id, method, params } = msg;

    // Notifications carry no id and must never be answered. The MCP client
    // sends notifications/initialized after initialization and does not wait
    // for a response.
    if (method === 'notifications/initialized') return;
    if (id === undefined || id === null) return;

    if (method === 'initialize') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'content-strategy-agent', version: '1.0.0' },
          capabilities: { tools: {} }
        }
      }) + '\n');
      return;
    }
    if (method === 'tools/list') {
      const fs = require('fs');
      const manifest = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', 'mcp', 'content-strategy-agent.mcp.json'), 'utf8')
      );
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { tools: manifest.capabilities.tools } }) + '\n');
      return;
    }
    if (method === 'tools/call') {
      const toolName = params && params.name;
      const args = (params && params.arguments) || {};
      const fn = tools[toolName];
      if (!fn) {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'tool_not_found' } }) + '\n');
        return;
      }
      try {
        const payload = await fn(args);
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: toToolResult(payload) }) + '\n');
      } catch (err) {
        // A failed tool execution is reported inside the tool result with
        // isError: true; JSON-RPC errors are reserved for protocol problems.
        const payload = { ok: false, error: err.message };
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: toToolResult(payload) }) + '\n');
      }
      return;
    }
    // Unknown method
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method_not_found' } }) + '\n');
  });
}

bootstrap().catch(err => {
  process.stderr.write(`MCP server fatal: ${err.stack || err.message}\n`);
  process.exit(1);
});
