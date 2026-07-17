declare module 'tmp' {
  interface TmpDirResult {
    name: string;
    removeCallback: () => void;
  }
  function dirSync(options?: { unsafeCleanup?: boolean; prefix?: string }): TmpDirResult;
  export { dirSync };
  export default { dirSync };
}
