/* @flow */

import type { ValidationContext } from '../index';
import { GraphQLError } from '../../error';
import type { OperationDefinitionNode } from '../../language/ast';
import find from '../../jsutils/find';
import * as Kind from '../../language/kinds';
import { reactiveDirectives } from '../../type/reactiveDirectives';

export function noReactiveDirectivesMessage(name: ?string): string {
  return (name ? `Mutation "${name}" ` : 'Anonymous Mutation ') +
    'is executed serially and cannot use @defer/@live';
}

/**
 * Mutations cannot use reactive directives as they are executed serially
 * so one field has to "Complete" before the other is executed.
 *
 * A GraphQL mutation is valid only if it does not use reactive directives.
 */
export function NoReactiveMutations(context: ValidationContext): any {
  return {
    Directive(node, key, parent, path, ancestors) {
      // Verify the directive is a reactive directive.
      const directiveDef = find(
        reactiveDirectives,
        def => def.name === node.name.value
      );
      if (!directiveDef) {
        return;
      }

      // Get the operation of current directive.
      let i = 1;
      let operation: ?OperationDefinitionNode;
      while ( i <= ancestors.length ) {
        operation = ancestors[ancestors.length - i];
        if ( operation.kind === Kind.OPERATION_DEFINITION ) {
          break;
        }

        i += 1;
      }

      // If no operation found, or operation is not mutation,
      // the rule passes.
      if (!operation || operation.operation !== 'mutation') {
        return;
      }

      // Report the error
      context.reportError(new GraphQLError(
        noReactiveDirectivesMessage(operation.name && operation.name.value),
        [ node ]
      ));
    },
  };
}
