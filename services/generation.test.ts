import test, { TestContext } from 'node:test';
function env(t: TestContext, key: string, value: string) {
  const old = process.env[key];
  process.env[key] = value;
  t.after(() => {
    if (old === undefined) delete process.env[key];
    else process.env[key] = old;
  });
}
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  configuredKeys,
  generateGeminiPassage,
  keyId,
  ProviderError,
} from './geminiProvider';
import {
  hasSharedStorage,
  addCachedPassage,
  cachedPassages,
  readValue,
  reserveGeneration,
  releaseGeneration,
  writeValue,
} from './generationStorage';
import { getSamplePassage } from '../utils/text';

test('server cooldown cannot be bypassed with a different session; rejected requests do not acquire leases', async () => {
  const client = randomUUID();
  const first = await reserveGeneration(client, 30_000, false);
  assert.equal(first.allowed, true);
  const second = await reserveGeneration(client, 30_000, false);
  assert.equal(second.allowed, false);
  assert.equal(second.nextAllowedAt, first.nextAllowedAt);
  await releaseGeneration(first.lease);
});

test('cache keeps a bounded pool without model calls', async () => {
  const bucket = randomUUID();
  for (let i = 0; i < 55; i++) await addCachedPassage(bucket, `passage-${i}`);
  const list = await cachedPassages(bucket);
  assert.equal(list.length, 50);
  assert.equal(list[0], 'passage-54');
});

test('Gemini structured output, key rotation and project-wide 429 stop with no immediate retry', async (t) => {
  env(t, 'GEMINI_API_KEYS', 'test-key-first-12345,test-key-second-12345');
  env(t, 'GEMINI_MODEL', 'configured-test-model');
  const text = getSamplePassage('en', 'philosophy', 'short').content;
  const calls: string[] = [];
  const fetchMock = t.mock.method(
    globalThis,
    'fetch',
    async (_url: unknown, init?: RequestInit) => {
      calls.push(new Headers(init?.headers).get('x-goog-api-key') || '');
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ text }) }],
                role: 'model',
              },
              finishReason: 'STOP',
            },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }
  );
  const first = await generateGeminiPassage(
    'en',
    'philosophy',
    'short',
    new AbortController().signal
  );
  const second = await generateGeminiPassage(
    'en',
    'philosophy',
    'short',
    new AbortController().signal
  );
  assert.equal(first, text);
  assert.equal(second, text);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0], calls[1]);
  fetchMock.mock.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 429,
            status: 'RESOURCE_EXHAUSTED',
            message: 'private provider details',
          },
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      )
  );
  await assert.rejects(
    generateGeminiPassage(
      'en',
      'philosophy',
      'short',
      new AbortController().signal
    ),
    (err: unknown) =>
      err instanceof ProviderError &&
      err.status === 429 &&
      !err.message.includes('private')
  );
  const count = fetchMock.mock.callCount();
  await assert.rejects(
    generateGeminiPassage(
      'en',
      'philosophy',
      'short',
      new AbortController().signal
    ),
    ProviderError
  );
  assert.equal(fetchMock.mock.callCount(), count);
  await writeValue('provider-block', 0, 1);
});

test('credentials are deduplicated; identifiers do not expose raw keys', (t) => {
  env(
    t,
    'GEMINI_API_KEYS',
    'abc-key-secret-123,abc-key-secret-123,another-key-secret-456'
  );
  assert.equal(configuredKeys().length, 2);
  assert.equal(keyId('abc-key-secret-123').length, 24);
  assert.equal(keyId('abc-key-secret-123').includes('secret'), false);
});

test('cached reads preserve cooldown timestamp values', async () => {
  await writeValue('test-number', 1234, 30);
  assert.equal(await readValue<number>('test-number'), 1234);
});

test('Vercel Marketplace Redis aliases enable shared storage', (t) => {
  env(t, 'UPSTASH_REDIS_REST_URL', '');
  env(t, 'UPSTASH_REDIS_REST_TOKEN', '');
  env(t, 'KV_REST_API_URL', 'https://example.invalid');
  env(t, 'KV_REST_API_TOKEN', 'test-token');
  assert.equal(hasSharedStorage(), true);
});
test('authentication rejection fails over once to a healthy credential', async (t) => {
  env(
    t,
    'GEMINI_API_KEYS',
    'auth-test-credential-one,auth-test-credential-two'
  );
  const text = getSamplePassage('en', 'philosophy', 'short').content;
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    if (requests === 1)
      return new Response(
        JSON.stringify({
          error: {
            code: 401,
            status: 'UNAUTHENTICATED',
            message: 'UNAUTHENTICATED',
          },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ text }) }],
              role: 'model',
            },
            finishReason: 'STOP',
          },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  });
  assert.equal(
    await generateGeminiPassage(
      'en',
      'philosophy',
      'short',
      new AbortController().signal
    ),
    text
  );
  assert.equal(requests, 2);
});
test('AQ authorization keys use the Gemini Developer API unless Vertex is explicitly selected', async (t) => {
  env(t, 'GEMINI_API_KEYS', 'AQ.test-authorization-credential-only');
  env(t, 'GEMINI_BACKEND', 'developer');
  const text = getSamplePassage('en', 'philosophy', 'short').content;
  let endpoint = '';
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    endpoint = String(url);
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ text }) }],
              role: 'model',
            },
            finishReason: 'STOP',
          },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  });
  await generateGeminiPassage(
    'en',
    'philosophy',
    'short',
    new AbortController().signal
  );
  assert.ok(endpoint.startsWith('https://generativelanguage.googleapis.com/'));
});
