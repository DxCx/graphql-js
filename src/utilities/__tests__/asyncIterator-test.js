import { expect } from 'chai';
import { describe, it } from 'mocha';
import { getAsyncIterator, createAsyncIterator } from 'iterall';
import { takeFirstAsyncIterator } from '../asyncIterator';

async function asyncToArray(iterable) {
  const responses = [];
  const infiateLoop = true;
  const iter = getAsyncIterator(iterable);

  while (infiateLoop) {
    const result = await iter.next(); // eslint-disable-line no-await-in-loop

    if ( result.done ) {
      break;
    }

    responses.push(result.value);
  }

  return responses;
}

describe('takeFirstAsyncIterator', () => {
  it('pass sanity', async () => {
    const iterator = createAsyncIterator([ 1, 2 ]);
    const result = await asyncToArray(takeFirstAsyncIterator(iterator));
    expect(result).to.deep.equal([ 1 ]);
  });
});
