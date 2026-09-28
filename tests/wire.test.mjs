// cope's proof for 1.0 (27 Sep 2026), a characterization test after Michael Feathers, held to
// the README's own promise: each thing said is heard exactly once, and a mark you did not
// accept keeps a message from you. The real server, on a spare port, nothing faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

const port = 18000 + Math.floor(Math.random() * 1000);
const server = spawn(process.execPath, ['server.mjs'], {env: {...process.env, PORT: String(port)}});
await new Promise(ready => server.stdout.once('data', ready));
const post = (path, body) => fetch(`http://127.0.0.1:${port}${path}`, {method: 'POST', body: JSON.stringify(body)})
  .then(async r => ({status: r.status, ...(await r.json())}));

test('a thing said is heard once, then gone', async () => {
  assert.equal((await post('/say', {text: 'the sky is up', marks: ['calm']})).ok, true);
  assert.equal((await post('/hear', {accepts: ['calm']})).text, 'the sky is up');
  assert.equal((await post('/hear', {accepts: ['calm']})).empty, true);
});

test('a mark you did not accept keeps it from you', async () => {
  await post('/say', {text: 'loud', marks: ['heavy']});
  assert.equal((await post('/hear', {accepts: ['calm']})).empty, true);
  assert.equal((await post('/hear', {accepts: ['heavy']})).text, 'loud');
});

test('nothing said is refused', async () => {
  assert.equal((await post('/say', {text: '   '})).status, 400);
});

test.after(() => server.kill());
