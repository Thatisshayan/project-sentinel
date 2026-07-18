declare function checkAndHeal(): Promise<void>;
declare function reportFailure(componentName: string, error: any): Promise<void>;
declare function reportSuccess(componentName: string): Promise<void>;
declare const _default: {
    reportFailure: typeof reportFailure;
    reportSuccess: typeof reportSuccess;
    checkAndHeal: typeof checkAndHeal;
};
export = _default;
//# sourceMappingURL=selfHealer.d.ts.map