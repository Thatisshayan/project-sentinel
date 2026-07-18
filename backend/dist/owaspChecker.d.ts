interface OwaspItemDef {
    id: string;
    name: string;
    weight: number;
}
interface OwaspEvaluation {
    id: string;
    status: string;
    notes: string;
}
declare function evaluateOwasp(repoName: string, repoPath: string, fileList: string[]): Promise<{
    results: OwaspEvaluation[];
    owaspScore: number;
}>;
declare const _default: {
    evaluateOwasp: typeof evaluateOwasp;
    OWASP_ITEMS: OwaspItemDef[];
};
export = _default;
//# sourceMappingURL=owaspChecker.d.ts.map