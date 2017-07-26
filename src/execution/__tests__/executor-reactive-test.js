import { expect } from 'chai';
import { describe, it } from 'mocha';
import { executeReactive } from '../execute';
import { parse } from '../../language';
import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLString,
  GraphQLInt,
  GraphQLNonNull,
} from '../../type';
import { createAsyncIterator } from 'iterall';

async function executeReactiveAsArray(params) {
  const iter = executeReactive(params);
  const responses = [];
  const infiateLoop = true;

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

describe('ExecuteReactive: Handles basic execution tasks', () => {
  it('promises working as usual', async () => {
    const doc = 'query Example { a b }';
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Type',
        fields: {
          b: {
            type: GraphQLString,
            resolve() {
              return 'works';
            }
          },
          a: {
            type: GraphQLString,
            resolve() {
              return new Promise(resolve => {
                setTimeout(() => resolve('works'), 50);
              });
            }
          }
        }
      })
    });

    const results = await executeReactiveAsArray({
      schema,
      document: parse(doc)
    });

    expect(results).to.deep.equal([
      { data: { a: 'works', b: 'works' } },
    ]);
  });

  it('mutation working as usual', async () => {
    const doc = 'mutation Example { a b }';
    const schema = new GraphQLSchema({
      mutation: new GraphQLObjectType({
        name: 'MType',
        fields: {
          b: {
            type: GraphQLString,
            resolve() {
              return 'works';
            }
          },
          a: {
            type: GraphQLString,
            resolve() {
              return new Promise(resolve => {
                setTimeout(() => resolve('works'), 50);
              });
            }
          }
        }
      }),
      query: new GraphQLObjectType({
        name: 'QType',
        fields: {
          a: {
            type: GraphQLString,
            resolve() {
              return new Promise(resolve => {
                setTimeout(() => resolve('works'), 50);
              });
            }
          }
        }
      })
    });

    const results = await executeReactiveAsArray({
      schema,
      document: parse(doc)
    });

    expect(results).to.deep.equal([
      { data: { a: 'works', b: 'works' } },
    ]);
  });

  it('resolver can digest async iterator', async () => {
    const doc = 'query Example { a }';
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Type',
        fields: {
          a: {
            type: GraphQLString,
            resolve() {
              return createAsyncIterator([ 'works' ]);
            }
          }
        }
      })
    });

    const results = await executeReactiveAsArray({
      schema,
      document: parse(doc)
    });

    expect(results).to.deep.equal([
      { data: { a: 'works' } },
    ]);
  });

  it('able to @defer simple value', async () => {
    const doc = 'query Example { b a @defer }';
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Type',
        fields: {
          b: {
            type: GraphQLString,
            resolve() {
              return new Promise(resolve => {
                setTimeout(() => resolve('works'), 10);
              });
            }
          },
          a: {
            type: GraphQLString,
            resolve() {
              return new Promise(resolve => {
                setTimeout(() => resolve('works'), 50);
              });
            }
          }
        }
      })
    });

    const results = await executeReactiveAsArray({
      schema,
      document: parse(doc)
    });

    expect(results).to.deep.equal([
      { data: { b: 'works', a: undefined } },
      { data: { b: 'works', a: 'works' } },
    ]);
  });


  it('won\'t @defer resolved value', async () => {
    const doc = 'query Example { a @defer }';
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Type',
        fields: {
          a: {
            type: GraphQLString,
            resolve() {
              return 'works';
            }
          }
        }
      })
    });

    const results = await executeReactiveAsArray({
      schema,
      document: parse(doc)
    });

    expect(results).to.deep.equal([
      { data: { a: 'works' } },
    ]);
  });

  it('basic @live works', async () => {
    const doc = 'query Example { a @live }';
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Type',
        fields: {
          a: {
            type: GraphQLString,
            resolve() {
              return createAsyncIterator([ 'works', 'works again' ]);
            }
          }
        }
      })
    });

    const results = await executeReactiveAsArray({
      schema,
      document: parse(doc)
    });

    expect(results).to.deep.equal([
      { data: { a: 'works' } },
      { data: { a: 'works again' } },
    ]);
  });

  it('resolver takes first value if not using @live', async () => {
    const doc = 'query Example { a }';
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Type',
        fields: {
          a: {
            type: GraphQLString,
            resolve() {
              return createAsyncIterator([ 'works', 'works again' ]);
            }
          }
        }
      })
    });

    const results = await executeReactiveAsArray({
      schema,
      document: parse(doc)
    });

    expect(results).to.deep.equal([
      { data: { a: 'works' } },
    ]);
  });
});

describe('ExecuteReactive: Reactive Directives', () => {
  it('@defer doesn\'t apply twice', async () => {
    const doc = 'query Example { b a @defer @defer }';
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Type',
        fields: {
          b: {
            type: GraphQLString,
            resolve() {
              return new Promise(resolve => {
                setTimeout(() => resolve('works'), 10);
              });
            }
          },
          a: {
            type: GraphQLString,
            resolve() {
              return new Promise(resolve => {
                setTimeout(() => resolve('works'), 50);
              });
            }
          }
        }
      })
    });

    const results = await executeReactiveAsArray({
      schema,
      document: parse(doc)
    });

    expect(results).to.deep.equal([
      { data: { b: 'works', a: undefined } },
      { data: { b: 'works', a: 'works' } },
    ]);
  });

  it('@defer work on nested value query', async () => {
    const doc = `query Example {
      test @defer {
        immediate
        counter @defer
      }
    }`;
    const rootValue = {
      test: createAsyncIterator([ {
        immediate: 'Works!',
        counter: createAsyncIterator([ 1 ]),
      } ]),
    };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          test: {
            type: new GraphQLObjectType({
              name: 'TestType',
              fields: {
                immediate: { type: GraphQLString },
                counter: { type: GraphQLInt },
              }
            }),
          },
        },
      }),
    });
    const expected = [
      { data: { test: undefined } },
      { data: { test: { immediate: 'Works!', counter: undefined } } },
      { data: { test: { immediate: 'Works!', counter: 1 } } },
    ];

    const results = await executeReactiveAsArray({
      schema,
      document: parse(doc),
      rootValue,
    });

    expect(results).to.deep.equal(expected);
  });

  it('@defer should work with Non-Null field', async () => {
    const doc = `query Example {
      counter @defer
    }`;
    const rootValue = { counter: promiseGen(1, 50) };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          counter: { type: new GraphQLNonNull(GraphQLInt) }
        },
      }),
    });

    const expected = [
        { data: { counter: undefined } },
        { data: { counter: 1 }, }
    ];

    const results = await executeReactiveAsArray({
      schema,
      document: parse(doc),
      rootValue,
    });

    expect(results).to.deep.equal(expected);
  });

  it('@defer error if real value is null on Non-Null field', async () => {
    const doc = `query Example {
      counter @defer
    }`;
    const rootValue = { counter: promiseGen(null, 50) };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          counter: { type: new GraphQLNonNull(GraphQLInt) }
        },
      }),
    });
    const expected = [
      { data: { counter: undefined } },
      { data: null, errors: [ {
        message: 'Cannot return null for non-nullable field QueryType.counter.',
        path: [ 'counter' ],
        locations: [ { column: 7, line: 2 } ],
      } ] },
    ];

    const results = await executeReactiveAsArray({
      schema,
      document: parse(doc),
      rootValue,
    });

    expect(results).to.deep.equal(expected);
  });

  it('@live works on sub-asyncIterator', async () => {
    const doc = `query Example {
      a {
        firstName
        counter @live
      }
    }`;
    const rootValue = {
      a: createAsyncIterator([
        ({ firstName: 'test', counter: 1 }),
        ({ firstName: 'test', counter: 2 }),
        ({ firstName: 'test', counter: 3 }),
      ]),
    };

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          a: { type: new GraphQLObjectType({
            name: 'User',
            fields: {
              firstName: { type: GraphQLString },
              counter: { type: GraphQLInt },
            }
          })},
        }
      }),
    });

    const expected = [
        { data: { a: { firstName: 'test', counter: 1 } } },
        { data: { a: { firstName: 'test', counter: 2 } } },
        { data: { a: { firstName: 'test', counter: 3 } } },
    ];

    const results = await executeReactiveAsArray({
      schema,
      document: parse(doc),
      rootValue,
    });

    expect(results).to.deep.equal(expected);
  });

  it('@live works on sub-observable only if used', async () => {
    const doc = `query Example {
      a {
        counter2
        counter @live
      }
    }`;
    const rootValue = {
      a: createAsyncIterator([
        ({ counter2: 1, counter: 1 }),
        ({ counter2: 2, counter: 2 }),
        ({ counter2: 3, counter: 3 }),
      ]),
    };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          a: { type: new GraphQLObjectType({
            name: 'User',
            fields: {
              counter2: { type: GraphQLInt },
              counter: { type: GraphQLInt },
            }
          })},
        }
      }),
    });

    const expected = [
        { data: { a: { counter2: 1, counter: 1 } } },
        { data: { a: { counter2: 1, counter: 2 } } },
        { data: { a: { counter2: 1, counter: 3 } } },
    ];

    const results = await executeReactiveAsArray({
      schema,
      document: parse(doc),
      rootValue,
    });

    expect(results).to.deep.equal(expected);
  });

  it('@live works on inline fragmant', async () => {
    const doc = `query Example {
      a {
        ... on User @live {
          counter2
          counter
        }
      }
    }`;
    const rootValue = {
      a: createAsyncIterator([
        ({ counter2: 1, counter: 1 }),
        ({ counter2: 2, counter: 2 }),
        ({ counter2: 3, counter: 3 }),
      ]),
    };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          a: { type: new GraphQLObjectType({
            name: 'User',
            fields: {
              counter2: { type: GraphQLInt },
              counter: { type: GraphQLInt },
            }
          })},
        }
      }),
    });
    const expected = [
        { data: { a: { counter2: 1, counter: 1 } } },
        { data: { a: { counter2: 2, counter: 2 } } },
        { data: { a: { counter2: 3, counter: 3 } } },
    ];

    const results = await executeReactiveAsArray({
      schema,
      document: parse(doc),
      rootValue,
    });

    expect(results).to.deep.equal(expected);
  });

  it('@live works on fragment', async () => {
    const doc = `query Example {
      a {
        ... liveFragmant @live
      }
    }
    fragment liveFragmant on User {
      counter2
      counter
    }`;
    const rootValue = {
      a: createAsyncIterator([
        ({ counter2: 1, counter: 1 }),
        ({ counter2: 2, counter: 2 }),
        ({ counter2: 3, counter: 3 }),
      ]),
    };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          a: { type: new GraphQLObjectType({
            name: 'User',
            fields: {
              counter2: { type: GraphQLInt },
              counter: { type: GraphQLInt },
            }
          })},
        }
      }),
    });
    const expected = [
        { data: { a: { counter2: 1, counter: 1 } } },
        { data: { a: { counter2: 2, counter: 2 } } },
        { data: { a: { counter2: 3, counter: 3 } } },
    ];

    const results = await executeReactiveAsArray({
      schema,
      document: parse(doc),
      rootValue,
    });

    expect(results).to.deep.equal(expected);
  });

  it('@live works as live fragment', async () => {
    const doc = `query Example {
      a {
        ... liveFragmant
      }
    }
    fragment liveFragmant on User @live {
      counter2
      counter
    }`;
    const rootValue = {
      a: createAsyncIterator([
        ({ counter2: 1, counter: 1 }),
        ({ counter2: 2, counter: 2 }),
        ({ counter2: 3, counter: 3 }),
      ]),
    };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          a: { type: new GraphQLObjectType({
            name: 'User',
            fields: {
              counter2: { type: GraphQLInt },
              counter: { type: GraphQLInt },
            }
          })},
        }
      }),
    });
    const expected = [
        { data: { a: { counter2: 1, counter: 1 } } },
        { data: { a: { counter2: 2, counter: 2 } } },
        { data: { a: { counter2: 3, counter: 3 } } },
    ];

    const results = await executeReactiveAsArray({
      schema,
      document: parse(doc),
      rootValue,
    });

    expect(results).to.deep.equal(expected);
  });

  it('@live works on fragment selection', async () => {
    const doc = `query Example {
      a {
        ... on User {
          firstName
          counter @live
        }
      }
    }`;
    const rootValue = {
      a: createAsyncIterator([
        ({ firstName: 'test', counter: 1 }),
        ({ firstName: 'test', counter: 2 }),
        ({ firstName: 'test', counter: 3 }),
      ]),
    };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          a: { type: new GraphQLObjectType({
            name: 'User',
            fields: {
              firstName: { type: GraphQLString },
              counter: { type: GraphQLInt },
            }
          })},
        }
      }),
    });
    const expected = [
        { data: { a: { firstName: 'test', counter: 1 } } },
        { data: { a: { firstName: 'test', counter: 2 } } },
        { data: { a: { firstName: 'test', counter: 3 } } },
    ];

    const results = await executeReactiveAsArray({
      schema,
      document: parse(doc),
      rootValue,
    });

    expect(results).to.deep.equal(expected);
  });
});
