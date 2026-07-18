declare function initDefaultPrompts(): Promise<void>;
declare function recordPromptOutcome(promptType: string, success: boolean): Promise<void>;
declare function getPromptReport(): Promise<string>;
declare const _default: {
    initDefaultPrompts: typeof initDefaultPrompts;
    recordPromptOutcome: typeof recordPromptOutcome;
    getPromptReport: typeof getPromptReport;
};
export = _default;
//# sourceMappingURL=promptOptimizer.d.ts.map