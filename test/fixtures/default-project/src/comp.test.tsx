// Matches the DEFAULT_CONFIG.ignore glob ("**/*.test.*") — this violation
// must never appear in the golden output.
export function CompTest() {
  return <div className="m-8">Should be ignored by the default ignore glob</div>;
}
