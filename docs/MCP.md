# Model Context Protocol server

`scripts/styk-mcp.mjs` serves the developer tools' control channel ([DEVTOOLS.md](DEVTOOLS.md) "Control channel") as a
Model Context Protocol (MCP) server. A client that speaks MCP — Claude Desktop, an IDE extension, an agent — launches
the server once, and its tools reach the running developer build: inspect the document, run the app's own commands,
move the playhead, answer file dialogs, take screenshots. Where a script would otherwise drive the app from outside,
the agent uses the app through the same narrow reads and the same actions its developer panel uses, and every change
is a session command with undo.

The server is a single Node script with no dependencies. It speaks JSON-RPC 2.0 over stdio with the client, and talks
to the app over the same local pipe `scripts/styk-dev.mjs` does. It never starts the app and never opens a network
port; a packaged app serves no channel, so nothing here reaches it.

## Requirements

- a source checkout with its engine built (`npm run engine:build`);
- a developer launch running: `npm run dev` (a packaged app, and plain `npm start`, serve no control channel);
- Node 22 or newer, as the repository's build needs.

Start the app before connecting the client. To keep an agent off your own projects, launch it on scratch folders, as
the smoke scripts do: `STYK_USER_DATA_DIR` and `STYK_LIBRARY_DIR` pointed at new empty folders.

## Connecting a client

Add the server to the client's MCP configuration:

```json
{
  "mcpServers": {
    "stykanimate": {
      "command": "node",
      "args": ["/path/to/StykAnimate-App/scripts/styk-mcp.mjs"]
    }
  }
}
```

With several developer builds running, name one in `args` (`"…styk-mcp.mjs", "--pid", "1234"`) or in the
`STYK_MCP_PID` environment variable; with none named, the server talks to the only build running. `list_running_builds`
reports what the server can see, and every tool's failure says what to do next.

## The tools

The tools are the channel's operations, with the request and answer shapes [DEVTOOLS.md](DEVTOOLS.md) documents. In
the order an agent meets them:

- **See:** `get_app_state`, `screenshot_stage` (the stage as an MCP image), `get_metrics`, `get_memory`,
  `get_engine_boundary`, `read_logs`, `wait_until_settled`, `measure_display_period`.
- **Inspect the document:** `read_document_tree`, `read_current_frame`, `read_edit_history`,
  `list_edit_session_calls`, `app_hello` (the channel's own hello, with every operation it answers).
- **Act:** `run_editor_command` and `list_editor_commands` — the app's command registry, what the menus and the
  command palette run; `seek_to_tick`, `play_animation`, `pause_animation`, `undo_change`, `redo_change`,
  `set_selection`, `set_view`, `find_handle_to_drag`, `open_document`, `answer_file_dialog` (desktop only).
- **Tune and measure:** `list_live_parameters`, `set_live_parameter`, `reset_live_parameters`,
  `start_trace_capture`, `stop_trace_capture`, `read_trace_page`, `recent_trace_summary`.
- **Reach the rest:** `raw_control_operation` passes one request to any operation the channel answers —
  `params.save`, `memory.breakdown`, `environment`, `startup`, `process.metrics`, `document.mark`, `document.wait` —
  exactly as [DEVTOOLS.md](DEVTOOLS.md) documents it.

`list_running_builds` answers without the app, from the pipes on this machine.

## How it behaves

- Calls run one at a time, in order, because the pipe answers in order.
- An answer is bounded to the pipe's 1 MiB, and a call waits at most 150 s before the server gives up.
- A pipe that dropped (the app was closed) is reconnected once and the request is sent again; a capture taken before
  the drop is gone, as the app's rings are.
- An error the app itself answered comes back as a tool result with `isError`, carrying the channel's `what`, `where`,
  `input` and `hint` — the same fields `scripts/styk-dev.mjs` prints.
- A screenshot arrives as MCP image content, so the client shows the stage without another step.

## Checks

`node --test tests/styk-mcp.test.mjs` runs the server against a fake channel: the protocol answers, the tool list's
schemas, how each tool call maps to its operation, the failures an agent reads, the one-retry reconnect, and the
order of calls through the pipe.
