/* @flow */

import {
  createAsyncIterator,
  getAsyncIterator,
  isAsyncIterable,
  $$asyncIterator,
} from 'iterall';

/**
 * Given an AsyncIterable and a callback function, return an AsyncIterator
 * which produces values mapped via calling the callback function.
 */
export function mapAsyncIterator<T, U>(
  iterable: AsyncIterable<T>,
  callback: (value: T) => Promise<U> | U
): AsyncGenerator<U, void, void> {
  const iterator = getAsyncIterator(iterable);
  let $return;
  let abruptClose;
  if (typeof iterator.return === 'function') {
    $return = iterator.return;
    abruptClose = error => {
      const rethrow = () => Promise.reject(error);
      return $return.call(iterator).then(rethrow, rethrow);
    };
  }

  function mapResult(result) {
    return result.done ?
      result :
      asyncMapValue(result.value, callback).then(iteratorResult, abruptClose);
  }

  return {
    next() {
      return iterator.next().then(mapResult);
    },
    return() {
      return $return ?
        $return.call(iterator).then(mapResult) :
        Promise.resolve({ value: undefined, done: true });
    },
    throw(error) {
      if (typeof iterator.throw === 'function') {
        return iterator.throw(error).then(mapResult);
      }
      return Promise.reject(error).catch(abruptClose);
    },
    [$$asyncIterator]() {
      return this;
    },
  };
}

function asyncMapValue<T, U>(
  value: T,
  callback: (T) => Promise<U> | U
): Promise<U> {
  return new Promise(resolve => resolve(callback(value)));
}

function iteratorResult<T>(value: T): IteratorResult<T, void> {
  return { value, done: false };
}

/**
 * Only returns true if value acts like a Promise, i.e. has a "then" function,
 * otherwise returns false.
 */
function isPromise(value: mixed): boolean {
  if (typeof value === 'object' &&
      value !== null &&
      typeof value.then === 'function') {
    return true;
  }

  return false;
}

/**
 * this function recursively searches for AsyncIterators.
 * returns true if found or false if not.
 */
function objectContainsAsyncIterator(
  object: mixed
): boolean {
  if ( object === null ) {
    return false;
  }

  if ( isAsyncIterable(object) || isPromise(object) ) {
    // AsyncIterator/Promise found,
    // returns true then Promise will be converted into Async Iterator
    return true;
  }

  if ( Array.isArray(object) ) {
    // Go over all of the array values, recursively search for AsyncIterator.
    return object.some(value => objectContainsAsyncIterator(value));
  }

  if ( typeof object === 'object' ) {
    const asObject = (object: { [key: string]: mixed });
    // Go over all of the object values, recursively search for AsyncIterator.
    return Object.keys(asObject)
      .some(value => objectContainsAsyncIterator(asObject[value]));
  }

  return false;
}

/**
 * Utility function used to convert all possible result types into AsyncIterator
 */
export function toAsyncIterator(result: mixed): AsyncIterable<mixed> {
  if (result === undefined) {
    return ((undefined: any): AsyncIterable<mixed>);
  }

  if (result === null) {
    return createAsyncIterator([ null ]);
  }

  if (Array.isArray(result) && (objectContainsAsyncIterator(result) === true)) {
    return combineLatestAsyncIterator(
      result.map(value => toAsyncIterator(value))
    );
  }

  if (isAsyncIterable(result)) {
    return ((result: any): AsyncIterable<mixed>);
  }

  if (isPromise(result)) {
    return createAsyncIterator([ result ]);
  }

  if ((!Array.isArray(result)) &&
      (typeof result === 'object') &&
      (objectContainsAsyncIterator(result) === true)) {
    return asyncIteratorForObject((result: {[key: string]: mixed}));
  }

  return createAsyncIterator([ result ]);
}

/**
 * Utility function to combineLatest asyncIterator results
 */
export function combineLatestAsyncIterator(
  iterables: Array<AsyncIterable<mixed>>
): AsyncIterable<Array<mixed>> {
  let liveIterators:Array<AsyncIterator<mixed>> = iterables.map(
    iter => getAsyncIterator(iter)
  );

  async function* combineLatestGenerator() {
    // The state for this combination.
    const state = [];

    // Generate next Iteration.
    function getNext() {
      return liveIterators.map((iter, i) => {
        const p:(Promise<Array<mixed>> & { done?: boolean }) =
          iter.next().then(({value, done}) => {
            if (done) {
              liveIterators = liveIterators.filter(x => x !== iter);
            } else {
              state[i] = value;
            }

            p.done = true;
            return [ ...state ];
          });

        return p;
      });
    }

    function getFirstState() {
      // make sure every iterator runs at least once.
      // and then return latest result
      let stateLatest = [];

      return Promise.all(
        getNext().map(p => p.then(stateNow => {
          stateLatest = stateNow;
          return stateNow;
        }))
      ).then(() => stateLatest);
    }

    // Yield latest state for each changing state.
    async function* nextValues() {
      let nextPromises = getNext();

      while ( nextPromises.length > 0 ) {
        let res = Promise.race(nextPromises);
        res = await res; // eslint-disable-line no-await-in-loop
        yield res;
        nextPromises = nextPromises.filter(p => !p.done);
      }
    }

    // Yield initial state
    yield await getFirstState();

    while ( liveIterators.length > 0 ) {
      yield* nextValues();
    }
  }

  return {
    [$$asyncIterator]: combineLatestGenerator,
  };
}

/**
 * Utility function to concat asyncIterator results
 */
export function concatAsyncIterator<T>(
  iterable: AsyncIterable<T>,
  concatCallback: (latestValue: ?T) => AsyncIterable<T> | T
): AsyncIterable<T> {
  const iterator = getAsyncIterator(iterable);

  async function* concatGenerator() {
    let latestValue: T;
    const infinateLoop = true;

    while ( infinateLoop ) {
      const i = await iterator.next(); // eslint-disable-line no-await-in-loop
      if ( i.done ) {
        break;
      }

      latestValue = i.value;
    }

    const next: AsyncIterable<T> | T = concatCallback(latestValue);
    const nextIterator: ?AsyncIterator<T> = getAsyncIterator(next);
    if ( nextIterator ) {
      yield* nextIterator;
    } else {
      yield ((next: any): T);
    }
  }

  return {
    [$$asyncIterator]: concatGenerator,
  };
}

/**
 * Utility function to take only first result of asyncIterator results
 */
export function takeFirstAsyncIterator<T>(
  iterable: AsyncIterable<T>,
): AsyncIterable<?T> {
  const iterator = getAsyncIterator(iterable);

  async function* takeFirstGenerator() {
    // take only first promise.
    yield await iterator.next().then(({ value }) => value);

    if ( typeof iterator.return === 'function' ) {
      iterator.return();
    }
  }

  return {
    [$$asyncIterator]: takeFirstGenerator,
  };
}

/**
 * Utility function to catch errors of asyncIterator
 */
export function catchErrorsAsyncIterator<T>(
  iterable: AsyncIterable<T>,
  errorHandler: (error: any) => AsyncIterable<T>
): AsyncIterable<T> {
  const iterator = getAsyncIterator(iterable);

  async function* catchGenerator() {
    let err: ?AsyncIterable<T>;
    let hasError = false;
    const infinateLoop = true;

    while (infinateLoop) {
      let c:IteratorResult<T, void>;

      try {
        c = await iterator.next(); // eslint-disable-line no-await-in-loop
        if (c.done) { break; }
      } catch (e) {
        err = await errorHandler(e); // eslint-disable-line no-await-in-loop
        hasError = true;
        break;
      }

      yield c.value;
    }

    if (hasError && err) {
      yield *err;
    }
  }

  return {
    [$$asyncIterator]: catchGenerator,
  };
}

/**
 * Utility function to switchMap over asyncIterator
 */
export function switchMapAsyncIterator<T, U>(
  iterable: AsyncIterable<T>,
  switchMapCallback: (value: T) => AsyncIterable<U>
): AsyncIterable<U> {
  const iterator = getAsyncIterator(iterable);

  async function* switchMapGenerator() {
    const infinateLoop = true;
    let outerValue:IteratorResult<T, void>;

    outerValue = await iterator.next();
    while (!outerValue.done) {
      const switchMapResult = switchMapCallback(outerValue.value);
      const inner = getAsyncIterator(switchMapResult);

      let $return = () => ({ done: true });
      if (typeof iterator.return === 'function') {
        $return = iterator.return;
      }

      let nextPromise;
      const switchValue = iterator.next().then((newOuter => {
        outerValue = newOuter;
        if ( newOuter.done ) {
          return nextPromise;
        }

        return $return.call(inner);
      }));

      while (infinateLoop) {
        nextPromise = inner.next();

        const resProm = (!outerValue.done ? Promise.race([
          switchValue, nextPromise
        ]) : nextPromise);
        const result: IteratorResult<U, void> =
          await resProm; // eslint-disable-line no-await-in-loop

        if ( result.done ) {
          break;
        }

        yield result.value;
      }
    }
  }

  return {
    [$$asyncIterator]: switchMapGenerator,
  };
}

/**
 * Utility function to deffer over asyncIterator
 */
export function DefferAsyncIterator<T>(
  iterable: AsyncIterable<T>,
): AsyncIterable<?T> {
  const iterator = getAsyncIterator(iterable);

  async function* defferGenerator() {
    // reply with undefine as initial result.
    yield undefined;

    // yield the origial iterator.
    yield* iterator;
  }

  return {
    [$$asyncIterator]: defferGenerator,
  };
}

/**
 * This function transforms a JS object `{[key: string]: Promise<T>}` into
 * a `Promise<{[key: string]: T}>`
 *
 * This is akin to bluebird's `Promise.props`, but implemented only using
 * `Promise.all` so it will work with any implementation of ES6 promises.
 */
export function asyncIteratorForObject<T>(
  object: {[key: string]: mixed}
): AsyncIterable<{[key: string]: T}> {
  const keys = Object.keys(object);
  const valuesAndPromises = keys.map(name => object[name]);
  const combined = combineLatestAsyncIterator(
    valuesAndPromises.map(value => toAsyncIterator(value))
  );

  return mapAsyncIterator(combined, values => values.reduce(
    (resolvedObject, value, i) => {
      resolvedObject[keys[i]] = value;
      return resolvedObject;
    }, Object.create(null))
  );
}
