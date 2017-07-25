import { expect } from 'chai';
import { describe, it } from 'mocha';
import { getAsyncIterator, createAsyncIterator } from 'iterall';
import {
  takeFirstAsyncIterator,
  combineLatestAsyncIterator,
  concatAsyncIterator,
  asyncIteratorForObject,
} from '../asyncIterator';

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

const promiseGen = (value, timeout) => new Promise(resolve => {
  setTimeout(() => resolve(value), timeout);
});

describe('takeFirstAsyncIterator', () => {
  it('pass sanity', async () => {
    const iterator = createAsyncIterator([ 1, 2 ]);
    const result = await asyncToArray(takeFirstAsyncIterator(iterator));
    expect(result).to.deep.equal([ 1 ]);
  });
});

describe('combineLatestAsyncIterator', () => {
  it('pass sanity', async () => {
    const iterators = [
      createAsyncIterator([ 1, 2 ]),
      createAsyncIterator([ 3, 4, 5 ]),
    ];

    const result = await asyncToArray(combineLatestAsyncIterator(iterators));

    expect(result).to.deep.equal([
      [ 1, 3 ],
      [ 2, 3 ],
      [ 2, 4 ],
      [ 2, 5 ],
    ]);
  });

  it('also handles 3 iterators', async () => {
    const iterators = [
      createAsyncIterator([ promiseGen(1, 50), 2 ]),
      createAsyncIterator([ promiseGen(3, 100), 4, 5 ]),
      createAsyncIterator([ promiseGen(6, 70) ]),
    ];

    const result = await asyncToArray(combineLatestAsyncIterator(iterators));

    expect(result).to.deep.equal([
      [ 1, 3, 6 ],
      [ 2, 3, 6 ],
      [ 2, 4, 6 ],
      [ 2, 5, 6 ],
    ]);
  });
});

describe('concatAsyncIterator', () => {
  it('pass sanity', async () => {
    const iterator = createAsyncIterator([ 1, 2 ]);
    const nextIterator = concatAsyncIterator(iterator, state => {
      return [ ...state, 3, 4 ];
    });

    const result = await asyncToArray(takeFirstAsyncIterator(nextIterator));
    expect(result).to.deep.equal([ [ 2, 3, 4 ] ]);
  });
});

describe('asyncIteratorForObject', () => {
  it('pass sanity', async () => {
    const iterators = {
      a: createAsyncIterator([ promiseGen(1, 50), 2 ]),
      b: createAsyncIterator([ promiseGen(3, 100), 4, 5 ]),
      c: createAsyncIterator([ promiseGen(6, 70) ]),
    };

    const result = await asyncToArray(asyncIteratorForObject(iterators));

    expect(result).to.deep.equal([
      { a: 1, b: 3, c: 6 },
      { a: 2, b: 3, c: 6 },
      { a: 2, b: 4, c: 6 },
      { a: 2, b: 5, c: 6 },
    ]);
  });
});
