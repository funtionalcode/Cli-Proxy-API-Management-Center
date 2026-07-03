import { describe, expect, it } from 'vitest';
import {
  parsePayloadRules,
  serializePayloadRulesForYaml,
} from './visualConfigPayloadRules';

describe('visual config payload rules', () => {
  it('preserves advanced model match fields through parse and serialize', () => {
    const rules = parsePayloadRules([
      {
        models: [
          {
            name: 'gpt-5.4',
            protocol: 'openai',
            'from-protocol': 'responses',
            headers: {
              'x-client': 'codex',
            },
            match: [{ 'metadata.team': 'alpha' }],
            'not-match': [{ 'metadata.blocked': true }],
            exist: ['metadata.trace_id'],
            'not-exist': ['metadata.skip'],
          },
        ],
        params: {
          temperature: 0.2,
        },
      },
    ]);

    const serialized = serializePayloadRulesForYaml(rules);

    const model = serialized[0].models as Array<Record<string, unknown>>;

    expect(model[0]).toMatchObject({
      name: 'gpt-5.4',
      protocol: 'openai',
      'from-protocol': 'responses',
      headers: {
        'x-client': 'codex',
      },
      match: [{ 'metadata.team': 'alpha' }],
      'not-match': [{ 'metadata.blocked': true }],
      exist: ['metadata.trace_id'],
      'not-exist': ['metadata.skip'],
    });
  });
});
