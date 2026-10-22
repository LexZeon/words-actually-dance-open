import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chooseDisplay } = createRequire(import.meta.url)('../electron/display-policy.cjs');
const displays = [
  { id: 1, label: 'Other', size: { width: 1920, height: 1080 } },
  { id: 2, label: 'ASUS PA279', size: { width: 1440, height: 2560 } },
];
test('local and test builds retain ASUS-only selection', async () => {
  assert.equal((await chooseDisplay({ displays })).id, 2);
  assert.equal((await chooseDisplay({ displays, distribution: 'open-source', testMode: true })).id, 2);
  await assert.rejects(chooseDisplay({ displays: displays.slice(0, 1) }), /ASUS/);
});
test('public build requires explicit human choice then can restore its connected display', async () => {
  let choices;
  assert.equal(
    (
      await chooseDisplay({
        displays,
        distribution: 'open-source',
        choose: async (values) => {
          choices = values;
          return 1;
        },
      })
    ).id,
    1,
  );
  assert.equal(choices.length, 2);
  assert.equal(
    (
      await chooseDisplay({
        displays,
        distribution: 'open-source',
        preferredId: 1,
        choose: () => assert.fail('unnecessary prompt'),
      })
    ).id,
    1,
  );
  await assert.rejects(
    chooseDisplay({ displays, distribution: 'open-source', preferredId: 99, choose: async () => null }),
    /尚未选择/,
  );
});
test('explicit display must actually exist', async () => {
  assert.equal((await chooseDisplay({ displays, explicitId: 1 })).id, 1);
  await assert.rejects(chooseDisplay({ displays, explicitId: 999 }), /不可用/);
});
