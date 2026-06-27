// Small retry helper for stale Tauri/Rust build-cache failures.

export function isStaleTauriCacheError(output) {
  return (
    /failed to read plugin permissions/i.test(output) &&
    /src-tauri[/\\]target/i.test(output) &&
    /No such file or directory|os error 2|ENOENT/i.test(output)
  );
}

export function runWithStaleTauriCacheRetry({
  runTauri,
  cleanCargo,
  log = console.log,
  retryOnStaleCache = true,
}) {
  const first = runTauri();
  if (
    first.status === 0 ||
    !retryOnStaleCache ||
    !isStaleTauriCacheError(first.output ?? '')
  ) {
    return first;
  }

  log(
    '\n[build-desktop] detected stale Tauri/Rust permission cache; ' +
      'cleaning src-tauri/target and retrying once...',
  );
  const clean = cleanCargo();
  if (clean.status !== 0) return clean;
  return runTauri();
}
