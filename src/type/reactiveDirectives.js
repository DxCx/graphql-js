/* @flow */
import { DirectiveLocation, GraphQLDirective } from './directives';
import invariant from '../jsutils/invariant';
import { GraphQLSchema } from './schema';

/**
 * Used to defer field or fragment resolve value.
 */
export const GraphQLDeferDirective = new GraphQLDirective({
  name: 'defer',
  description: 'Returns initial value as null and update value when available',
  locations: [
    DirectiveLocation.FIELD,
    DirectiveLocation.FRAGMENT_SPREAD,
    DirectiveLocation.INLINE_FRAGMENT,
  ],
});

/**
 * Used to request selected field or fragment as with live updates.
 */
export const GraphQLLiveDirective = new GraphQLDirective({
  name: 'live',
  description: 'Directs the executor to keep field or fragment ' +
               'as live observable',
  locations: [
    DirectiveLocation.FIELD,
    DirectiveLocation.FRAGMENT_SPREAD,
    DirectiveLocation.INLINE_FRAGMENT,
    DirectiveLocation.FRAGMENT_DEFINITION,
  ],
});

export const reactiveDirectives: Array<GraphQLDirective> = [
  GraphQLDeferDirective,
  GraphQLLiveDirective
];

export function addReactiveDirectivesToSchema(schema: GraphQLSchema) {
  invariant(schema, 'Must provide schema');
  invariant(
    schema instanceof GraphQLSchema,
    'Schema must be an instance of GraphQLSchema. Also ensure that there are ' +
    'not multiple versions of GraphQL installed in your node_modules directory.'
  );

  Object.assign(schema, {
    _directives: schema._directives.concat(reactiveDirectives),
  });
}
