export interface ExecOptions {
    cwd?: string;
    timeout?: number;
    env?: NodeJS.ProcessEnv;
    maxBuffer?: number;
}
export interface ExecResult {
    stdout: string;
    stderr: string;
}
export declare function execAsync(command: string, options?: ExecOptions): Promise<ExecResult>;
export declare function execAsyncQuiet(command: string, options?: ExecOptions): Promise<string>;
//# sourceMappingURL=execAsync.d.ts.map