import { describe, expect, it, beforeEach } from 'vitest';
import {
  loadAcknowledgedModels,
  saveAcknowledgedModels,
  MODEL_PRICE_ATTENTION_STORAGE_KEY,
} from './modelPriceAttentionStorage';

describe('modelPriceAttentionStorage', () => {
  class MockStorage implements Storage {
    private store = new Map<string, string>();
    get length() {
      return this.store.size;
    }
    clear() {
      this.store.clear();
    }
    getItem(key: string) {
      return this.store.has(key) ? this.store.get(key)! : null;
    }
    key(index: number) {
      return Array.from(this.store.keys())[index] ?? null;
    }
    removeItem(key: string) {
      this.store.delete(key);
    }
    setItem(key: string, value: string) {
      this.store.set(key, value);
    }
  }

  let storage: MockStorage;

  beforeEach(() => {
    storage = new MockStorage();
  });

  it('returns empty array when storage is empty', () => {
    expect(loadAcknowledgedModels('http://localhost:18317', storage)).toEqual([]);
  });

  it('safely recovers from corrupted json', () => {
    storage.setItem(MODEL_PRICE_ATTENTION_STORAGE_KEY, '{ invalid json');
    expect(loadAcknowledgedModels('http://localhost:18317', storage)).toEqual([]);
  });

  it('safely recovers from invalid schema or version', () => {
    storage.setItem(
      MODEL_PRICE_ATTENTION_STORAGE_KEY,
      JSON.stringify({ version: 99, scopes: {} })
    );
    expect(loadAcknowledgedModels('http://localhost:18317', storage)).toEqual([]);
  });

  it('saves and loads acknowledged models scoped by manager base', () => {
    const baseA = 'http://localhost:18317';
    const baseB = 'https://manager.example.com/';

    saveAcknowledgedModels(baseA, ['gpt-4o', 'claude-3-5-sonnet'], storage);
    saveAcknowledgedModels(baseB, ['deepseek-chat'], storage);

    expect(loadAcknowledgedModels(baseA, storage)).toEqual(['gpt-4o', 'claude-3-5-sonnet']);
    expect(loadAcknowledgedModels(baseB, storage)).toEqual(['deepseek-chat']);
    expect(loadAcknowledgedModels('http://other:18317', storage)).toEqual([]);

    // Raw verification of stored structure
    const raw = JSON.parse(storage.getItem(MODEL_PRICE_ATTENTION_STORAGE_KEY)!);
    expect(raw.version).toBe(1);
    expect(Object.keys(raw.scopes)).toHaveLength(2);
    // Assure no credential/auth info is stored
    expect(raw).not.toHaveProperty('apiKey');
    expect(raw).not.toHaveProperty('managementKey');
  });

  it('deduplicates and trims model names', () => {
    saveAcknowledgedModels(
      'http://localhost:18317',
      ['gpt-4o', '  gpt-4o ', '', '   ', 'claude-3-5-sonnet'],
      storage
    );
    expect(loadAcknowledgedModels('http://localhost:18317', storage)).toEqual([
      'gpt-4o',
      'claude-3-5-sonnet',
    ]);
  });
});
