#!/usr/bin/env node
import { auditTargets } from './index.js';
import { loadTargetsFromArgs } from './targets.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    printHelp();
    return;
  }

  const targets = await loadTargetsFromArgs(args);
  const result = await auditTargets(targets, {
    outDir: args.out || 'reports',
    maxTabs: Number(args['max-tabs'] || 30),
    viewport: parseViewport(args.viewport),
    headful: Boolean(args.headful),
    ai: {
      enabled: Boolean(args.ai) && !args['no-ai'],
    },
  });

  for (const report of result.reports) {
    console.log(`A11y report: ${report.reportPath}`);
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }
  return args;
}

function parseViewport(value) {
  if (!value) {
    return { width: 1440, height: 1000 };
  }

  const match = String(value).match(/^(\d+)x(\d+)$/);
  if (!match) {
    throw new Error('--viewport must use WIDTHxHEIGHT, for example 1440x1000');
  }

  return { width: Number(match[1]), height: Number(match[2]) };
}

function printHelp() {
  console.log(`
a11y-audit - WCAG 2.2 AA oriented accessibility audit MVP

Usage:
  npm run audit -- --url https://example.com --name "Home page"
  npm run audit -- --scenario ./a11y.scenario.example.json

Options:
  --url <url>              Target URL. Supports http(s) and file URLs.
  --name <name>            Human readable page name.
  --notes <text>           Test account, environment, or QA notes.
  --scenario <file>        JSON scenario file with one or more targets.
  --out <dir>              Output directory. Default: reports.
  --max-tabs <number>      Keyboard Tab traversal depth. Default: 30.
  --viewport <WxH>         Browser viewport. Default: 1440x1000.
  --headful                Run Chromium with a visible browser window.
  --ai                     Enable Gemini AI semantic review for this run.
  --no-ai                  Disable Gemini AI semantic review.
  --help                   Show this help.
`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
