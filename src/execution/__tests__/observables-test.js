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
import {
  Observable
} from 'rxjs';

describe('Execute: Handles Observables from resolvers', () => {
  it('uses the named operation if operation name is provided', async () => {
    const doc = 'query Example { first: a }';
    const data = { a: Observable.of('b') };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Type',
        fields: {
          a: { type: GraphQLString },
        }
      })
    });

    const result = await executeReactive(schema, parse(doc), data).toPromise();

    expect(result).to.deep.equal({ data: { first: 'b' } });
  });

  it('does not query reactive', () => {
    const doc = 'query Example { first: a }';
    const data = { a: Observable.interval(5) };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Type',
        fields: {
          a: { type: GraphQLString },
        }
      })
    });

    return executeReactive(schema, parse(doc), data).take(2).map(result => {
      expect(result).to.deep.equal({ data: { first: '0' } });
    }).toPromise();
  });

  it('does query reactive for subscriptions', () => {
    const doc = 'subscription Example { first: a }';
    const data = { a: Observable.interval(5) };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          b: { type: GraphQLString },
        }
      }),

      subscription: new GraphQLObjectType({
        name: 'SubscriptionType',
        fields: {
          a: { type: GraphQLString },
        }
      })
    });
    let counter = 0;

    return executeReactive(schema, parse(doc), data).take(5).do(result => {
      expect(result).to.deep.equal({ data: { first: counter.toString() } });
      counter++;
    }).toPromise().then(fresult => {
      // Subscription should return 5 values ( 0...4 ) because of take(5).
      // counter should be equal to 5 since
      // it's being incremeanted after the last expect.
      expect(fresult).to.deep.equal({ data: { first: '4' } });
      expect(counter).to.be.equal(5);
    });
  });

  it('supports Observable fields resolve', () => {
    const doc = 'query Example { a { firstName counter } }';
    const data = { a: { firstName: 'test', counter: Observable.interval(5) } };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Type',
        fields: {
          a: { type: new GraphQLObjectType({
            name: 'User',
            fields: {
              firstName: { type: GraphQLString },
              counter: { type: GraphQLString },
            }
          })},
        }
      })
    });

    return executeReactive(schema, parse(doc), data).take(2).map(result => {
      expect(result).to.deep.equal({
        data: { a: { firstName: 'test', counter: '0' } },
      });
    }).toPromise();
  });

  it('supports Observable fields resolve for subscriptions as well', () => {
    const doc = 'subscription Example { a { firstName counter } }';
    const data = { a: { firstName: 'test', counter: Observable.interval(5) } };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          b: { type: GraphQLString },
        }
      }),

      subscription: new GraphQLObjectType({
        name: 'SubscriptionType',
        fields: {
          a: { type: new GraphQLObjectType({
            name: 'User',
            fields: {
              firstName: { type: GraphQLString },
              counter: { type: GraphQLString },
            }
          })},
        }
      })
    });
    let counter = 0;

    return executeReactive(schema, parse(doc), data).take(5).do(result => {
      expect(result).to.deep.equal({
        data: { a: { firstName: 'test', counter: counter.toString() } },
      });
      counter++;
    }).toPromise().then(fresult => {
      // Subscription should return 5 values ( 0...4 ) because of take(5).
      // counter should be equal to 5 since
      // it's being incremeanted after the last expect.
      expect(fresult).to.deep.equal({
        data: { a: { firstName: 'test', counter: '4' } },
      });
      expect(counter).to.be.equal(5);
    });
  });
});

describe('Execute: Supports reactive directives', () => {
  it('@defer works', () => {
    const doc = `query Example {
      counter @defer
    }`;
    const data = { counter: Observable.of(1).delay(100) };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          counter: { type: GraphQLInt }
        },
      }),
    });

    return executeReactive(schema, parse(doc), data)
    .bufferCount(10)
    .toPromise().then(fresult => {
      // makes sure final is correct.
      expect(fresult).to.deep.equal([
        { data: { counter: undefined } },
        { data: { counter: 1 }, }
      ]);
    });
  });

  it('@defer doesn\'t work on immediate value', () => {
    const doc = `query Example {
      counter @defer
    }`;
    const data = { counter: 1 };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          counter: { type: GraphQLInt }
        },
      }),
    });

    return executeReactive(schema, parse(doc), data)
    .toPromise().then(fresult => {
      // makes sure final is correct.
      expect(fresult).to.deep.equal({
        data: { counter: 1 },
      });
    });
  });

  it('@defer doesn\'t apply twice', () => {
    const doc = `query Example {
      counter @defer @defer
    }`;
    const data = { counter: Observable.of(1).delay(100) };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          counter: { type: GraphQLInt }
        },
      }),
    });

    return executeReactive(schema, parse(doc), data)
      .bufferCount(10)
      .toPromise().then(fresult => {
        // makes sure final is correct.
        expect(fresult).to.deep.equal([
          { data: { counter: undefined } },
          { data: { counter: 1 } },
        ]);
      });
  });

  it('@defer work on nested value query', () => {
    const doc = `query Example {
      test @defer {
        immediate
        counter @defer
      }
    }`;
    const data = {
      test: Observable.of({
        immediate: 'Works!',
        counter: Observable.of(1),
      }),
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

    return executeReactive(schema, parse(doc), data)
    .bufferCount(expected.length)
    .toPromise().then(fresult => {
      // makes sure final is correct.
      expect(fresult).to.deep.equal(expected);
    });
  });

  it('@defer should work with Non-Null field', () => {
    const doc = `query Example {
      counter @defer
    }`;
    const data = { counter: Observable.of(1).delay(50).toPromise() };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          counter: { type: new GraphQLNonNull(GraphQLInt) }
        },
      }),
    });

    return executeReactive(schema, parse(doc), data)
    .bufferCount(10)
    .toPromise().then(fresult => {
      // makes sure final is correct.
      expect(fresult).to.deep.equal([
        { data: { counter: undefined } },
        { data: { counter: 1 }, }
      ]);
    });
  });

  it('@defer error if realve value is null on Non-Null field', () => {
    const doc = `query Example {
      counter @defer
    }`;
    const data = { counter: Observable.of(null).delay(50).toPromise() };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          counter: { type: new GraphQLNonNull(GraphQLInt) }
        },
      }),
    });
    let firstResult = true;

    return executeReactive(schema, parse(doc), data).do(result => {
      if ( firstResult ) {
        expect(result).to.deep.equal({
          data: { counter: undefined },
        });
      }

      firstResult = false;
    }).toPromise().then(fresult => {
      expect(fresult.data).to.equal(null);
      expect(fresult.errors && fresult.errors.length).to.equal(1);
      expect(fresult.errors[0].message).to.match(
        /Cannot return null for non-nullable field/
      );
    });
  });

  it('does not terminate @live query', () => {
    const doc = `query Example {
      a {
        firstName
        counter @live
      }
    }`;
    const data = { a: { firstName: 'test', counter: Observable.interval(5) } };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          a: { type: new GraphQLObjectType({
            name: 'User',
            fields: {
              firstName: { type: GraphQLString },
              counter: { type: GraphQLString },
            }
          })},
        }
      }),
    });
    let counter = 0;

    return executeReactive(schema, parse(doc), data).take(5).do(result => {
      expect(result).to.deep.equal({
        data: { a: { firstName: 'test', counter: counter.toString() } },
      });
      counter++;
    }).toPromise().then(fresult => {
      // Subscription should return 5 values ( 0...4 ) because of take(5).
      // counter should be equal to 5 since
      // it's being incremeanted after the last expect.
      expect(fresult).to.deep.equal({
        data: { a: { firstName: 'test', counter: '4' } },
      });
      expect(counter).to.be.equal(5);
    });
  });

  it('@live works on sub-observable', () => {
    const doc = `query Example {
      a {
        firstName
        counter @live
      }
    }`;
    const data = {
      a: Observable.interval(5).map(
        c => ({ firstName: 'test', counter: c })
      )
    };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          a: { type: new GraphQLObjectType({
            name: 'User',
            fields: {
              firstName: { type: GraphQLString },
              counter: { type: GraphQLString },
            }
          })},
        }
      }),
    });
    let counter = 0;

    return executeReactive(schema, parse(doc), data).take(5).do(result => {
      expect(result).to.deep.equal({
        data: { a: { firstName: 'test', counter: counter.toString() } },
      });
      counter++;
    }).toPromise().then(fresult => {
      // Subscription should return 5 values ( 0...4 ) because of take(5).
      // counter should be equal to 5 since
      // it's being incremeanted after the last expect.
      expect(fresult).to.deep.equal({
        data: { a: { firstName: 'test', counter: '4' } },
      });
      expect(counter).to.be.equal(5);
    });
  });

  it('@live works on sub-observable only if used', () => {
    const doc = `query Example {
      a {
        counter2 @live
        counter
      }
    }`;
    const data = {
      a: Observable.interval(5).map(
        c => ({ counter2: c, counter: c })
      )
    };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          a: { type: new GraphQLObjectType({
            name: 'User',
            fields: {
              counter2: { type: GraphQLString },
              counter: { type: GraphQLString },
            }
          })},
        }
      }),
    });
    let counter = 0;

    return executeReactive(schema, parse(doc), data).take(5).do(result => {
      expect(result).to.deep.equal({
        data: { a: { counter2: counter.toString(), counter: '0' } },
      });
      counter++;
    }).toPromise().then(fresult => {
      // Subscription should return 5 values ( 0...4 ) because of take(5).
      // counter should be equal to 5 since
      // it's being incremeanted after the last expect.
      expect(fresult).to.deep.equal({
        data: { a: { counter2: '4', counter: '0' } },
      });
      expect(counter).to.be.equal(5);
    });
  });

  it('@live works on inline fragmant', () => {
    const doc = `query Example {
      a {
        ... on User @live {
          counter2
          counter
        }
      }
    }`;
    const data = {
      a: Observable.interval(5).map(
        c => ({ counter2: c, counter: c })
      )
    };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          a: { type: new GraphQLObjectType({
            name: 'User',
            fields: {
              counter2: { type: GraphQLString },
              counter: { type: GraphQLString },
            }
          })},
        }
      }),
    });
    let counter = 0;

    return executeReactive(schema, parse(doc), data).take(5).do(result => {
      expect(result).to.deep.equal({
        data: {
          a: {
            counter2: counter.toString(),
            counter: counter.toString(),
          },
        },
      });
      counter++;
    }).toPromise().then(fresult => {
      // Subscription should return 5 values ( 0...4 ) because of take(5).
      // counter should be equal to 5 since
      // it's being incremeanted after the last expect.
      expect(fresult).to.deep.equal({
        data: { a: { counter2: '4', counter: '4' } },
      });
      expect(counter).to.be.equal(5);
    });
  });

  it('@live works on fragment', () => {
    const doc = `query Example {
      a {
        ... liveFragmant @live
      }
    }

    fragment liveFragmant on User {
      counter2
      counter
    }`;
    const data = {
      a: Observable.interval(10).map(
        c => ({ counter2: c, counter: c })
      )
    };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          a: { type: new GraphQLObjectType({
            name: 'User',
            fields: {
              counter2: { type: GraphQLString },
              counter: { type: GraphQLString },
            }
          })},
        }
      }),
    });
    let counter = 0;

    return executeReactive(schema, parse(doc), data).take(5).do(result => {
      expect(result).to.deep.equal({
        data: {
          a: {
            counter2: counter.toString(),
            counter: counter.toString(),
          },
        },
      });
      counter++;
    }).toPromise().then(fresult => {
      // Subscription should return 5 values ( 0...4 ) because of take(5).
      // counter should be equal to 5 since
      // it's being incremeanted after the last expect.
      expect(fresult).to.deep.equal({
        data: { a: { counter2: '4', counter: '4' } },
      });
      expect(counter).to.be.equal(5);
    });
  });

  it('@live works as live fragment', () => {
    const doc = `query Example {
      a {
        ... liveFragmant
      }
    }

    fragment liveFragmant on User @live {
      counter2
      counter
    }`;
    const data = {
      a: Observable.interval(10).map(
        c => ({ counter2: c, counter: c })
      )
    };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          a: { type: new GraphQLObjectType({
            name: 'User',
            fields: {
              counter2: { type: GraphQLString },
              counter: { type: GraphQLString },
            }
          })},
        }
      }),
    });
    let counter = 0;

    return executeReactive(schema, parse(doc), data).take(5).do(result => {
      expect(result).to.deep.equal({
        data: {
          a: {
            counter2: counter.toString(),
            counter: counter.toString(),
          },
        },
      });
      counter++;
    }).toPromise().then(fresult => {
      // Subscription should return 5 values ( 0...4 ) because of take(5).
      // counter should be equal to 5 since
      // it's being incremeanted after the last expect.
      expect(fresult).to.deep.equal({
        data: { a: { counter2: '4', counter: '4' } },
      });
      expect(counter).to.be.equal(5);
    });
  });

  it('@live works on fragment selection', () => {
    const doc = `query Example {
      a {
        ... on User {
          firstName
          counter @live
        }
      }
    }`;
    const data = {
      a: Observable.interval(5).map(
        c => ({ firstName: 'test', counter: c })
      )
    };
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryType',
        fields: {
          a: { type: new GraphQLObjectType({
            name: 'User',
            fields: {
              firstName: { type: GraphQLString },
              counter: { type: GraphQLString },
            }
          })},
        }
      }),
    });
    let counter = 0;

    return executeReactive(schema, parse(doc), data).take(5).do(result => {
      expect(result).to.deep.equal({
        data: { a: { firstName: 'test', counter: counter.toString() } },
      });
      counter++;
    }).toPromise().then(fresult => {
      // Subscription should return 5 values ( 0...4 ) because of take(5).
      // counter should be equal to 5 since
      // it's being incremeanted after the last expect.
      expect(fresult).to.deep.equal({
        data: { a: { firstName: 'test', counter: '4' } },
      });
      expect(counter).to.be.equal(5);
    });
  });
});
