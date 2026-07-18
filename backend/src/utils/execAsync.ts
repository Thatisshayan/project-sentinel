import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { buildChildEnv } from './childEnv';

const exec = promisify(execCallback);

export interface ExecOptions {
  cwd?: string;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
  /**
   * Set true when the command runs against externally-controlled input
   * (e.g. `npm ci`/`npm install`/`pip install`/`npm audit fix` inside a
   * cloned target repo). Package manager installs can trigger arbitrary
   * postinstall/setup scripts from that repo's manifest — those scripts
   * must not inherit app secrets (DB URL, bot tokens, API keys). When set,
   * the child gets childEnv's allowlisted env instead of the full
   * process.env. Defaults to false to preserve existing behavior for
   * trusted, fixed commands (version checks, audits of our own output).
   */
  scoped?: boolean;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export async function execAsync(command: string, options: ExecOptions = {}): Promise<ExecResult> {
  const baseEnv = options.scoped ? buildChildEnv() : process.env;
  const { stdout, stderr } = await exec(command, {
    cwd: options.cwd,
    timeout: options.timeout ?? 120000,
    env: { ...baseEnv, ...options.env },
    maxBuffer: options.maxBuffer ?? 1024 * 1024 * 10,
  });
  return { stdout, stderr };
}

export async function execAsyncQuiet(command: string, options: ExecOptions = {}): Promise<string> {
  const { stdout } = await execAsync(command, options);
  return stdout.trim();
}