// The Model Context Protocol server (scripts/styk-mcp.mjs): the protocol answers, the tool list's schemas, how a tool
// call maps to a control-channel operation, and the failures an agent reads. The channel is a fake, so no app runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMcpServer, TOOLS} from '../scripts/styk-mcp.mjs';

/** A control channel that answers from a table and remembers every request, in order. */
function fakeChannel(answers) {
  const calls = [];
  return {
    calls,
    closed: false,
    failNext: 0,
    request(op, args = {}, detail) {
      calls.push({op, args, detail});
      if (this.failNext > 0) { this.failNext -= 1; return Promise.reject(new Error('The app closed the control channel.')); }
      const answer = answers[op];
      if (answer === undefined) throw new Error(`The fake channel has no answer for ${op}.`);
      return Promise.resolve(structuredClone(answer));
    },
    close() { this.closed = true; },
  };
}

/** A server over a fake channel; `pids` is what pipe discovery finds, and every reconnect hands out the same fake. */
function startedServer(answers, {pids = [4242]} = {}) {
  const channel = fakeChannel(answers);
  const server = createMcpServer({pid: null, listBuilds: () => pids, open: async () => channel});
  return {server, channel};
}

async function rpc(server, id, method, params = {}) {
  const answer = JSON.parse(await server.receive(JSON.stringify({jsonrpc: '2.0', id, method, params})));
  assert.equal(answer.jsonrpc, '2.0');
  assert.equal(answer.id, id);
  return answer;
}

/** A tools/call that must succeed: no protocol error, no isError. */
async function call(server, name, args = undefined) {
  const answer = await rpc(server, 1, 'tools/call', {name, ...(args === undefined ? {} : {arguments: args})});
  assert.equal(answer.error, undefined, JSON.stringify(answer.error));
  assert.notEqual(answer.result.isError, true, answer.result.content?.[0]?.text);
  return answer.result;
}

const textOf = result => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');

test('initialize echoes the client\'s protocol and names the server', async () => {
  const {server} = startedServer({});
  const answer = await rpc(server, 1, 'initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'client', version: '1'}});
  assert.equal(answer.result.protocolVersion, '2025-06-18');
  assert.equal(answer.result.serverInfo.name, 'stykanimate');
  assert.ok(answer.result.serverInfo.title.length > 0);
  assert.ok(typeof answer.result.capabilities.tools === 'object');
  assert.ok(answer.result.instructions.includes('npm run dev'));
});

test('initialize falls back to the latest protocol for an unknown version', async () => {
  const {server} = startedServer({});
  const answer = await rpc(server, 1, 'initialize', {protocolVersion: '1900-01-01'});
  assert.equal(answer.result.protocolVersion, '2025-06-18');
});

test('tools/list lists the registry: named, described, schematized', async () => {
  const {server} = startedServer({});
  const {tools} = (await rpc(server, 1, 'tools/list')).result;
  assert.equal(tools.length, TOOLS.length);
  assert.deepEqual(tools.map(tool => tool.name), TOOLS.map(tool => tool.name));
  const names = new Set(tools.map(tool => tool.name));
  assert.equal(names.size, tools.length);
  for (const tool of tools) {
    assert.ok(tool.title.length > 0, tool.name);
    assert.ok(tool.description.length > 20, tool.name);
    assert.equal(tool.inputSchema.type, 'object', tool.name);
    assert.equal(typeof tool.annotations.openWorldHint, 'boolean', tool.name);
    for (const required of tool.inputSchema.required ?? []) assert.ok(tool.inputSchema.properties[required] !== undefined, `${tool.name} requires unknown ${required}`);
  }
  const readOnly = tools.find(tool => tool.name === 'get_app_state');
  assert.equal(readOnly.annotations.readOnlyHint, true);
  const edit = tools.find(tool => tool.name === 'run_editor_command');
  assert.notEqual(edit.annotations.readOnlyHint, true);
  const reset = tools.find(tool => tool.name === 'reset_live_parameters');
  assert.equal(reset.annotations.destructiveHint, true);
});

test('a tool call reaches the channel as its operation, with its arguments', async () => {
  const {server, channel} = startedServer({
    state: {ok: true, result: {ready: true}},
    seek: {ok: true, result: {tick: 12, presentedMs: 0.5}},
    'command.run': {ok: true, result: {ran: true}},
    select: {ok: true, result: {selection: []}},
  });
  const result = await call(server, 'get_app_state');
  assert.deepEqual(channel.calls[0], {op: 'state', args: {}, detail: undefined});
  assert.ok(textOf(result).includes('"ready": true'));
  await call(server, 'get_app_state', {detail: 'full'});
  assert.equal(channel.calls[1].detail, 'full');
  await call(server, 'seek_to_tick', {tick: 12});
  assert.deepEqual(channel.calls[2], {op: 'seek', args: {tick: 12}, detail: undefined});
  await call(server, 'run_editor_command', {command: 'frame.add'});
  assert.deepEqual(channel.calls[3], {op: 'command.run', args: {command: 'frame.add'}, detail: undefined});
  await call(server, 'set_selection', {uid: null});
  assert.deepEqual(channel.calls[4], {op: 'select', args: {uid: null}, detail: undefined});
});

test('the screenshot arrives as an image, and a broken data URL stays text', async () => {
  const {server, channel} = startedServer({screenshot: {ok: true, result: {width: 480, height: 320, png: 'data:image/png;base64,QUJDRA=='}}});
  const result = await call(server, 'screenshot_stage');
  const image = result.content.find(item => item.type === 'image');
  assert.deepEqual({mimeType: image.mimeType, data: image.data}, {mimeType: 'image/png', data: 'QUJDRA=='});
  assert.ok(textOf(result).includes('480'));

  channel.calls.length = 0;
  const answers = {screenshot: {ok: true, result: {width: 1, height: 1, png: 'not-a-data-url'}}};
  const broken = createMcpServer({pid: null, listBuilds: () => [4242], open: async () => fakeChannel(answers)});
  const textResult = await call(broken, 'screenshot_stage');
  assert.equal(textResult.content[0].type, 'text');
});

test('an error the app answered becomes a tool error with what and hint', async () => {
  const {server} = startedServer({state: {ok: false, error: {what: 'The editor is not ready.', where: 'devtools control state', input: null, cause: '', hint: 'Wait for window.styk.ready.'}}});
  const result = await rpc(server, 1, 'tools/call', {name: 'get_app_state', arguments: {}}).then(answer => answer.result);
  assert.equal(result.isError, true);
  const text = textOf(result);
  assert.ok(text.includes('The editor is not ready.'), text);
  assert.ok(text.includes('hint: Wait for window.styk.ready.'), text);
});

test('a failure of this server (no build, several builds) says what to do', async () => {
  const none = createMcpServer({pid: null, listBuilds: () => [], open: async () => fakeChannel({})});
  const noneResult = await rpc(none, 1, 'tools/call', {name: 'get_app_state'}).then(answer => answer.result);
  assert.equal(noneResult.isError, true);
  assert.ok(textOf(noneResult).includes('No developer build is running.'));

  const several = createMcpServer({pid: null, listBuilds: () => [7, 11], open: async () => fakeChannel({})});
  const severalResult = await rpc(several, 1, 'tools/call', {name: 'get_app_state'}).then(answer => answer.result);
  assert.equal(severalResult.isError, true);
  assert.ok(textOf(severalResult).includes('--pid'), textOf(severalResult));
});

test('list_running_builds answers without the channel', async () => {
  const {server, channel} = startedServer({}, {pids: [7, 11]});
  const result = await call(server, 'list_running_builds');
  assert.equal(channel.calls.length, 0);
  const said = JSON.parse(textOf(result));
  assert.deepEqual(said.pids, [7, 11]);
  assert.equal(said.chosen, null);
});

test('a dropped pipe is reconnected once and the request is sent again', async () => {
  const {server, channel} = startedServer({state: {ok: true, result: {ready: true}}});
  channel.failNext = 1;
  const result = await call(server, 'get_app_state');
  assert.ok(textOf(result).includes('"ready": true'));
  assert.equal(channel.calls.length, 2);
});

test('calls run one at a time, in the order they arrived', async () => {
  const {server, channel} = startedServer({hello: {ok: true, result: {ops: []}}, state: {ok: true, result: {ready: true}}});
  await Promise.all([call(server, 'app_hello'), call(server, 'get_app_state')]);
  assert.deepEqual(channel.calls.map(occurrence => occurrence.op), ['hello', 'state']);
});

test('unknown methods, unknown tools and broken lines are protocol errors', async () => {
  const {server} = startedServer({});
  assert.equal((await rpc(server, 1, 'resources/list')).error.code, -32601);
  const unknownTool = await rpc(server, 2, 'tools/call', {name: 'nope'});
  assert.equal(unknownTool.error.code, -32602);
  assert.equal(JSON.parse(await server.receive('{broken')).error.code, -32700);
  assert.equal(JSON.parse(await server.receive(JSON.stringify(42))).error.code, -32600);
});

test('a notification is never answered', async () => {
  const {server} = startedServer({});
  assert.equal(await server.receive(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'})), null);
  assert.equal(await server.receive(JSON.stringify({jsonrpc: '2.0', method: 'notifications/cancelled', params: {requestId: 1}})), null);
});

test('dispose closes the channel', async () => {
  const {server, channel} = startedServer({hello: {ok: true, result: {ops: []}}, state: {ok: true, result: {ready: true}}});
  await call(server, 'app_hello');
  await call(server, 'get_app_state');
  server.dispose();
  assert.equal(channel.closed, true);
});
