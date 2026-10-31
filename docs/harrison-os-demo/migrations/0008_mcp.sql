-- MCP server (Slice 3.2). No tables of its own: authority is configuration (MCP_SCOPES, MCP_ALLOW_CAPTURE,
-- ACCESS_AUD_MCP), tool calls are audited in the core events table (tool, scope, count, ok; never text) and
-- the last call time is kept in meta ('mcp_last_call_at'). Keep one statement so wrangler applies it cleanly.
SELECT 1;
