import { exec as execCallback } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCallback);

export interface ExecOptions {
  cwd?: string;
  timeout?: number;
  stdio?: 'pipe' | 'inherit' | 'ignore' | Array<'pipe' | 'inherit' | 'ignore' | number>;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export async function execAsync(command: string, options: ExecOptions = {}): Promise<ExecResult> {
  const { stdout, stderr } = await exec(command, {
    cwd: options.cwd,
    timeout: options.timeout ?? 120000,
    stdio: options.stdio ?? 'pipe',
    env: { ...process.env, ...options.env },
    maxBuffer: options.maxBuffer ?? 1024 * 1024 * 10,
  });
  return { stdout, stderr };
}

export async function execAsyncQuiet(command: string, options: ExecOptions = {}): Promise<string> {
  const { stdout } = await execAsync(command, { ...options, stdio: 'pipe' });
  return stdout.trim();
}

export async function execAsyncInherit(command: string, options: ExecOptions = {}): Promise<void> {
  await execAsync(command, { ...options, stdio: 'inherit' });
}