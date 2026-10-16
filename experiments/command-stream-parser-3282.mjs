// Issue #3282: how command-stream's shell-parser tokenizes '\''-escaped values next to | & ;
import { parseShellCommand } from '../node_modules/command-stream/src/shell-parser.mjs';
import { quote } from 'command-stream';
const cmd = process.argv[2] ?? `node -p ${quote("it's")} --append-system-prompt ${quote("Use the 'file' command; a | b & c")}`;
console.log(cmd);
console.log(JSON.stringify(parseShellCommand(cmd), null, 1).slice(0, 1500));
