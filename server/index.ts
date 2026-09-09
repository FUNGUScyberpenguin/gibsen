#!/usr/bin/env node
/** Entry point: run the GIBSEN MCP server on stdio. */

import { main } from './mcp';

main().catch((error) => {
  console.error('gibsen-mcp failed to start:', error);
  process.exit(1);
});
