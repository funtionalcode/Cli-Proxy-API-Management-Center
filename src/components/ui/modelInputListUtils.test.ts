import { describe, expect, it } from 'vitest';
import { areModelEntriesEqual } from '@/utils/compare';
import { entriesToModels, modelsToEntries } from './modelInputListUtils';

describe('modelInputListUtils', () => {
  it('preserves explicit empty modality arrays', () => {
    expect(
      entriesToModels([
        {
          name: 'image-model',
          alias: '',
          inputModalities: [],
          outputModalities: [],
        },
      ])
    ).toEqual([
      {
        name: 'image-model',
        inputModalities: [],
        outputModalities: [],
      },
    ]);
  });

  it('keeps untouched modality fields undefined', () => {
    expect(entriesToModels([{ name: 'text-model', alias: '' }])).toEqual([{ name: 'text-model' }]);
  });

  it('round-trips force mapping, modalities, and existing model metadata without serializing drafts', () => {
    const thinking = { budgetTokens: 4096 };
    const entries = modelsToEntries([
      {
        name: '  image-model  ',
        alias: '  image-alias  ',
        priority: 7,
        testModel: 'probe-model',
        image: false,
        forceMapping: false,
        inputModalities: ['text', 'image'],
        outputModalities: [],
        thinking,
      },
    ]);

    expect(entries).toEqual([
      {
        name: '  image-model  ',
        alias: '  image-alias  ',
        priority: 7,
        testModel: 'probe-model',
        image: false,
        forceMapping: false,
        inputModalities: ['text', 'image'],
        outputModalities: [],
        inputModalitiesDraft: 'text, image',
        outputModalitiesDraft: '',
        thinking,
      },
    ]);

    entries[0]!.inputModalitiesDraft = 'draft-only text';
    entries[0]!.outputModalitiesDraft = 'draft-only image';

    expect(entriesToModels(entries)).toEqual([
      {
        name: 'image-model',
        alias: 'image-alias',
        priority: 7,
        testModel: 'probe-model',
        image: false,
        forceMapping: false,
        inputModalities: ['text', 'image'],
        outputModalities: [],
        thinking,
      },
    ]);
  });

  it('detects explicit force mapping and modality changes in model equality', () => {
    const untouched = [{ name: 'model', alias: '' }];

    expect(
      areModelEntriesEqual(untouched, [{ name: 'model', alias: '', forceMapping: false }])
    ).toBe(false);
    expect(
      areModelEntriesEqual(untouched, [{ name: 'model', alias: '', inputModalities: [] }])
    ).toBe(false);
    expect(
      areModelEntriesEqual(
        [{ name: 'model', alias: '', outputModalities: ['text'] }],
        [{ name: 'model', alias: '', outputModalities: ['image'] }]
      )
    ).toBe(false);
    expect(
      areModelEntriesEqual(
        [{ name: 'model', alias: '', forceMapping: true, inputModalities: ['text'] }],
        [{ name: 'model', alias: '', forceMapping: true, inputModalities: ['text'] }]
      )
    ).toBe(true);
  });

  it('keeps Gemini model metadata while normalizing resource names', async () => {
    const { normalizeGeminiModelEntries } =
      await import('@/features/aiProviders/AiProvidersGeminiEditPage');
    const thinking = { budgetTokens: 2048 };

    expect(
      normalizeGeminiModelEntries([
        {
          name: '/models/gemini-2.5-pro',
          alias: 'pro-alias',
          priority: 3,
          testModel: 'probe-pro',
          image: false,
          thinking,
          forceMapping: false,
          inputModalities: [],
          outputModalities: ['text'],
        },
        {
          name: 'models/gemini-2.5-flash',
          alias: '',
          forceMapping: true,
          inputModalities: ['text', 'image'],
          outputModalities: [],
        },
      ])
    ).toEqual([
      {
        name: 'gemini-2.5-pro',
        alias: 'pro-alias',
        priority: 3,
        testModel: 'probe-pro',
        image: false,
        thinking,
        forceMapping: false,
        inputModalities: [],
        outputModalities: ['text'],
      },
      {
        name: 'gemini-2.5-flash',
        alias: '',
        forceMapping: true,
        inputModalities: ['text', 'image'],
        outputModalities: [],
      },
    ]);
  });
});
