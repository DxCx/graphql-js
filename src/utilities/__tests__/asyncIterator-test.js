import { expect } from 'chai';
import { describe, it } from 'mocha';
import { getAsyncIterator, createAsyncIterator } from 'iterall';
import {
  takeFirstAsyncIterator,
  combineLatestAsyncIterator,
  concatAsyncIterator,
  asyncIteratorForObject,
  switchMapAsyncIterator,
  mapAsyncIterator,
  defferAsyncIterator,
  catchErrorsAsyncIterator,
  toAsyncIterator,
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

  it('handles 1 short iterator', async () => {
    const iterators = [
      createAsyncIterator([ 1 ]),
    ];

    const result = await asyncToArray(combineLatestAsyncIterator(iterators));

    expect(result).to.deep.equal([
      [ 1 ],
    ]);
  });

  it('handles 2 short iterators', async () => {
    const iterators = [
      createAsyncIterator([ 1 ]),
      createAsyncIterator([ 2 ]),
    ];

    const result = await asyncToArray(combineLatestAsyncIterator(iterators));

    expect(result).to.deep.equal([
      [ 1, 2 ],
    ]);
  });

  it('handles 2 unligned iterators', async () => {
    const iterators = [
      createAsyncIterator([ 1 ]),
      createAsyncIterator([ 2, 3 ]),
    ];

    const result = await asyncToArray(combineLatestAsyncIterator(iterators));

    expect(result).to.deep.equal([
      [ 1, 2 ],
      [ 1, 3 ],
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

  it('works as expected for one value as well', async () => {
    const iterators = {
      a: createAsyncIterator([ 1 ]),
    };
    const result = await asyncToArray(asyncIteratorForObject(iterators));

    expect(result).to.deep.equal([
      { a: 1 },
    ]);
  });
});

describe('switchMapAsyncIterator', () => {
  it('pass sanity', async () => {
    const outer = createAsyncIterator([
      promiseGen(1, 50),
      promiseGen(2, 300),
    ]);
    const innerGen = () => createAsyncIterator([ promiseGen(3, 100), 4, 5 ]);
    const switched = switchMapAsyncIterator(outer, outRes => {
      return mapAsyncIterator(innerGen(), inRes => [ outRes, inRes ]);
    });

    const result = await asyncToArray(switched);

    expect(result).to.deep.equal([
      [ 1, 3 ],
      [ 1, 4 ],
      [ 1, 5 ],
      [ 2, 3 ],
      [ 2, 4 ],
      [ 2, 5 ],
    ]);
  });

  it('actually switches if outer emits before inner completes', async () => {
    const outer = createAsyncIterator([
      promiseGen(1, 50),
      promiseGen(2, 200),
    ]);
    const innerGen = () => createAsyncIterator([
      promiseGen(3, 100),
      4,
      promiseGen(5, 200),
    ]);
    const switched = switchMapAsyncIterator(outer, outRes => {
      return mapAsyncIterator(innerGen(), inRes => [ outRes, inRes ]);
    });

    const result = await asyncToArray(switched);

    expect(result).to.deep.equal([
      [ 1, 3 ],
      [ 1, 4 ],
      [ 2, 3 ],
      [ 2, 4 ],
      [ 2, 5 ],
    ]);
  });
});

describe('defferAsyncIterator', () => {
  it('pass sanity', async () => {
    const iterator = createAsyncIterator([ 1, 2 ]);
    const result = await asyncToArray(defferAsyncIterator(iterator));
    expect(result).to.deep.equal([ undefined, 1, 2 ]);
  });
});

describe('catchErrorsAsyncIterator', () => {
  it('invisable if no error happens ', async () => {
    const iterator = createAsyncIterator([ 1, 2 ]);
    const catchedIterator = catchErrorsAsyncIterator(iterator, () => {
      return createAsyncIterator([]);
    });

    const result = await asyncToArray(catchedIterator);
    expect(result).to.deep.equal([ 1, 2 ]);
  });

  it('actually catches error', async () => {
    const iterator = createAsyncIterator([
      1,
      Promise.reject(new Error('hold')),
      2,
    ]);
    const catchedIterator = catchErrorsAsyncIterator(iterator, e => {
      return createAsyncIterator([ e.message ]);
    });

    const result = await asyncToArray(catchedIterator);
    expect(result).to.deep.equal([ 1, 'hold' ]);
  });

  it('not recursive', async () => {
    const iterator = createAsyncIterator([
      1,
      Promise.reject(new Error('hold')),
      2,
    ]);
    const catchedIterator = catchErrorsAsyncIterator(iterator, e => {
      throw e;
    });

    try {
      await asyncToArray(catchedIterator);
    } catch (e) {
      expect(e.message).to.equal('hold');
    }
  });
});

describe('async iterator operator mixing', () => {
  it('asyncIteratorForObject From toAsyncIterator Promise', async () => {
    const value = toAsyncIterator(promiseGen('Works'));
    const iterator = asyncIteratorForObject({
      test: takeFirstAsyncIterator(value),
    });

    const result = await asyncToArray(iterator);
    expect(result).to.deep.equal([ { test: 'Works' } ]);
  });
});
