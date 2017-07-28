import { expect } from 'chai';
import { describe, it } from 'mocha';
import EventEmitter from 'events';
import { createAsyncIterator } from 'iterall';
import eventEmitterAsyncIterator from './eventEmitterAsyncIterator';
import { subscribe } from '../subscribe';
import { parse } from '../../language';
import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLList,
  GraphQLBoolean,
  GraphQLInt,
  GraphQLString,
} from '../../type';

async function subscribeAsArray(params, limit, timeout) {
  const iter = subscribe(params);
  const responses = [];
  const infiateLoop = true;

  if ( timeout ) {
    setTimeout(() => {
      if ( typeof iter.return === 'function' ) {
        iter.return(); // eslint-disable-line no-await-in-loop
      }
    }, timeout);
  }

  while (infiateLoop) {
    const result = await iter.next(); // eslint-disable-line no-await-in-loop

    if ( result.done ) {
      break;
    }

    responses.push(result.value);
    if ( limit && responses.length === limit ) {
      if ( typeof iter.return === 'function' ) {
        await iter.return(); // eslint-disable-line no-await-in-loop
      }
      break;
    }
  }

  return responses;
}

describe('Subscribe with reactive directives', () => {
  // Taken from standard subscription testing
  const EmailType = new GraphQLObjectType({
    name: 'Email',
    fields: {
      from: { type: GraphQLString },
      subject: { type: GraphQLString },
      message: { type: GraphQLString },
      unread: { type: GraphQLBoolean },
    }
  });

  const InboxType = new GraphQLObjectType({
    name: 'Inbox',
    fields: {
      total: {
        type: GraphQLInt,
        resolve: inbox => inbox.emails.length,
      },
      unread: {
        type: GraphQLInt,
        resolve: inbox => inbox.emails.filter(email => email.unread).length,
      },
      emails: { type: new GraphQLList(EmailType) },
    }
  });

  const QueryType = new GraphQLObjectType({
    name: 'Query',
    fields: {
      inbox: { type: InboxType },
    }
  });

  const EmailEventType = new GraphQLObjectType({
    name: 'EmailEvent',
    fields: {
      email: { type: EmailType },
      inbox: { type: InboxType },
      liveValue: { type: GraphQLInt },
    }
  });

  const SubscriptionType = new GraphQLObjectType({
    name: 'Subscription',
    fields: {
      importantEmail: { type: EmailEventType },
    }
  });

  const emailSchema = new GraphQLSchema({
    query: QueryType,
    subscription: SubscriptionType
  });

  function createSubscription(pubsub, query, schema = emailSchema) {
    const data = {
      inbox: {
        emails: [
          {
            from: 'joe@graphql.org',
            subject: 'Hello',
            message: 'Hello World',
            unread: false,
          },
        ],
      },
      importantEmail() {
        return eventEmitterAsyncIterator(pubsub, 'importantEmail');
      }
    };

    function sendImportantEmail(newEmail) {
      data.inbox.emails.push(newEmail);
      // Returns true if the event was consumed by a subscriber.
      return pubsub.emit('importantEmail', {
        importantEmail: {
          email: newEmail,
          inbox: data.inbox,
          liveValue: createAsyncIterator([ 1, 2, 3, 4 ]),
        }
      });
    }

    const ast = parse(query);

    // GraphQL `subscribe` has the same call signature as `execute`, but returns
    // AsyncIterator instead of Promise.
    return {
      sendImportantEmail,
      subscription: (limit, timeout) => subscribeAsArray({
        schema,
        document: ast,
        rootValue: data
      }, limit, timeout),
    };
  }

  it('subscriptions is not @live out of the box.',
    async () => {
      const pubsub = new EventEmitter();
      const query = `
      subscription ($priority: Int = 0) {
        importantEmail(priority: $priority) {
          email {
            from
            subject
          }
          inbox {
            unread
            total
          }
          liveValue
        }
      }
      `;
      const { sendImportantEmail, subscription } = createSubscription(
        pubsub,
        query
      );
      const payload = subscription(2, 200);

      expect(sendImportantEmail({
        from: 'yuzhi@graphql.org',
        subject: 'Alright',
        message: 'Tests are good',
        unread: true,
      })).to.equal(true);

      const expectedPayload = {
        data: {
          importantEmail: {
            email: {
              from: 'yuzhi@graphql.org',
              subject: 'Alright',
            },
            inbox: {
              unread: 1,
              total: 2,
            },
            liveValue: 1,
          },
        },
      };

      expect(await payload).to.deep.equal([
        expectedPayload
      ]);
    });

  it('subscriptions @defer works',
    async () => {
      const pubsub = new EventEmitter();
      const query = `
      subscription ($priority: Int = 0) {
        importantEmail(priority: $priority) {
          email {
            from
            subject
          }
          inbox {
            unread
            total
          }
          liveValue @defer
        }
      }
      `;
      const { sendImportantEmail, subscription } = createSubscription(
        pubsub,
        query
      );
      const payload = subscription(3, 200);

      expect(sendImportantEmail({
        from: 'yuzhi@graphql.org',
        subject: 'Alright',
        message: 'Tests are good',
        unread: true,
      })).to.equal(true);

      const expectedPayload = live => ({
        data: {
          importantEmail: {
            email: {
              from: 'yuzhi@graphql.org',
              subject: 'Alright',
            },
            inbox: {
              unread: 1,
              total: 2,
            },
            liveValue: live,
          },
        },
      });

      expect(await payload).to.deep.equal([
        expectedPayload(undefined),
        expectedPayload(1),
      ]);
    });

  it('subscriptions @live works',
    async () => {
      const pubsub = new EventEmitter();
      const query = `
      subscription ($priority: Int = 0) {
        importantEmail(priority: $priority) {
          email {
            from
            subject
          }
          inbox {
            unread
            total
          }
          liveValue @live
        }
      }
      `;
      const { sendImportantEmail, subscription } = createSubscription(
        pubsub,
        query
      );
      const payload = subscription(5, 200);

      expect(sendImportantEmail({
        from: 'yuzhi@graphql.org',
        subject: 'Alright',
        message: 'Tests are good',
        unread: true,
      })).to.equal(true);

      const expectedPayload = live => ({
        data: {
          importantEmail: {
            email: {
              from: 'yuzhi@graphql.org',
              subject: 'Alright',
            },
            inbox: {
              unread: 1,
              total: 2,
            },
            liveValue: live,
          },
        },
      });

      expect(await payload).to.deep.equal([
        expectedPayload(1),
        expectedPayload(2),
        expectedPayload(3),
        expectedPayload(4),
      ]);
    });
});
