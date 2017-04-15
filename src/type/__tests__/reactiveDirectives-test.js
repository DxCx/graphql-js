import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
  graphql,
  GraphQLSchema,
  GraphQLString,
  GraphQLObjectType,
} from '../../';
import {
  reactiveDirectives,
  addReactiveDirectivesToSchema
} from '..';
import { introspectionQuery } from '../../utilities/introspectionQuery';

describe('reactiveDirectives', () => {
  it('is able to add reactive directives to schema', () => {
    const EmptySchema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryRoot',
        fields: {
          onlyField: { type: GraphQLString }
        }
      })
    });
    addReactiveDirectivesToSchema(EmptySchema);
  });

  it('return directives in introspection', async () => {
    const EmptySchema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryRoot',
        fields: {
          onlyField: { type: GraphQLString }
        }
      })
    });
    addReactiveDirectivesToSchema(EmptySchema);
    const introspection = await graphql(EmptySchema, introspectionQuery);

    return expect(
      introspection.data.__schema.directives,
    ).to.containSubset(reactiveDirectives);
  });
});
