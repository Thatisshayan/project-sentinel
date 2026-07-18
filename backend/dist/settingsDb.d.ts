declare function initSettingsSchema(): Promise<void>;
declare function getSettings(): Promise<Record<string, any>>;
declare function updateSettings(updates: Record<string, any>): Promise<any>;
declare const _default: {
    initSettingsSchema: typeof initSettingsSchema;
    getSettings: typeof getSettings;
    updateSettings: typeof updateSettings;
};
export = _default;
//# sourceMappingURL=settingsDb.d.ts.map