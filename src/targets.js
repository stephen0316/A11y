import { readFile } from 'node:fs/promises';

export async function loadTargetsFromArgs(args) {
  if (args.scenario) {
    const scenario = JSON.parse(await readFile(args.scenario, 'utf8'));
    if (!Array.isArray(scenario.targets)) {
      throw new Error('Scenario file must contain a targets array.');
    }

    return scenario.targets.map(normalizeTarget);
  }

  if (!args.url) {
    return [];
  }

  return [
    normalizeTarget({
      url: args.url,
      name: args.name || args.url,
      notes: args.notes || '',
    }),
  ];
}

function normalizeTarget(target) {
  if (!target.url) {
    throw new Error('Every target must include url.');
  }

  return {
    url: target.url,
    name: target.name || target.url,
    notes: target.notes || '',
    steps: Array.isArray(target.steps) ? target.steps : [],
  };
}
