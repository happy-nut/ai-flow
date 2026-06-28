export type RelaunchTarget = {
  relaunch(options?: { args?: string[] }): void;
  exit(exitCode?: number): void;
};

export function relaunchArgsForCwd(argv: string[], cwd: string): string[] {
  const args = argv.slice(1);
  const cwdIndex = args.indexOf("--cwd");
  if (cwdIndex >= 0) {
    if (cwdIndex === args.length - 1) args.push(cwd);
    else args[cwdIndex + 1] = cwd;
  } else {
    args.push("--cwd", cwd);
  }
  return args;
}

export function relaunchUpdatedApp(app: RelaunchTarget, argv: string[], cwd: string): void {
  app.relaunch({ args: relaunchArgsForCwd(argv, cwd) });
  app.exit(0);
}
