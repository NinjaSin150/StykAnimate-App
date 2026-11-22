// The control channel as Model Context Protocol tools (docs/MCP.md, docs/DEVTOOLS.md "Control channel").
//
// A Model Context Protocol client (Claude Desktop, an IDE extension, an agent) launches this server as a child process
// and speaks JSON-RPC 2.0 over stdio: initialize, tools/list, tools/call. Each tool call becomes one request over a
// running developer build's control channel — the transport is the one scripts/styk-dev.mjs holds — so the app answers
// with the same reads and the same changes its own developer panel would, every change a session command with undo.
// The server never starts the app and never opens a network port: it only connects to the local pipe the developer
// build serves, which only the current user reaches, and a packaged app has no channel at all.
//
//   node scripts/styk-mcp.mjs [--pid <pid>]
//
// With several developer builds running, name one with --pid (or STYK_MCP_PID); with none, the only running build is
// used. Every answer is bounded to the pipe's 1 MiB, each call waits at most 150 s, and calls run one at a time, in
// order, because the pipe answers in order. Protocol errors (a method or tool the server does not know) are JSON-RPC
// errors; an error the app itself answered comes back as a tool result with isError, what, where, input and hint.
import {connect, runningBuilds} from './styk-dev.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SERVER_NAME = 'stykanimate';
const SERVER_VERSION = '0.1.0';
const LATEST_PROTOCOL = '2025-06-18';
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
/** The pipe answers at most 120 s; a little more on top, so the server always answers before the client gives up. */
const REQUEST_TIMEOUT_MS = 150000;

const TIMEOUT = Symbol('stykanimate mcp request timeout');

/** A failed request that carries the channel's own error shape (what, where, input, cause, hint). */
function failed(what, {input = null, cause = '', hint = ''} = {}) {
  const error = new Error(what);
  error.appError = {what: String(what), where: '', input, cause: String(cause), hint: String(hint)};
  return error;
}

/** Rejects when `promise` takes longer than `ms`; the rejection is marked so a dropped-pipe retry does not repeat it. */
function withTimeout(op, promise, ms = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`The app did not answer ${op} within ${Math.round(ms / 1000)} s.`);
      error.timeout = TIMEOUT;
      reject(error);
    }, ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

/** The control channel of one developer build: requests in order, one retry after a dropped pipe. */
class ControlChannel {
  constructor({pid = null, listBuilds = runningBuilds, open = connect} = {}) {
    this.pidOption = pid;
    this.listBuilds = listBuilds;
    this.open = open;
    this.channel = null;
    this.queue = Promise.resolve();
  }

  /** The running builds, and the one this server talks to: the --pid it was given, else the only one running. */
  builds() {
    const pids = this.listBuilds();
    return {pids, chosen: this.pidOption ?? (pids.length === 1 ? pids[0] : null)};
  }

  async connection() {
    if (this.channel) return this.channel;
    const {pids, chosen} = this.builds();
    if (chosen === null) {
      if (pids.length === 0) throw failed('No developer build is running.', {hint: 'Start one with npm run dev (a developer launch of a source checkout; a packaged app serves no channel), then call the tool again.'});
      throw failed(`Several developer builds are running (${pids.join(', ')}).`, {hint: 'Restart this server with --pid <pid> (or set STYK_MCP_PID) to name one.'});
    }
    this.channel = await this.open(chosen);
    return this.channel;
  }

  /** One request, serialized. A pipe that dropped is reconnected once and the request sent again. */
  request(op, args = {}, detail) {
    const send = async () => {
      let channel = await this.connection();
      try {
        return await withTimeout(op, channel.request(op, args, detail));
      } catch (error) {
        if (error?.timeout === TIMEOUT) throw error;
        if (this.channel === channel) this.channel = null;
        channel = await this.connection();
        return await withTimeout(op, channel.request(op, args, detail));
      }
    };
    const answer = this.queue.then(send, send);
    this.queue = answer.then(() => undefined, () => undefined);
    return answer;
  }

  dispose() {
    if (this.channel) this.channel.close();
    this.channel = null;
  }
}

const text = (description) => ({type: 'string', description});
const integer = (description, minimum, maximum) => ({type: 'integer', description, ...(minimum !== undefined ? {minimum} : {}), ...(maximum !== undefined ? {maximum} : {})});
const number = (description) => ({type: 'number', description});
const boolean = (description) => ({type: 'boolean', description});
const nullable = (schema) => ({anyOf: [schema, {type: 'null'}]});
const detailEnum = {type: 'string', enum: ['short', 'full'], description: 'short (the default) or full: full returns more, where the operation offers it.'};

/** A tool description: what an MCP client lists, and how its call reaches the channel. */
function tool(name, title, description, inputSchema, spec, {readOnly = false, destructive = false, args = null, local = null, picture = null} = {}) {
  return {name, title, description,
    inputSchema: {type: 'object', properties: inputSchema.properties ?? {}, ...(inputSchema.required ? {required: inputSchema.required} : {}), ...(inputSchema.free ? {} : {additionalProperties: false})},
    annotations: {openWorldHint: false, ...(readOnly ? {readOnlyHint: true} : {}), ...(destructive ? {destructiveHint: true} : {})},
    ...(args ? {args} : {}), ...(local ? {local} : {}), ...(picture ? {picture} : {}), ...spec};
}

const optionalDetail = args => ({args, detail: args.detail});

/** The stage's PNG data URL as MCP image content; a data URL the app did not draw stays text. */
function picture(result) {
  const prefix = result?.png ? result.png.slice(0, result.png.indexOf(',')) : '';
  if (prefix !== 'data:image/png;base64') return {content: [{type: 'text', text: JSON.stringify(result, null, 1)}]};
  return {content: [
    {type: 'image', mimeType: 'image/png', data: result.png.slice(result.png.indexOf(',') + 1)},
    {type: 'text', text: `The stage, ${result.width} x ${result.height} pixels.`},
  ]};
}

/** The tool registry: one entry per operation the channel answers, in the order an agent meets them. */
export const TOOLS = [
  tool('list_running_builds', 'List running developer builds',
    'The process ids of the running developer builds that serve a control channel. The server talks to the only one, or to the --pid it was given; call this when a tool says it cannot choose.',
    {}, {op: null},
    {readOnly: true, local: context => {
      const {pids, chosen} = context.builds();
      return {content: [{type: 'text', text: JSON.stringify({pids, chosen, ...(pids.length > 1 && chosen === null ? {note: 'Several builds are running: restart the server with --pid to name one.'} : {})} , null, 1)}]};
    }}),

  tool('app_hello', 'Control channel hello',
    'The control channel\'s own hello: its protocol version, whether the app has finished starting, and every operation it answers. The operations beyond this server\'s tools are reached with raw_control_operation.',
    {}, {op: 'hello'}, {readOnly: true}),

  tool('get_app_state', 'Get app state',
    'Everything the app can say about right now: whether it is ready, the document summary (figures, frames, ticks), playback, the view, the focused element, the open dialogs, the window and WebGPU. Start here before anything else.',
    {properties: {detail: detailEnum}}, {op: 'state'}, {readOnly: true, args: optionalDetail}),

  tool('get_metrics', 'Get sampler metrics',
    'What the sampler sees now: frames, inputs, paint, queues and memory. How the app feels at this moment.',
    {properties: {}, free: true}, {op: 'metrics'}, {readOnly: true}),

  tool('get_memory', 'Get memory',
    'The page\'s, the engine\'s and the GPU\'s memory. owners: true adds the registered memory owners.',
    {properties: {owners: boolean('Add the memory owners.')}}, {op: 'memory'}, {readOnly: true}),

  tool('get_engine_boundary', 'Get engine call boundary',
    'The heaviest calls the interface made into the engine since the last capture began, heaviest first. reset: true empties the meter while returning what it held.',
    {properties: {limit: integer('At most this many rows.', 1, 500), reset: boolean('Empty the meter after reading it.')}}, {op: 'boundary'}, {args: args => ({args: {limit: args.limit ?? 40, reset: args.reset ?? false}})}),

  tool('screenshot_stage', 'Screenshot the stage',
    'The stage as a picture: the scene and the overlay as one PNG. Waits until the frame on show is the document\'s current state, then captures. Take one after every change, to see what a person sees.',
    {}, {op: 'screenshot'}, {readOnly: true, picture}),

  tool('list_editor_commands', 'List editor commands',
    'The app\'s command registry: every command the menus and the command palette can run, with its id, label, and whether it is enabled now (the reason says why not). Run one with run_editor_command.',
    {properties: {query: text('Only commands whose label or id matches this text.'), limit: integer('At most this many commands.', 1, 500)}},
    {op: 'command.list'}, {readOnly: true, args: args => ({args: {query: args.query ?? '', limit: args.limit ?? 50}})}),

  tool('run_editor_command', 'Run an editor command',
    'Runs one of the app\'s own commands — exactly what a menu item or the command palette runs — so the change is the app\'s own and carries undo. Pick ids from list_editor_commands; a command that cannot run now answers why.',
    {properties: {command: text('The command id, as command.list names it.')}, required: ['command']},
    {op: 'command.run'}, {args: args => ({args: {command: args.command}})}),

  tool('read_document_tree', 'Read the document tree',
    'Pages of the read view\'s document tree. An empty path starts at the root; path walks into a node by its keys, cursor pages, and fetch asks the rows of a big table. Figures\' uids come from here or from read_current_frame.',
    {properties: {path: {type: 'array', maxItems: 32, description: 'The keys to walk, at most 32.'}, cursor: integer('Page from this row.', 0), fetch: boolean('Fetch the rows of this node\'s table.')}},
    {op: 'doc.tree'}, {readOnly: true, args: args => ({args: {path: args.path ?? [], cursor: args.cursor ?? 0, fetch: args.fetch ?? false}})}),

  tool('read_current_frame', 'Read the frame on show',
    'The evaluated frame on show, paged: the figures and their parts as the engine drew them this tick.',
    {properties: {cursor: integer('Page from this row.', 0)}}, {op: 'doc.frame'}, {readOnly: true, args: args => ({args: {cursor: args.cursor ?? 0}})}),

  tool('read_edit_history', 'Read the undo history',
    'The history\'s labels, paged: what undo and redo would do, and what was already undone.',
    {properties: {cursor: integer('Page from this row.', 0)}}, {op: 'doc.history'}, {readOnly: true, args: args => ({args: {cursor: args.cursor ?? 0}})}),

  tool('list_edit_session_calls', 'List edit session calls',
    'The edit session calls the interface made, as far as the log keeps them: which engine commands ran, newest last.',
    {properties: {limit: integer('At most this many rows.', 1, 1000)}}, {op: 'doc.commands'}, {readOnly: true, args: args => ({args: {limit: args.limit ?? 50}})}),

  tool('seek_to_tick', 'Seek to a tick',
    'Moves the playhead to a tick and waits until that frame is on show. Ticks run from 0 to totalTicks - 1, which get_app_state\'s document summary reports.',
    {properties: {tick: integer('The tick to seek to.', 0)}, required: ['tick']},
    {op: 'seek'}, {args: args => ({args: {tick: args.tick}})}),

  tool('play_animation', 'Play the animation',
    'Starts playback. seconds: play that long, then pause (at most 120); without it playback keeps going.',
    {properties: {seconds: integer('Play this many seconds, then pause.', 0, 120)}},
    {op: 'play'}, {args: args => ({args: {seconds: args.seconds ?? 0}})}),

  tool('pause_animation', 'Pause the animation',
    'Pauses playback and says where the playhead stopped.',
    {}, {op: 'pause'}, {}),

  tool('undo_change', 'Undo the last change',
    'Undoes the last edit and waits until the frame on show is the undone state. Every change the tools make is a session command, so this always answers it.',
    {}, {op: 'undo'}, {}),

  tool('redo_change', 'Redo an undone change',
    'Redoes the last undone edit and waits until the frame on show is the redone state.',
    {}, {op: 'redo'}, {}),

  tool('set_selection', 'Select a figure',
    'Selects a figure by uid; null clears the selection. Waits until the frame on show answers the new selection.',
    {properties: {uid: nullable(text('The figure\'s uid, from read_document_tree or read_current_frame.'))}},
    {op: 'select'}, {args: args => ({args: {uid: args.uid ?? null}})}),

  tool('set_view', 'Set the view',
    'Sets the view\'s pan and zoom directly: x, y and scale, any of them. The answer reports all three.',
    {properties: {x: number('The view\'s x.'), y: number('The view\'s y.'), scale: number('The view\'s zoom, above 0.')}} ,
    {op: 'view'}, {args: args => ({args})}),

  tool('wait_until_settled', 'Wait until the stage settles',
    'Waits until the frame on show is the document\'s current state — after a burst of changes, before a screenshot.',
    {properties: {timeoutMs: integer('Give up after this long.', 0, 120000)}},
    {op: 'settle'}, {args: args => ({args: {timeoutMs: args.timeoutMs ?? 5000}})}),

  tool('find_handle_to_drag', 'Find a handle to drag',
    'Where to press to drag a joint (kind "pose") or move a figure (kind "move"): the most-connected handle, centred in the view, as screen coordinates with its uid and joint. A pointer tool outside this server presses there; answer_file_dialog clears dialogs that would cover the stage (onStage says whether the press reaches it).',
    {properties: {kind: {type: 'string', enum: ['pose', 'move'], description: 'pose (the default) or move.'}}},
    {op: 'target.handle'}, {args: args => ({args: {kind: args.kind ?? 'pose'}})}),

  tool('open_document', 'Open a document',
    'Opens a document. In the browser driver give url and name (a file the page can fetch); over the desktop pipe give path (the shell opens it as if it were double-clicked, and the answer comes once it is drawn).',
    {properties: {url: text('The URL the page fetches, with name.'), name: text('The file name, with url.'), path: text('An absolute file path, over the desktop pipe.')}},
    {op: 'open'}, {args: args => ({args: args.path !== undefined ? {path: args.path} : {url: args.url, name: args.name}})}),

  tool('answer_file_dialog', 'Answer a file dialog',
    'Over the desktop pipe: answers the main process\'s next save or open dialog, so a scripted change never leaves a dialog waiting on the screen. kind and path queue one answer; kind and cancel cancels one; clear drops the queued ones; unanswered "cancel" cancels a dialog nothing answered instead of showing it ("show" restores both). The answer reports the pending answers and the last dialogs asked.',
    {properties: {kind: {type: 'string', enum: ['save', 'open'], description: 'The dialog to answer.'}, path: text('The absolute path to answer with.'), cancel: boolean('Cancel that dialog instead.'), clear: boolean('Drop the answers waiting.'), unanswered: {type: 'string', enum: ['cancel', 'show'], description: 'What to do with a dialog nothing answered.'}}},
    {op: 'dialog.answer'}, {args: args => ({args})}),

  tool('read_logs', 'Read log lines',
    'Log lines, newest last: filtered by least level, module (substring), text (substring) and sequence.',
    {properties: {level: {type: 'string', enum: ['debug', 'info', 'warn', 'error'], description: 'At least this level.'}, module: text('Only modules whose name contains this.'), text: text('Only lines whose message contains this.'), since: integer('Only lines after this sequence number.', 0), limit: integer('At most this many lines.', 1, 1000)}},
    {op: 'logs'}, {readOnly: true, args: args => ({args: {level: args.level ?? 'debug', module: args.module ?? '', text: args.text ?? '', since: args.since ?? 0, limit: args.limit ?? 100}})}),

  tool('list_live_parameters', 'List live parameters',
    'The live parameters (playback\'s lookahead, the scrub\'s batching, the engine\'s threads) with their values, defaults and specs. A parameter registers when its code first runs, so an unexercised one is absent.',
    {}, {op: 'params.list'}, {readOnly: true}),

  tool('set_live_parameter', 'Set a live parameter',
    'Sets one live parameter\'s value, clamped to its spec. Names come from list_live_parameters.',
    {properties: {name: text('The parameter\'s name.'), value: {description: 'The value, as the parameter\'s spec allows.'}}, required: ['name'], free: true},
    {op: 'params.set'}, {args: args => ({args: {name: args.name, value: args.value}})}),

  tool('reset_live_parameters', 'Reset live parameters',
    'Resets one live parameter to its default, or every live parameter when no name is given.',
    {properties: {name: text('The parameter to reset; without it, all of them.')}},
    {op: 'params.reset'}, {destructive: true, args: args => ({args: {name: args.name}})}),

  tool('start_trace_capture', 'Start a trace capture',
    'Starts a capture of spans, display frames, inputs and the calls into the engine. writes: true also records which interface elements are rewritten meanwhile; it costs a little per write, so ask for it in a pass that explains, not one that is timed.',
    {properties: {label: text('A name for the capture.'), writes: boolean('Record interface writes too.')}},
    {op: 'trace.start'}, {args: args => ({args: {label: args.label ?? '', writes: args.writes ?? false}})}),

  tool('stop_trace_capture', 'Stop the trace capture',
    'Ends the capture and returns its summary: frames with the interface\'s work by phase, input delay, the heaviest span groups, the slowest spans and the heaviest engine calls. detail "full" returns every span group. The Perfetto JSON text comes in pages: read_trace_page.',
    {properties: {series: boolean('Add the frames as chart series.'), detail: detailEnum}},
    {op: 'trace.stop'}, {args: optionalDetail}),

  tool('read_trace_page', 'Read a page of the trace',
    'One page (256 KiB) of the last capture\'s Perfetto JSON text; concatenate the pages 0 to pages - 1 in order for the whole file.',
    {properties: {page: integer('Which page.', 0)}},
    {op: 'trace.read'}, {readOnly: true, args: args => ({args: {page: args.page ?? 0}})}),

  tool('recent_trace_summary', 'Summarize recent events',
    'What happened in the last ms of the rings, summarized: a hitch after the fact, without a started capture.',
    {properties: {ms: integer('How far back to look.', 0), detail: detailEnum}},
    {op: 'trace.recent'}, {readOnly: true, args: optionalDetail}),

  tool('measure_display_period', 'Measure the display period',
    'Measures the display\'s period over frames of idle animation: the budget every frame is judged against. Call it while the app rests.',
    {properties: {frames: integer('How many frames to measure over.', 30, 600)}},
    {op: 'display.period'}, {readOnly: true, args: args => ({args: {frames: args.frames ?? 45}})}),

  tool('raw_control_operation', 'Call any control operation',
    'Any other operation the channel answers — params.save, params.load, memory.breakdown, threads, environment, startup, process.metrics, tools.overlay, tools.panel, document.mark, document.wait — with exactly the request docs/DEVTOOLS.md documents. app_hello lists what exists; prefer a named tool when one covers the operation.',
    {properties: {op: text('The operation, as app_hello and docs/DEVTOOLS.md name it.'), args: {type: 'object', additionalProperties: true, description: 'The operation\'s arguments.'}, detail: detailEnum}, required: ['op'], free: true},
    {op: null}, {args: args => ({args: args.args ?? {}, detail: args.detail})}),
];

const TOOLS_BY_NAME = new Map(TOOLS.map(entry => [entry.name, entry]));

const SERVER_INSTRUCTIONS = 'This server drives a running StykAnimate developer build through its control channel '
  + '(docs/DEVTOOLS.md); it never starts the app, so start one first with npm run dev. Inspect before you act: '
  + 'get_app_state, read_document_tree, read_current_frame. Change things only through the app\'s own controls: '
  + 'run_editor_command runs what the menus and the command palette run, and seek_to_tick, set_selection, undo_change '
  + 'and redo_change are session commands that carry undo. screenshot_stage shows the stage; wait_until_settled waits '
  + 'until what you changed is on show. app_hello lists every operation the channel answers, and '
  + 'raw_control_operation reaches the ones no named tool covers.';

/** A tool result that reports a failure the agent can act on: the app's what, where, input, cause and hint. */
function failure(error) {
  const appError = error?.appError;
  const lines = [String(appError?.what ?? error?.message ?? error)];
  if (appError?.where) lines.push(`where: ${appError.where}`);
  if (appError?.cause) lines.push(`cause: ${appError.cause}`);
  if (error?.input !== undefined && error?.input !== null) lines.push(`input: ${JSON.stringify(error.input)}`);
  else if (appError?.input !== undefined && appError?.input !== null) lines.push(`input: ${JSON.stringify(appError.input)}`);
  if (appError?.hint) lines.push(`hint: ${appError.hint}`);
  return {content: [{type: 'text', text: lines.join('\n')}], isError: true};
}

/** One Model Context Protocol server over stdio: JSON-RPC 2.0 in, one line per answer, nothing else on stdout. */
export function createMcpServer({pid = null, listBuilds = runningBuilds, open = connect} = {}) {
  const control = new ControlChannel({pid, listBuilds, open});
  const context = {request: (op, args, detail) => control.request(op, args, detail), builds: () => control.builds()};
  const notFound = method => { const error = new Error(`Method not found: ${method}.`); error.mcpCode = -32601; return error; };
  const invalidParams = message => { const error = new Error(message); error.mcpCode = -32602; return error; };

  function initialize(params) {
    const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : null;
    return {
      protocolVersion: requested !== null && SUPPORTED_PROTOCOLS.includes(requested) ? requested : LATEST_PROTOCOL,
      capabilities: {tools: {listChanged: false}},
      serverInfo: {name: SERVER_NAME, title: 'StykAnimate', version: SERVER_VERSION},
      instructions: SERVER_INSTRUCTIONS,
    };
  }

  async function callTool(params) {
    const entry = TOOLS_BY_NAME.get(params?.name);
    if (!entry) throw invalidParams(`No tool is named ${JSON.stringify(params?.name ?? null)}; tools/list names them.`);
    try {
      const {args = {}, detail} = entry.args ? entry.args(params.arguments ?? {}) : {args: params.arguments ?? {}};
      if (entry.local) return entry.local(context, args);
      const answer = await control.request(entry.op, args, detail);
      if (answer.ok === false) {
        const error = new Error(answer.error?.what ?? 'The app answered with an error.');
        error.appError = answer.error;
        return failure(error);
      }
      return entry.picture ? entry.picture(answer.result) : {content: [{type: 'text', text: JSON.stringify(answer.result, null, 1)}]};
    } catch (error) {
      return failure(error);
    }
  }

  async function dispatch(method, params) {
    if (method === 'initialize') return initialize(params);
    if (method === 'ping') return {};
    if (method === 'tools/list') return {tools: TOOLS.map(({name, title, description, inputSchema, annotations}) => ({name, title, description, inputSchema, annotations}))};
    if (method === 'tools/call') return await callTool(params);
    throw notFound(method);
  }

  return {
    /** One line of the client's JSON-RPC in, one line of JSON-RPC out (or null: a notification is never answered). */
    async receive(line) {
      let message;
      try { message = JSON.parse(line); } catch (error) { return envelope(null, {code: -32700, message: `The message is not JSON: ${error.message}.`}); }
      const id = message && typeof message === 'object' && !Array.isArray(message) && message.id !== undefined && message.id !== null ? message.id : null;
      if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.method !== 'string') {
        return envelope(id, {code: -32600, message: 'The message is not a JSON-RPC 2.0 request.'});
      }
      if (id === null) return null; // A notification (initialized, cancelled): never answered.
      try {
        return envelope(id, undefined, await dispatch(message.method, message.params));
      } catch (error) {
        return envelope(id, {code: error?.mcpCode ?? -32603, message: String(error?.message ?? error)});
      }
    },
    dispose: () => control.dispose(),
  };
}

function envelope(id, error, result) {
  return JSON.stringify(error ? {jsonrpc: '2.0', id, error} : {jsonrpc: '2.0', id, result});
}

async function main(argv) {
  let pid = Number.isInteger(Number(process.env.STYK_MCP_PID)) ? Number(process.env.STYK_MCP_PID) : null;
  for (let index = 0; index < argv.length; index++) if (argv[index] === '--pid') pid = Number(argv[++index]);
  if (pid !== null && !Number.isInteger(pid)) { process.stderr.write('The --pid is not a number.\n'); return 2; }
  const server = createMcpServer({pid});
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;
    for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      server.receive(line).then(answer => { if (answer !== null) process.stdout.write(`${answer}\n`); },
        error => process.stderr.write(`The server failed: ${error?.message ?? error}\n`));
    }
  });
  process.stdin.on('end', () => server.dispose());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
