"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.execAsync = execAsync;
exports.execAsyncQuiet = execAsyncQuiet;
const child_process_1 = require("child_process");
const util_1 = require("util");
const exec = (0, util_1.promisify)(child_process_1.exec);
async function execAsync(command, options = {}) {
    const { stdout, stderr } = await exec(command, {
        cwd: options.cwd,
        timeout: options.timeout ?? 120000,
        env: { ...process.env, ...options.env },
        maxBuffer: options.maxBuffer ?? 1024 * 1024 * 10,
    });
    return { stdout, stderr };
}
async function execAsyncQuiet(command, options = {}) {
    const { stdout } = await execAsync(command, options);
    return stdout.trim();
}
//# sourceMappingURL=execAsync.js.map