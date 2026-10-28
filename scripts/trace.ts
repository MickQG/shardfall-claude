import { definedIds, untested } from './traceLib';

const missing = untested('specs', 'tests');
const total = definedIds('specs').length;

if (missing.length > 0) {
  console.error(`Requirements without a citing test (${missing.length}/${total}):`);
  for (const id of missing) console.error(`  - ${id}`);
  process.exit(1);
}
console.log(`Traceability OK: ${total} requirements, all cited by tests.`);
