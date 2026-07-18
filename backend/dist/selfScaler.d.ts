declare function initSelfScaler(): Promise<void>;
declare function getEffectiveBatchSize(): number;
declare function getEffectiveDailyLimit(): number;
declare function runSelfScaler(): Promise<any>;
declare const _default: {
    runSelfScaler: typeof runSelfScaler;
    getEffectiveBatchSize: typeof getEffectiveBatchSize;
    getEffectiveDailyLimit: typeof getEffectiveDailyLimit;
    initSelfScaler: typeof initSelfScaler;
};
export = _default;
//# sourceMappingURL=selfScaler.d.ts.map