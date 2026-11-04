import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST, GET } from '../app/api/challenge/route';
import { splitGraphemes } from '../utils/text';
test('daily API binds runs to owners, recomputes points, preserves best, and consumes submissions', async (t) => {
  const oldFetch = globalThis.fetch,
    oldUrl = process.env.KV_REST_API_URL,
    oldToken = process.env.KV_REST_API_TOKEN;
  const oldUpUrl = process.env.UPSTASH_REDIS_REST_URL,
    oldUpToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.KV_REST_API_URL = 'https://redis.test';
  process.env.KV_REST_API_TOKEN = 'test';
  t.after(() => {
    globalThis.fetch = oldFetch;
    for (const [k, v] of Object.entries({
      KV_REST_API_URL: oldUrl,
      KV_REST_API_TOKEN: oldToken,
      UPSTASH_REDIS_REST_URL: oldUpUrl,
      UPSTASH_REDIS_REST_TOKEN: oldUpToken,
    })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const memory = new Map<string, string>();
  let best = 0,
    record = '';
  globalThis.fetch = async (_url, opts) => {
    const c = JSON.parse(String(opts?.body));
    let result: unknown = null;
    if (c[0] === 'SET') {
      memory.set(c[1], c[2]);
      result = 'OK';
    }
    if (c[0] === 'GET') result = memory.get(c[1]) ?? null;
    if (c[0] === 'EVAL' && c[2] === 1) result = 1;
    if (c[0] === 'EVAL' && c[2] === 3) {
      if (!memory.has(c[5])) result = 0;
      else {
        if (Number(c[7]) > best) {
          best = Number(c[7]);
          record = c[8];
        }
        memory.delete(c[5]);
        result = 1;
      }
    }
    if (c[0] === 'ZREVRANGE') result = record ? ['player'] : [];
    if (c[0] === 'HGET') result = record;
    return new Response(JSON.stringify({ result }));
  };
  const request = (body: unknown, cookie = '') =>
    new NextRequest('https://aura.test/api/challenge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        origin: 'https://aura.test',
        cookie,
      },
      body: JSON.stringify(body),
    });
  const start = await POST(request({ action: 'start', language: 'en' }));
  assert.equal(start.status, 200);
  const d = await start.json();
  const cookie = start.headers.get('set-cookie')!.split(';')[0];
  const key = 'auratype:v2:run:' + d.runId,
    run = JSON.parse(memory.get(key)!);
  run.start -= 60000;
  memory.set(key, JSON.stringify(run));
  const length = splitGraphemes(d.passage).length,
    replay = Array.from({ length }, (_, i) => ({
      index: i + 1,
      correctCount: i + 1,
      t: i * 180,
    }));
  assert.equal(
    (
      await POST(
        request({ action: 'finish', runId: d.runId, replay, name: 'QA' })
      )
    ).status,
    400
  );
  const finish = await POST(
    request({ action: 'finish', runId: d.runId, replay, name: 'QA' }, cookie)
  );
  assert.equal(finish.status, 200);
  assert.ok(best > 0);
  assert.equal(memory.has(key), false);
  assert.equal(
    (
      await POST(
        request(
          { action: 'finish', runId: d.runId, replay, name: 'QA' },
          cookie
        )
      )
    ).status,
    400
  );
  const board = await GET(
    new NextRequest('https://aura.test/api/challenge?language=en')
  );
  assert.equal((await board.json()).rows[0].name, 'QA');
  const next = await POST(request({ action: 'start', language: 'en' }, cookie));
  const nd = await next.json();
  const nk = 'auratype:v2:run:' + nd.runId;
  const nr = JSON.parse(memory.get(nk)!);
  nr.start -= 120000;
  memory.set(nk, JSON.stringify(nr));
  const previous = best;
  assert.equal(
    (
      await POST(
        request(
          {
            action: 'finish',
            runId: nd.runId,
            replay: replay.map((e) => ({ ...e, t: e.t * 2 })),
            name: 'Slower',
          },
          cookie
        )
      )
    ).status,
    200
  );
  assert.equal(best, previous);
  assert.equal(JSON.parse(record).name, 'QA');
});
