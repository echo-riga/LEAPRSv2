import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAmountInput, parseAmountInput } from '../src/lib/amount-format.ts';

test('amount fields group thousands and hide stored decimal zeros', () => {
  for (const [raw, display] of [['', ''], ['0', '0'], ['10000', '10,000'], ['20000.00', '20,000'], ['100000', '100,000'], ['9999999999', '9,999,999,999']]) {
    assert.equal(formatAmountInput(raw), display);
  }
});

test('editing and pasting grouped amounts keeps raw whole numbers for saving', () => {
  for (const [input, raw] of [['', ''], ['0', '0'], ['00020', '20'], ['20,000', '20000'], ['100,000', '100000']]) {
    assert.equal(parseAmountInput(input), raw);
  }
});

test('fractional and invalid input cannot become an unintended larger amount', () => {
  for (const input of ['20,000.50', '1.5', '-20000', '1e5', 'abc']) {
    assert.equal(parseAmountInput(input), null);
  }
});
