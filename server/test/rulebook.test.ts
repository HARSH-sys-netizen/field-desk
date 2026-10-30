import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { crmActionSchema } from '@crm/shared/crm';
import { RULEBOOK } from '../src/rules/rulebook.js';
import { REACTIONS, assertReactionOrder } from '../src/rules/reactions.js';
import { renderRulebook, scenarioCounts } from '../src/scripts/rules-report.js';

describe('Rulebook', () => {
  it('has exactly one rule per command in the API contract', () => {
    const commands = crmActionSchema.options.map(
      (option) => option.shape.type.value,
    );
    assert.deepEqual(Object.keys(RULEBOOK).sort(), [...commands].sort());
  });

  it('grants the same roles as the business terms', () => {
    const terms = readFileSync(
      resolve('../docs/candidate-walkthrough/business_terms.md'),
      'utf8',
    );
    const names: Record<string, string> = {
      Sales: 'SALES',
      KAM: 'KAM',
      Warehouse: 'WAREHOUSE',
      Accounts: 'ACCOUNTS',
    };
    for (const [type, rule] of Object.entries(RULEBOOK)) {
      const row = terms
        .split('\n')
        .find((line) => line.startsWith(`| \`${type}\``));
      assert.ok(row, `${type} is missing from business_terms.md`);
      const roles = row
        .split('|')[2]!
        .split(',')
        .map((name) => names[name.trim()]);
      assert.deepEqual([...rule.who].sort(), roles.sort(), type);
    }
  });

  it('keeps the generated rulebook document current', () => {
    const committed = readFileSync(
      resolve('../docs/solution/rulebook.md'),
      'utf8',
    );
    assert.equal(
      committed,
      renderRulebook(),
      'Run pnpm rules:report and commit docs/solution/rulebook.md',
    );
  });

  it('cites only rules that exist in the canonical rules document', () => {
    const canonical = readFileSync(
      resolve('../docs/candidate-walkthrough/canonical_business_rules.md'),
      'utf8',
    );
    const exists = (id: string) => canonical.includes(`**${id}. `);
    for (const [type, rule] of Object.entries(RULEBOOK)) {
      for (const id of rule.cites) assert.ok(exists(id), `${type} cites ${id}`);
      for (const guard of rule.when) {
        assert.ok(exists(guard.rule), `${type} guard cites ${guard.rule}`);
        assert.ok(guard.says.length > 10);
      }
    }
  });

  it('orders reactions so one pass reaches a fixed point', () => {
    assert.doesNotThrow(assertReactionOrder);
    assert.ok(REACTIONS.points.watches.includes('payment_allocations'));
  });

  it('prunes the naive scenario space by orders of magnitude', () => {
    const counts = scenarioCounts();
    assert.equal(counts.naive, 5 * 22 * 768);
    assert.ok(counts.pruned < counts.naive / 100);
  });
});
