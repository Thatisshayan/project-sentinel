declare function loadSettings(forceRefresh?: boolean): Promise<any>;
declare function getEnvFallbacks(): any;
declare function updateSettings(updates: Record<string, any>): Promise<void>;
declare const _default: {
    loadSettings: typeof loadSettings;
    getEnvFallbacks: typeof getEnvFallbacks;
    updateSettings: typeof updateSettings;
};
export = _default;
//# sourceMappingURL=settingsLoader.d.ts.map