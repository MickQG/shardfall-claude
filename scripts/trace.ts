import { definedIds, duplicateIds, untested } from './traceLib';

const dups = duplicateIds('specs');
if (dups.length > 0) {
  console.error(`Requirement IDs defined more than once (${dups.length}):`);
  for (const id of dups) console.error(`  - ${id}`);
  process.exit(1);
}

const missing = untested('specs', 'tests');
const total = definedIds('specs').length;

if (missing.length > 0) {
  console.error(`Requirements without a citing test (${missing.length}/${total}):`);
  for (const id of missing) console.error(`  - ${id}`);
  process.exit(1);
}
console.log(`Traceability OK: ${total} requirements, all cited by tests.`);
