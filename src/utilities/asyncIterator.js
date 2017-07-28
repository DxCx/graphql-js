/* @flow */

import {
  createAsyncIterator,
  getAsyncIterator,
  isAsyncIterable,
  $$asyncIterator,
  forAwaitEach,
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

export type AsyncGeneratorFromObserverParams<T> = {
  next: (value: T | Promise<T>) => void,
  error: (error: Error) => void,
  complete: () => void,
};
export type AsyncGeneratorFromObserverFunction<T> =
  (observer: AsyncGeneratorFromObserverParams<T>) => () => void;

export function AsyncGeneratorFromObserver<T>(
  generatorFunction: AsyncGeneratorFromObserverFunction<T>
): AsyncGenerator<T, void, void> {
  const completedPromises: Array<Promise<IteratorResult<T, void>>> = [];
  // Hold Resolve/Reject pair.
  const sentPromises: Array<Array<(v: any) => void>> = [];
  let done: boolean = false;
  let cleanupFunction: ?(() => void);
  const generator: AsyncGeneratorFromObserverFunction<T> = generatorFunction;

  return {
    next() {
      if (completedPromises.length > 0) {
        return completedPromises.shift();
      }

      if ( done ) {
        return Promise.resolve({ done: true });
      }

      return new Promise((r, e) => sentPromises.push([ r, e ]));
    },
    throw(e?: any) {
      return this._cleanup(Promise.reject(e));
    },
    return() {
      return this._cleanup(Promise.resolve({ done: true }));
    },
    [$$asyncIterator]() {
      if ( !cleanupFunction ) {
        this._invoke();
      }
      return this;
    },
    _cleanup(finalPromise: Promise<{ done: true }>) {
      let p = Promise.resolve();
      if ( cleanupFunction ) {
        p = Promise.resolve(cleanupFunction());
        cleanupFunction = undefined;
      }
      return p.then(() => {
        while (sentPromises.length > 0) {
          const [ resolve, ] = sentPromises.shift();
          resolve(finalPromise);
        }

        return finalPromise;
      });
    },
    _invoke() {
      cleanupFunction = generator({
        next: (value: T | Promise<T>) => {
          const item = Promise.resolve(value)
            .then((resValue: T) => iteratorResult(resValue));

          if (sentPromises.length > 0) {
            const [ resolve, ] = sentPromises.shift();

            resolve(item);
          } else {
            completedPromises.push(Promise.resolve(item));
          }
        },
        error: error => {
          if (sentPromises.length > 0) {
            const [ , reject ] = sentPromises.shift();

            reject(error);
          } else {
            completedPromises.push(Promise.reject(error));
          }
        },
        complete: () => {
          done = true;
          cleanupFunction = undefined;
          this._cleanup(Promise.resolve({ done: true }));
        },
      });
    }
  };
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

function promiseRaceWithCleanup<T>(pArr: Array<Promise<T>>): Promise<T> {
  if ( pArr.length === 0 ) {
    return Promise.reject(new Error('Cannot Race with zero Promises'));
  }
  const racePromises = pArr.map((p, i) => p.then(value => ({ i, value })));

  return Promise.race(racePromises).then(({i, value }) => {
    // Cleanup the finished one.
    pArr.splice(i, 1);
    return value;
  });
}

/**
 * Utility function to combineLatest asyncIterator results
 */
export function combineLatestAsyncIterator(
  iterables: Array<AsyncIterable<mixed>>
): AsyncIterable<Array<mixed>> {
  return AsyncGeneratorFromObserver(observer => {
    const allIterators = iterables.map(
      iter => getAsyncIterator(iter)
    )
    .filter(iter => Boolean(iter))
    .map((iter: AsyncIterator<mixed> & {
      return?: () => Promise<void>,
      done?: boolean
    }) => {
      iter.done = false;
      return iter;
    });
    let doneIterators = 0;

    // The state for this combination.
    const state = [];

    // Generate next Iteration.
    function getNext() {
      return allIterators
        .filter(iter => iter.done !== true)
        .map((iter, i) => {
          const p: Promise<IteratorResult<Array<mixed>, void>> =
            iter.next().then(({value, done}) => {
              if (done) {
                iter.done = true;
                doneIterators += 1;
                return { done: true };
              }

              state[i] = value;
              return iteratorResult([ ...state ]);
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
          if ( !stateNow.done ) {
            stateLatest = stateNow.value;
          }
          return stateNow;
        }))
      ).then(() => stateLatest);
    }

    // Yield latest state for each changing state.
    function nextValues() {
      const nextPromises = getNext();
      const next = () => {
        if ( nextPromises.length === 0 ) {
          return Promise.resolve();
        }

        return promiseRaceWithCleanup(nextPromises)
        .then(res => {
          if ( !res.done ) {
            observer.next(res.value);
          }
        }).then(next);
      };

      return next();
    }

    // Yield initial state
    getFirstState().then(initialState => {
      observer.next(initialState);

      const next = () => {
        if ( doneIterators >= allIterators.length ) {
          return;
        }

        return nextValues().then(next);
      };

      return next();
    })
    .then(() => observer.complete(), e => observer.error(e));

    return () => {
      Promise.all(allIterators
        .filter(i => i.done !== true)
        .map(iter => {
          if ( typeof iter.return === 'function' ) {
            return iter.return();
          }
        }));
    };
  });
}

/**
 * Utility function to concat asyncIterator results
 */
export function concatAsyncIterator<T>(
  iterable: AsyncIterable<T>,
  concatCallback: (latestValue: ?T) => AsyncIterable<T> | T
): AsyncIterable<T> {
  return AsyncGeneratorFromObserver(observer => {
    const iterator = getAsyncIterator(iterable);
    let nextIterator: ?AsyncIterator<T>;
    let latestValue: T;
    let firstCompleted = false;
    let nextCompleted = true;

    forAwaitEach(iterator, value => {
      latestValue = value;
    })
    .then(() => {
      firstCompleted = true;
      return concatCallback(latestValue);
    })
    .then((next: AsyncIterable<T> | T) => {
      nextIterator = getAsyncIterator(next);
      if ( nextIterator ) {
        nextCompleted = false;
        return forAwaitEach(nextIterator, value => {
          observer.next(value);
        })
        .then(() => {
          nextCompleted = true;
        });
      }

      observer.next(((next: any): T));
    })
    .then(() => observer.complete(), e => observer.error(e));

    return () => {
      // No way to cancel promises...
      if ( (!firstCompleted) &&
           (iterator) &&
           (typeof iterator.return === 'function') ) {
        iterator.return();
      }

      if ( (!nextCompleted) &&
           (nextIterator) &&
           (typeof nextIterator.return === 'function') ) {
        nextIterator.return();
      }
    };
  });
}

/**
 * Utility function to take only first result of asyncIterator results
 */
export function takeFirstAsyncIterator<T>(
  iterable: AsyncIterable<T>,
): AsyncIterable<?T> {
  return new AsyncGeneratorFromObserver(observer => {
    const iterator = getAsyncIterator(iterable);

    iterator.next().then(({ done, value }) => {
      if ( !done ) {
        let $return = Promise.resolve();
        if ( typeof iterator.return === 'function' ) {
          $return = Promise.resolve(iterator.return());
        }
        observer.next($return.then(() => value));
      }
      observer.complete();
    }, e => observer.error(e));

    return () => {
      // No way to cancel promises...
      if ( iterator && typeof iterator.return === 'function' ) {
        iterator.return();
      }
    };
  });
}

/**
 * Utility function to catch errors of asyncIterator
 */
export function catchErrorsAsyncIterator<T>(
  iterable: AsyncIterable<T>,
  errorHandler: (error: any) => Error | AsyncIterable<T>
): AsyncIterable<T> {
  return AsyncGeneratorFromObserver(observer => {
    let iterator = getAsyncIterator(iterable);
    forAwaitEach(iterator, value => {
      observer.next(value);
    }).then(() => {
      observer.complete();
    }, e => {
      let $return = Promise.resolve();
      if ( iterator && typeof iterator.return === 'function' ) {
        $return = Promise.resolve(iterator.return());
        iterator = undefined;
      }

      return $return.then(() => errorHandler(e))
        .then((err: Error | AsyncIterable<T>) => {
          iterator = ((getAsyncIterator(err): any): ?AsyncIterator<T>);
          if ( !iterator ) {
            throw err;
          }

          return forAwaitEach(iterator, value => {
            observer.next(value);
          });
        })
        .then(() => observer.complete(), e2 => observer.error(e2));
    });

    return () => {
      if ( iterator && typeof iterator.return === 'function' ) {
        iterator.return();
      }
    };
  });
}

/**
 * Utility function to switchMap over asyncIterator
 */
export function switchMapAsyncIterator<T, U>(
  iterable: AsyncIterable<T>,
  switchMapCallback: (value: T) => AsyncIterable<U>
): AsyncIterable<U> {
  return AsyncGeneratorFromObserver(observer => {
    const iterator = getAsyncIterator(iterable);
    let outerValue:IteratorResult<T, void>;

    iterator.next().then(initialValue => {
      outerValue = initialValue;
      const next = () => {
        if ( outerValue.done ) {
          return;
        }

        const switchMapResult = switchMapCallback(outerValue.value);
        const inner = getAsyncIterator(switchMapResult);

        let $return = () => ({ done: true });
        if (typeof inner.return === 'function') {
          $return = inner.return;
        }

        let nextPromise;

        const switchPromise = iterator.next().then((newOuter => {
          outerValue = newOuter;
          if ( newOuter.done ) {
            return nextPromise;
          }

          return $return.call(inner);
        }));

        const nextInner = () => {
          nextPromise = inner.next();

          const resProm = (!outerValue.done ? Promise.race([
            switchPromise, nextPromise
          ]) : nextPromise);

          return resProm.then((result: IteratorResult<U, void>) => {
            if ( result.done ) {
              return switchPromise;
            }

            observer.next(result.value);
            return nextInner();
          });
        };

        // makes sure switch promise executed.
        return nextInner().then(() => next());
      };

      return next();
    })
    .then(() => observer.complete(), e => observer.error(e));

    return () => {
      if ( iterator && typeof iterator.return === 'function' ) {
        iterator.return();
      }
    };
  });
}

/**
 * Utility function to deffer over asyncIterator
 */
export function defferAsyncIterator<T>(
  iterable: AsyncIterable<T>,
): AsyncIterable<?T> {
  return AsyncGeneratorFromObserver(observer => {
    const iterator = getAsyncIterator(iterable);

    // reply with undefine as initial result.
    observer.next(undefined);

    // play the original iterable.
    forAwaitEach(iterator, value => {
      observer.next(value);
    })
    .then(() => observer.complete(), e => observer.error(e));

    return () => {
      if ( iterator && typeof iterator.return === 'function' ) {
        iterator.return();
      }
    };
  });
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
