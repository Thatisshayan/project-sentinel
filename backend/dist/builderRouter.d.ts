interface BuilderConfig {
    id: string;
    label: string;
    type: string;
    aiderModel?: string;
    editFormat?: string;
    apiBase?: string;
    envKey?: string;
    description: string;
}
declare function getFallbackBuilder(failedBuilder: string): string | null;
declare function getBuilderConfig(assignment?: string): BuilderConfig;
declare function getAiderEnv(config: BuilderConfig): Record<string, string | undefined>;
declare function listBuilders(): Array<{
    id: string;
    label: string;
    configured: boolean;
    description: string;
}>;
declare const _default: {
    getBuilderConfig: typeof getBuilderConfig;
    getAiderEnv: typeof getAiderEnv;
    listBuilders: typeof listBuilders;
    getFallbackBuilder: typeof getFallbackBuilder;
};
export = _default;
//# sourceMappingURL=builderRouter.d.ts.map