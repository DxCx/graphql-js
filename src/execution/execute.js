/* @flow */
/**
 *  Copyright (c) 2015, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */

import { forEach, isCollection } from 'iterall';

import { GraphQLError, locatedError } from '../error';
import invariant from '../jsutils/invariant';
import isNullish from '../jsutils/isNullish';
import { typeFromAST } from '../utilities/typeFromAST';
import * as Kind from '../language/kinds';
import {
  getVariableValues,
  getArgumentValues,
  getDirectiveValues,
} from './values';
import {
  GraphQLObjectType,
  GraphQLList,
  GraphQLNonNull,
  isAbstractType,
  isLeafType,
} from '../type/definition';
import type {
  GraphQLType,
  GraphQLLeafType,
  GraphQLAbstractType,
  GraphQLField,
  GraphQLFieldResolver,
  GraphQLResolveInfo,
  ResponsePath,
} from '../type/definition';
import { GraphQLSchema } from '../type/schema';
import {
  SchemaMetaFieldDef,
  TypeMetaFieldDef,
  TypeNameMetaFieldDef,
} from '../type/introspection';
import {
  GraphQLIncludeDirective,
  GraphQLSkipDirective,
} from '../type/directives';
import type {
  DocumentNode,
  OperationDefinitionNode,
  SelectionSetNode,
  FieldNode,
  FragmentSpreadNode,
  InlineFragmentNode,
  FragmentDefinitionNode,
} from '../language/ast';

import type {
  SelectionNode,
  DirectiveNode
} from '../language/ast';

import {
  GraphQLDeferDirective,
  GraphQLLiveDirective,
} from '../type/reactiveDirectives';

import {
  createAsyncIterator,
  getAsyncIterator,
  isAsyncIterable,
} from 'iterall';

import mapAsyncIterator from '../subscription/mapAsyncIterator';

/**
 * Terminology
 *
 * "Definitions" are the generic name for top-level statements in the document.
 * Examples of this include:
 * 1) Operations (such as a query)
 * 2) Fragments
 *
 * "Operations" are a generic name for requests in the document.
 * Examples of this include:
 * 1) query,
 * 2) mutation
 *
 * "Selections" are the definitions that can appear legally and at
 * single level of the query. These include:
 * 1) field references e.g "a"
 * 2) fragment "spreads" e.g. "...c"
 * 3) inline fragment "spreads" e.g. "...on Type { a }"
 */

/**
 * Data that must be available at all points during query execution.
 *
 * Namely, schema of the type system that is currently executing,
 * and the fragments defined in the query document
 */
export type ExecutionContext = {
  schema: GraphQLSchema;
  fragments: {[key: string]: FragmentDefinitionNode};
  rootValue: mixed;
  contextValue: mixed;
  operation: OperationDefinitionNode;
  variableValues: {[key: string]: mixed};
  fieldResolver: GraphQLFieldResolver<any, any>;
  errors: Array<GraphQLError>;

  // GQL-RxJs: used to store static results on @live request
  liveCache: {[key: string]: mixed};
  liveMap: {[key: string]: boolean};
};

/**
 * The result of GraphQL execution.
 *
 *   - `errors` is included when any errors occurred as a non-empty array.
 *   - `data` is the result of a successful execution of the query.
 */
export type ExecutionResult = {
  errors?: Array<GraphQLError>;
  data?: ?{[key: string]: mixed};
};

/**
 * Implements the "Evaluating requests" section of the GraphQL specification.
 *
 * Returns a Promise that will eventually be resolved and never rejected.
 *
 * If the arguments to this function do not result in a legal execution context,
 * a GraphQLError will be thrown immediately explaining the invalid input.
 *
 * Accepts either an object with named arguments, or individual arguments.
 */
declare function execute({|
  schema: GraphQLSchema,
  document: DocumentNode,
  rootValue?: mixed,
  contextValue?: mixed,
  variableValues?: ?{[key: string]: mixed},
  operationName?: ?string,
  fieldResolver?: ?GraphQLFieldResolver<any, any>
|}, ..._: []): Promise<ExecutionResult>;
/* eslint-disable no-redeclare */
declare function execute(
  schema: GraphQLSchema,
  document: DocumentNode,
  rootValue?: mixed,
  contextValue?: mixed,
  variableValues?: ?{[key: string]: mixed},
  operationName?: ?string,
  fieldResolver?: ?GraphQLFieldResolver<any, any>
): Promise<ExecutionResult>;
export function execute(
  argsOrSchema,
  document,
  rootValue,
  contextValue,
  variableValues,
  operationName,
  fieldResolver
) {
  const result = executeReactive(...arguments);

  return result.next().then(v => {
    if ( typeof result.return === 'function' ) {
      return result.return().then(() => v.value);
    }

    return v.value;
  });
}

/**
 * Implements the "Evaluating requests" section of the GraphQL specification.
 *
 * Returns an AsyncIterator
 *
 * If the arguments to this function do not result in a legal execution context,
 * a GraphQLError will be thrown immediately explaining the invalid input.
 *
 * Accepts either an object with named arguments, or individual arguments.
 */
declare function executeReactive({|
  schema: GraphQLSchema,
  document: DocumentNode,
  rootValue?: mixed,
  contextValue?: mixed,
  variableValues?: ?{[key: string]: mixed},
  operationName?: ?string,
  fieldResolver?: ?GraphQLFieldResolver<any, any>
|}, ..._: []): AsyncIterator<ExecutionResult>;
declare function executeReactive(
  schema: GraphQLSchema,
  document: DocumentNode,
  rootValue?: mixed,
  contextValue?: mixed,
  variableValues?: ?{[key: string]: mixed},
  operationName?: ?string,
  fieldResolver?: ?GraphQLFieldResolver<any, any>
): AsyncIterator<ExecutionResult>;
export function executeReactive(
  argsOrSchema,
  document,
  rootValue,
  contextValue,
  variableValues,
  operationName,
  fieldResolver
) {
  // Extract arguments from object args if provided.
  const args = arguments.length === 1 ? argsOrSchema : undefined;
  const schema = args ? args.schema : argsOrSchema;
  return args ?
    executeImpl(
      schema,
      args.document,
      args.rootValue,
      args.contextValue,
      args.variableValues,
      args.operationName,
      args.fieldResolver
    ) :
    executeImpl(
      schema,
      document,
      rootValue,
      contextValue,
      variableValues,
      operationName,
      fieldResolver
    );
}

function executeImpl(
  schema,
  document,
  rootValue,
  contextValue,
  variableValues,
  operationName,
  fieldResolver
) {
  // If arguments are missing or incorrect, throw an error.
  assertValidExecutionArguments(
    schema,
    document,
    variableValues
  );

  // If a valid context cannot be created due to incorrect arguments,
  // a "Response" with only errors is returned.
  let context;
  try {
    context = buildExecutionContext(
      schema,
      document,
      rootValue,
      contextValue,
      variableValues,
      operationName,
      fieldResolver
    );
  } catch (error) {
    return createAsyncIterator([ { errors: [ error ] } ]);
  }

  // Return an AsyncIterator that will eventually resolve to the data described
  // By the "Response" section of the GraphQL specification.
  //
  // If errors are encountered while executing a GraphQL field, only that
  // field and its descendants will be omitted, and sibling fields will still
  // be executed. An execution which encounters errors will still result in a
  // resolved Promise.
  return mapAsyncIterator(
    executeOperation(context, context.operation, rootValue),
    data => context.errors.length === 0 ?
      { data } :
      { errors: context.errors, data }
  );
}

/**
 * Given a ResponsePath (found in the `path` entry in the information provided
 * as the last argument to a field resolver), return an Array of the path keys.
 */
export function responsePathAsArray(
  path: ResponsePath
): Array<string | number> {
  const flattened = [];
  let curr = path;
  while (curr) {
    flattened.push(curr.key);
    curr = curr.prev;
  }
  return flattened.reverse();
}

/**
 * Given a ResponsePath and a key, return a new ResponsePath containing the
 * new key.
 */
export function addPath(prev: ResponsePath, key: string | number) {
  return { prev, key };
}

/**
 * Essential assertions before executing to provide developer feedback for
 * improper use of the GraphQL library.
 */
export function assertValidExecutionArguments(
  schema: GraphQLSchema,
  document: DocumentNode,
  rawVariableValues: ?{[key: string]: mixed}
): void {
  invariant(schema, 'Must provide schema');
  invariant(document, 'Must provide document');
  invariant(
    schema instanceof GraphQLSchema,
    'Schema must be an instance of GraphQLSchema. Also ensure that there are ' +
    'not multiple versions of GraphQL installed in your node_modules directory.'
  );

  // Variables, if provided, must be an object.
  invariant(
    !rawVariableValues || typeof rawVariableValues === 'object',
    'Variables must be provided as an Object where each property is a ' +
    'variable value. Perhaps look to see if an unparsed JSON string ' +
    'was provided.'
  );
}

/**
 * Constructs a ExecutionContext object from the arguments passed to
 * execute, which we will pass throughout the other execution methods.
 *
 * Throws a GraphQLError if a valid execution context cannot be created.
 */
export function buildExecutionContext(
  schema: GraphQLSchema,
  document: DocumentNode,
  rootValue: mixed,
  contextValue: mixed,
  rawVariableValues: ?{[key: string]: mixed},
  operationName: ?string,
  fieldResolver: ?GraphQLFieldResolver<any, any>
): ExecutionContext {
  const errors: Array<GraphQLError> = [];
  let operation: ?OperationDefinitionNode;
  const fragments: {[name: string]: FragmentDefinitionNode} =
    Object.create(null);
  document.definitions.forEach(definition => {
    switch (definition.kind) {
      case Kind.OPERATION_DEFINITION:
        if (!operationName && operation) {
          throw new GraphQLError(
            'Must provide operation name if query contains multiple operations.'
          );
        }
        if (!operationName ||
            definition.name && definition.name.value === operationName) {
          operation = definition;
        }
        break;
      case Kind.FRAGMENT_DEFINITION:
        fragments[definition.name.value] = definition;
        break;
      default: throw new GraphQLError(
        `GraphQL cannot execute a request containing a ${definition.kind}.`,
        [ definition ]
      );
    }
  });
  if (!operation) {
    if (operationName) {
      throw new GraphQLError(`Unknown operation named "${operationName}".`);
    } else {
      throw new GraphQLError('Must provide an operation.');
    }
  }
  const variableValues = getVariableValues(
    schema,
    operation.variableDefinitions || [],
    rawVariableValues || {}
  );

  return {
    schema,
    fragments,
    rootValue,
    contextValue,
    operation,
    variableValues,
    liveCache: {},
    liveMap: {},
    fieldResolver: fieldResolver || defaultFieldResolver,
    errors,
  };
}

/**
 * Implements the "Evaluating operations" section of the spec.
 */
function executeOperation(
  exeContext: ExecutionContext,
  operation: OperationDefinitionNode,
  rootValue: mixed
): AsyncIterator<mixed> {
  const type = getOperationRootType(exeContext.schema, operation);
  const fields = collectFields(
    exeContext,
    type,
    operation.selectionSet,
    Object.create(null),
    Object.create(null)
  );

  const path = undefined;

  // Errors from sub-fields of a NonNull type may propagate to the top level,
  // at which point we still log the error and null the parent field, which
  // in this case is the entire response.
  //
  // Similar to completeValueCatchingError.
  try {
    const result = operation.operation === 'mutation' ?
      executeFieldsSerially(exeContext, type, rootValue, path, fields) :
      executeFields(exeContext, type, rootValue, path, fields);

    const asyncIterator = getAsyncIterator(result);
    if (asyncIterator) {
      return catchErrorsAsyncIterator(asyncIterator, (error: GraphQLError) => {
        exeContext.errors.push(error);
        return createAsyncIterator([ null ]);
      });
    }

    return createAsyncIterator([ result ]);
  } catch (error) {
    exeContext.errors.push(error);
    return createAsyncIterator([ null ]);
  }
}

/**
 * Extracts the root type of the operation from the schema.
 */
export function getOperationRootType(
  schema: GraphQLSchema,
  operation: OperationDefinitionNode
): GraphQLObjectType {
  switch (operation.operation) {
    case 'query':
      return schema.getQueryType();
    case 'mutation':
      const mutationType = schema.getMutationType();
      if (!mutationType) {
        throw new GraphQLError(
          'Schema is not configured for mutations',
          [ operation ]
        );
      }
      return mutationType;
    case 'subscription':
      const subscriptionType = schema.getSubscriptionType();
      if (!subscriptionType) {
        throw new GraphQLError(
          'Schema is not configured for subscriptions',
          [ operation ]
        );
      }
      return subscriptionType;
    default:
      throw new GraphQLError(
        'Can only execute queries, mutations and subscriptions',
        [ operation ]
      );
  }
}

/**
 * Implements the "Evaluating selection sets" section of the spec
 * for "write" mode.
 */
function executeFieldsSerially(
  exeContext: ExecutionContext,
  parentType: GraphQLObjectType,
  sourceValue: mixed,
  path: ResponsePath,
  fields: {[key: string]: Array<FieldNode>}
): AsyncIterator<{[key: string]: mixed}> {
  return Object.keys(fields).reduce(
    (prev, responseName) => concatAsyncIterator(prev, lastResult => {
      const results = lastResult || {};
      const fieldNodes = fields[responseName];
      const fieldPath = addPath(path, responseName);
      const result = resolveField(
        exeContext,
        parentType,
        sourceValue,
        fieldNodes,
        fieldPath
      );

      if (result === undefined) {
        return results;
      }

      const asyncIterator = getAsyncIterator(result);
      if (asyncIterator) {
        return mapAsyncIterator(asyncIterator, resolvedResult => {
          results[responseName] = resolvedResult;
          return results;
        });
      }

      results[responseName] = result;
      return results;
    }),
    createAsyncIterator([ {} ])
  );
}

/**
 * Implements the "Evaluating selection sets" section of the spec
 * for "read" mode.
 */
function executeFields(
  exeContext: ExecutionContext,
  parentType: GraphQLObjectType,
  sourceValue: mixed,
  path: ResponsePath,
  fields: {[key: string]: Array<FieldNode>}
): {[key: string]: mixed} {
  let containsAsyncIterator = false;

  const finalResults = Object.keys(fields).reduce(
    (results, responseName) => {
      const fieldNodes = fields[responseName];
      const fieldPath = addPath(path, responseName);
      const result = resolveField(
        exeContext,
        parentType,
        sourceValue,
        fieldNodes,
        fieldPath
      );
      if (result === undefined) {
        return results;
      }

      results[responseName] = result;
      if (isAsyncIterable(result)) {
        containsAsyncIterator = true;
      }
      return results;
    },
    Object.create(null)
  );

  // If there are no iterators, we can just return the object
  if (!containsAsyncIterator) {
    return finalResults;
  }

  // Otherwise, results is a map from field name to the result
  // of resolving that field, which is possibly an async iterator. Return
  // a async iterator that will return this; same map, but with any
  // async iterator replaced with the values they resolved to.
  return asyncIteratorForObject(finalResults);
}

/**
 * Given a selectionSet, adds all of the fields in that selection to
 * the passed in map of fields, and returns it at the end.
 *
 * CollectFields requires the "runtime type" of an object. For a field which
 * returns an Interface or Union type, the "runtime type" will be the actual
 * Object type returned by that field.
 */
export function collectFields(
  exeContext: ExecutionContext,
  runtimeType: GraphQLObjectType,
  selectionSet: SelectionSetNode,
  fields: {[key: string]: Array<FieldNode>},
  visitedFragmentNames: {[key: string]: boolean},

  // GQL-RxJs: helper arguments for supporting @live
  parentPath: ResponsePath,
  parentLive: ?boolean,
): {[key: string]: Array<FieldNode>} {
  for (let i = 0; i < selectionSet.selections.length; i++) {
    const selection = selectionSet.selections[i];
    switch (selection.kind) {
      case Kind.FIELD:
        if (!shouldIncludeNode(exeContext, selection)) {
          continue;
        }
        const name = getFieldEntryKey(selection);
        if (!fields[name]) {
          fields[name] = [];
        }

        // GQL-RxJs: append to liveMap
        const isLive = parentLive || hasLiveDirective(selection.directives);
        const fieldPath = responsePathAsArray(
          addPath(parentPath, name),
        ).join('.');
        exeContext.liveMap[fieldPath] = isLive;

        fields[name].push(selection);
        break;
      case Kind.INLINE_FRAGMENT:
        if (!shouldIncludeNode(exeContext, selection) ||
            !doesFragmentConditionMatch(exeContext, selection, runtimeType)) {
          continue;
        }
        collectFields(
          exeContext,
          runtimeType,
          selection.selectionSet,
          fields,
          visitedFragmentNames,

          // GQL-RxJs: collect live status from fragmant
          parentPath,
          parentLive || hasLiveDirective(selection.directives),
        );
        break;
      case Kind.FRAGMENT_SPREAD:
        const fragName = selection.name.value;
        if (visitedFragmentNames[fragName] ||
            !shouldIncludeNode(exeContext, selection)) {
          continue;
        }
        visitedFragmentNames[fragName] = true;
        const fragment = exeContext.fragments[fragName];
        if (!fragment ||
            !doesFragmentConditionMatch(exeContext, fragment, runtimeType)) {
          continue;
        }
        collectFields(
          exeContext,
          runtimeType,
          fragment.selectionSet,
          fields,
          visitedFragmentNames,

          // GQL-RxJs: collect live status from fragmant
          // for Spread fragments it can be either selective @live on the spread
          // or live fragment on fragment itself.
          parentPath,
          parentLive ||
          hasLiveDirective(selection.directives) ||
          hasLiveDirective(fragment.directives),
        );
        break;
    }
  }
  return fields;
}

/**
 * Determines if a field should be included based on the @include and @skip
 * directives, where @skip has higher precidence than @include.
 */
function shouldIncludeNode(
  exeContext: ExecutionContext,
  node: FragmentSpreadNode | FieldNode | InlineFragmentNode,
): boolean {
  const skip = getDirectiveValues(
    GraphQLSkipDirective,
    node,
    exeContext.variableValues
  );
  if (skip && skip.if === true) {
    return false;
  }

  const include = getDirectiveValues(
    GraphQLIncludeDirective,
    node,
    exeContext.variableValues
  );
  if (include && include.if === false) {
    return false;
  }
  return true;
}

/**
 * Determines if a fragment is applicable to the given type.
 */
function doesFragmentConditionMatch(
  exeContext: ExecutionContext,
  fragment: FragmentDefinitionNode | InlineFragmentNode,
  type: GraphQLObjectType
): boolean {
  const typeConditionNode = fragment.typeCondition;
  if (!typeConditionNode) {
    return true;
  }
  const conditionalType = typeFromAST(exeContext.schema, typeConditionNode);
  if (conditionalType === type) {
    return true;
  }
  if (isAbstractType(conditionalType)) {
    return exeContext.schema.isPossibleType(conditionalType, type);
  }
  return false;
}

/**
 * This function transforms a JS object `{[key: string]: Promise<T>}` into
 * a `Promise<{[key: string]: T}>`
 *
 * This is akin to bluebird's `Promise.props`, but implemented only using
 * `Promise.all` so it will work with any implementation of ES6 promises.
 */
function asyncIteratorForObject<T>(
  object: {[key: string]: mixed}
): AsyncIterator<{[key: string]: T}> {
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

/**
 * Implements the logic to compute the key of a given field's entry
 */
function getFieldEntryKey(node: FieldNode): string {
  return node.alias ? node.alias.value : node.name.value;
}

/**
 * Resolves the field on the given source object. In particular, this
 * figures out the value that the field returns by calling its resolve function,
 * then calls completeValue to complete promises, serialize scalars, or execute
 * the sub-selection-set for objects.
 */
function resolveField(
  exeContext: ExecutionContext,
  parentType: GraphQLObjectType,
  source: mixed,
  fieldNodes: Array<FieldNode>,
  path: ResponsePath
): mixed {
  const fieldNode = fieldNodes[0];
  const fieldName = fieldNode.name.value;

  const fieldDef = getFieldDef(exeContext.schema, parentType, fieldName);
  if (!fieldDef) {
    return;
  }

  const resolveFn = fieldDef.resolve || exeContext.fieldResolver;

  const info = buildResolveInfo(
    exeContext,
    fieldDef,
    fieldNodes,
    parentType,
    path
  );

  // Get the resolve function, regardless of if its result is normal
  // or abrupt (error).
  const result = resolveWithLive(
    exeContext,
    fieldDef,
    fieldNodes,
    resolveFn,
    source,
    info
  );

  return completeValueCatchingError(
    exeContext,
    fieldDef.type,
    fieldNodes,
    info,
    path,
    result
  );
}

export function buildResolveInfo(
  exeContext: ExecutionContext,
  fieldDef: GraphQLField<*, *>,
  fieldNodes: Array<FieldNode>,
  parentType: GraphQLObjectType,
  path: ResponsePath
): GraphQLResolveInfo {
  // The resolve function's optional fourth argument is a collection of
  // information about the current execution state.
  return {
    fieldName: fieldNodes[0].name.value,
    fieldNodes,
    returnType: fieldDef.type,
    parentType,
    path,
    schema: exeContext.schema,
    fragments: exeContext.fragments,
    rootValue: exeContext.rootValue,
    operation: exeContext.operation,
    variableValues: exeContext.variableValues,
  };
}

// Isolates the "ReturnOrAbrupt" behavior to not de-opt the `resolveField`
// function. Returns the result of resolveFn or the abrupt-return Error object.
export function resolveFieldValueOrError<TSource>(
  exeContext: ExecutionContext,
  fieldDef: GraphQLField<TSource, *>,
  fieldNodes: Array<FieldNode>,
  resolveFn: GraphQLFieldResolver<TSource, *>,
  source: TSource,
  info: GraphQLResolveInfo
): Error | mixed {
  try {
    // Build a JS object of arguments from the field.arguments AST, using the
    // variables scope to fulfill any variable references.
    // TODO: find a way to memoize, in case this field is within a List type.
    const args = getArgumentValues(
      fieldDef,
      fieldNodes[0],
      exeContext.variableValues
    );

    // The resolve function's optional third argument is a context value that
    // is provided to every resolve function within an execution. It is commonly
    // used to represent an authenticated user, or request-specific caches.
    const context = exeContext.contextValue;

    return resolveFn(source, args, context, info);
  } catch (error) {
    // Sometimes a non-error is thrown, wrap it as an Error for a
    // consistent interface.
    return error instanceof Error ? error : new Error(error);
  }
}

// This is a small wrapper around completeValue which detects and logs errors
// in the execution context.
function completeValueCatchingError(
  exeContext: ExecutionContext,
  returnType: GraphQLType,
  fieldNodes: Array<FieldNode>,
  info: GraphQLResolveInfo,
  path: ResponsePath,
  result: mixed
): mixed {
  // If the field type is non-nullable, then it is resolved without any
  // protection from errors, however it still properly locates the error.
  if (returnType instanceof GraphQLNonNull) {
    return completeValueWithLocatedError(
      exeContext,
      returnType,
      fieldNodes,
      info,
      path,
      result
    );
  }

  // Otherwise, error protection is applied, logging the error and resolving
  // a null value for this field if one is encountered.
  try {
    const completed = completeValueWithLocatedError(
      exeContext,
      returnType,
      fieldNodes,
      info,
      path,
      result
    );
    const asyncIterable = getAsyncIterator(completed);
    if (asyncIterable) {
      // If `completeValueWithLocatedError` returned a rejected promise, log
      // the rejection error and resolve to null.
      // Note: we don't rely on a `catch` method, but we do expect "thenable"
      // to take a second callback for the error case.
      return catchErrorsAsyncIterator(asyncIterable, (error: GraphQLError) => {
        exeContext.errors.push(error);
        return createAsyncIterator([ null ]);
      });
    }
    return completed;
  } catch (error) {
    // If `completeValueWithLocatedError` returned abruptly (threw an error),
    // log the error and return null.
    exeContext.errors.push(error);
    return null;
  }
}

// This is a small wrapper around completeValue which annotates errors with
// location information.
function completeValueWithLocatedError(
  exeContext: ExecutionContext,
  returnType: GraphQLType,
  fieldNodes: Array<FieldNode>,
  info: GraphQLResolveInfo,
  path: ResponsePath,
  result: mixed
): mixed {
  try {
    const completed = completeValue(
      exeContext,
      returnType,
      fieldNodes,
      info,
      path,
      result
    );
    const asyncIterable = getAsyncIterator(completed);
    if (asyncIterable) {
      return addLocatedErrorAsyncIterator(asyncIterable, fieldNodes, path);
    }
    return completed;
  } catch (error) {
    throw locatedError(error, fieldNodes, responsePathAsArray(path));
  }
}

/**
 * Implements the instructions for completeValue as defined in the
 * "Field entries" section of the spec.
 *
 * If the field type is Non-Null, then this recursively completes the value
 * for the inner type. It throws a field error if that completion returns null,
 * as per the "Nullability" section of the spec.
 *
 * If the field type is a List, then this recursively completes the value
 * for the inner type on each item in the list.
 *
 * If the field type is a Scalar or Enum, ensures the completed value is a legal
 * value of the type by calling the `serialize` method of GraphQL type
 * definition.
 *
 * If the field is an abstract type, determine the runtime type of the value
 * and then complete based on that type
 *
 * Otherwise, the field type expects a sub-selection set, and will complete the
 * value by evaluating all sub-selections.
 */
function completeValue(
  exeContext: ExecutionContext,
  returnType: GraphQLType,
  fieldNodes: Array<FieldNode>,
  info: GraphQLResolveInfo,
  path: ResponsePath,
  result: mixed
): mixed {
  // If result is a Promise, apply-lift over completeValue.
  const promise = getPromise(result);
  const asyncIterable = (promise && toAsyncIterator(promise)) ||
    getAsyncIterator(result);

  if (asyncIterable) {
    const completedValue = switchMapAsyncIterator(
      asyncIterable,
      resolved => toAsyncIterator(completeValue(
        exeContext,
        returnType,
        fieldNodes,
        info,
        path,
        resolved
      ))
    );

    return handleDeferDirective(exeContext,
      fieldNodes[0].directives,
      info,
      path,
      completedValue);
  }

  // If result is an Error, throw a located error.
  if (result instanceof Error) {
    throw result;
  }

  // If field type is NonNull, complete for inner type, and throw field error
  // if result is null.
  if (returnType instanceof GraphQLNonNull) {
    const completed = completeValue(
      exeContext,
      returnType.ofType,
      fieldNodes,
      info,
      path,
      result
    );
    if (completed === null) {
      throw new Error(
        `Cannot return null for non-nullable field ${
          info.parentType.name}.${info.fieldName}.`
      );
    }
    return completed;
  }

  // If result value is null-ish (null, undefined, or NaN) then return null.
  if (isNullish(result)) {
    return null;
  }

  // If field type is List, complete each item in the list with the inner type
  if (returnType instanceof GraphQLList) {
    return completeListValue(
      exeContext,
      returnType,
      fieldNodes,
      info,
      path,
      result
    );
  }

  // If field type is a leaf type, Scalar or Enum, serialize to a valid value,
  // returning null if serialization is not possible.
  if (isLeafType(returnType)) {
    return completeLeafValue(returnType, result);
  }

  // If field type is an abstract type, Interface or Union, determine the
  // runtime Object type and complete for that type.
  if (isAbstractType(returnType)) {
    return completeAbstractValue(
      exeContext,
      returnType,
      fieldNodes,
      info,
      path,
      result
    );
  }

  // If field type is Object, execute and complete all sub-selections.
  if (returnType instanceof GraphQLObjectType) {
    return completeObjectValue(
      exeContext,
      returnType,
      fieldNodes,
      info,
      path,
      result
    );
  }

  // Not reachable. All possible output types have been considered.
  throw new Error(
    `Cannot complete value of unexpected type "${String(returnType)}".`
  );
}

/**
 * Complete a list value by completing each item in the list with the
 * inner type
 */
function completeListValue(
  exeContext: ExecutionContext,
  returnType: GraphQLList<*>,
  fieldNodes: Array<FieldNode>,
  info: GraphQLResolveInfo,
  path: ResponsePath,
  result: mixed
): mixed {
  invariant(
    isCollection(result),
    `Expected Iterable, but did not find one for field ${
      info.parentType.name}.${info.fieldName}.`
  );

  // This is specified as a simple map, however we're optimizing the path
  // where the list contains no Promises by avoiding creating another Promise.
  const itemType = returnType.ofType;
  let containsAsyncIterator = false;
  const completedResults = [];
  forEach((result: any), (item, index) => {
    // No need to modify the info object containing the path,
    // since from here on it is not ever accessed by resolver functions.
    const fieldPath = addPath(path, index);
    const completedItem = completeValueCatchingError(
      exeContext,
      itemType,
      fieldNodes,
      info,
      fieldPath,
      item
    );

    if (!containsAsyncIterator && isAsyncIterable(completedItem)) {
      containsAsyncIterator = true;
    }
    completedResults.push(completedItem);
  });

  return containsAsyncIterator ?
    toAsyncIterator(completedResults) : completedResults;
}

/**
 * Complete a Scalar or Enum by serializing to a valid value, returning
 * null if serialization is not possible.
 */
function completeLeafValue(
  returnType: GraphQLLeafType,
  result: mixed
): mixed {
  invariant(returnType.serialize, 'Missing serialize method on type');
  const serializedResult = returnType.serialize(result);
  if (isNullish(serializedResult)) {
    throw new Error(
      `Expected a value of type "${String(returnType)}" but ` +
      `received: ${String(result)}`
    );
  }
  return serializedResult;
}

/**
 * Complete a value of an abstract type by determining the runtime object type
 * of that value, then complete the value for that type.
 */
function completeAbstractValue(
  exeContext: ExecutionContext,
  returnType: GraphQLAbstractType,
  fieldNodes: Array<FieldNode>,
  info: GraphQLResolveInfo,
  path: ResponsePath,
  result: mixed
): mixed {
  const runtimeType = returnType.resolveType ?
    returnType.resolveType(result, exeContext.contextValue, info) :
    defaultResolveTypeFn(result, exeContext.contextValue, info, returnType);

  // GQL-RxJs: No Reason to support observable from resolveType..
  const promise = getPromise(runtimeType);
  if (promise) {
    return switchMapAsyncIterator(toAsyncIterator(promise),
      resolvedRuntimeType => toAsyncIterator(completeObjectValue(
        exeContext,
        ensureValidRuntimeType(
          // XXX: Better to resolve properly without casting here.
          ((resolvedRuntimeType: any): ?GraphQLObjectType | string),
          exeContext,
          returnType,
          fieldNodes,
          info,
          result
        ),
        fieldNodes,
        info,
        path,
        result
      )
    ));
  }

  return completeObjectValue(
    exeContext,
    ensureValidRuntimeType(
      ((runtimeType: any): ?GraphQLObjectType | string),
      exeContext,
      returnType,
      fieldNodes,
      info,
      result
    ),
    fieldNodes,
    info,
    path,
    result
  );
}

function ensureValidRuntimeType(
  runtimeTypeOrName: ?GraphQLObjectType | string,
  exeContext: ExecutionContext,
  returnType: GraphQLAbstractType,
  fieldNodes: Array<FieldNode>,
  info: GraphQLResolveInfo,
  result: mixed
): GraphQLObjectType {
  const runtimeType = typeof runtimeTypeOrName === 'string' ?
    exeContext.schema.getType(runtimeTypeOrName) :
    runtimeTypeOrName;

  if (!(runtimeType instanceof GraphQLObjectType)) {
    throw new GraphQLError(
      `Abstract type ${returnType.name} must resolve to an Object type at ` +
      `runtime for field ${info.parentType.name}.${info.fieldName} with ` +
      `value "${String(result)}", received "${String(runtimeType)}".`,
      fieldNodes
    );
  }

  if (!exeContext.schema.isPossibleType(returnType, runtimeType)) {
    throw new GraphQLError(
      `Runtime Object type "${runtimeType.name}" is not a possible type ` +
      `for "${returnType.name}".`,
      fieldNodes
    );
  }

  return runtimeType;
}

/**
 * Complete an Object value by executing all sub-selections.
 */
function completeObjectValue(
  exeContext: ExecutionContext,
  returnType: GraphQLObjectType,
  fieldNodes: Array<FieldNode>,
  info: GraphQLResolveInfo,
  path: ResponsePath,
  result: mixed
): mixed {
  // If there is an isTypeOf predicate function, call it with the
  // current result. If isTypeOf returns false, then raise an error rather
  // than continuing execution.
  if (returnType.isTypeOf) {
    const isTypeOf = returnType.isTypeOf(result, exeContext.contextValue, info);

    // GQL-RxJs: No Reason to support observable from isTypeOf..
    const promise = getPromise(isTypeOf);
    if (promise) {
      return switchMapAsyncIterator(toAsyncIterator(promise),
        isTypeOfResult => {
          if (!isTypeOfResult) {
            throw invalidReturnTypeError(returnType, result, fieldNodes);
          }
          return toAsyncIterator(collectAndExecuteSubfields(
            exeContext,
            returnType,
            fieldNodes,
            info,
            path,
            result
          ));
        }
      );
    }

    if (!isTypeOf) {
      throw invalidReturnTypeError(returnType, result, fieldNodes);
    }
  }

  return collectAndExecuteSubfields(
    exeContext,
    returnType,
    fieldNodes,
    info,
    path,
    result
  );
}

function invalidReturnTypeError(
  returnType: GraphQLObjectType,
  result: mixed,
  fieldNodes: Array<FieldNode>
): GraphQLError {
  return new GraphQLError(
    `Expected value of type "${returnType.name}" but got: ${String(result)}.`,
    fieldNodes
  );
}

function collectAndExecuteSubfields(
  exeContext: ExecutionContext,
  returnType: GraphQLObjectType,
  fieldNodes: Array<FieldNode>,
  info: GraphQLResolveInfo,
  path: ResponsePath,
  result: mixed
): mixed {
  // Collect sub-fields to execute to complete this value.
  let subFieldNodes = Object.create(null);
  const visitedFragmentNames = Object.create(null);
  for (let i = 0; i < fieldNodes.length; i++) {
    const selectionSet = fieldNodes[i].selectionSet;
    if (selectionSet) {
      subFieldNodes = collectFields(
        exeContext,
        returnType,
        selectionSet,
        subFieldNodes,
        visitedFragmentNames,
        path
      );
    }
  }

  return executeFields(exeContext, returnType, result, path, subFieldNodes);
}

/**
 * If a resolveType function is not given, then a default resolve behavior is
 * used which tests each possible type for the abstract type by calling
 * isTypeOf for the object being coerced, returning the first type that matches.
 */
function defaultResolveTypeFn(
  value: mixed,
  context: mixed,
  info: GraphQLResolveInfo,
  abstractType: GraphQLAbstractType
): ?GraphQLObjectType | Promise<?GraphQLObjectType> {
  const possibleTypes = info.schema.getPossibleTypes(abstractType);
  const promisedIsTypeOfResults = [];

  for (let i = 0; i < possibleTypes.length; i++) {
    const type = possibleTypes[i];

    if (type.isTypeOf) {
      const isTypeOfResult = type.isTypeOf(value, context, info);

      // GQL-RxJs: Will no need to handle the promise here because
      // it is handled in completeAbstractValue.
      const promise = getPromise(isTypeOfResult);
      if (promise) {
        promisedIsTypeOfResults[i] = promise;
      } else if (isTypeOfResult) {
        return type;
      }
    }
  }

  if (promisedIsTypeOfResults.length) {
    return Promise.all(promisedIsTypeOfResults).then(isTypeOfResults => {
      for (let i = 0; i < isTypeOfResults.length; i++) {
        if (isTypeOfResults[i]) {
          return possibleTypes[i];
        }
      }
    });
  }
}

/**
 * If a resolve function is not given, then a default resolve behavior is used
 * which takes the property of the source object of the same name as the field
 * and returns it as the result, or if it's a function, returns the result
 * of calling that function while passing along args and context.
 */
export const defaultFieldResolver: GraphQLFieldResolver<any, *> =
function (source, args, context, info) {
  // ensure source is a value for which property access is acceptable.
  if (typeof source === 'object' || typeof source === 'function') {
    const property = source[info.fieldName];
    if (typeof property === 'function') {
      return source[info.fieldName](args, context, info);
    }
    return property;
  }
};

/**
 * Only returns the value if it acts like a Promise, i.e. has a "then" function,
 * otherwise returns void.
 */
function getPromise<T>(value: Promise<T> | mixed): Promise<T> | void {
  if (typeof value === 'object' &&
      value !== null &&
      typeof value.then === 'function') {
    return (value: any);
  }
}

/**
 * This method looks up the field on the given type defintion.
 * It has special casing for the two introspection fields, __schema
 * and __typename. __typename is special because it can always be
 * queried as a field, even in situations where no other fields
 * are allowed, like on a Union. __schema could get automatically
 * added to the query type, but that would require mutating type
 * definitions, which would cause issues.
 */
export function getFieldDef(
  schema: GraphQLSchema,
  parentType: GraphQLObjectType,
  fieldName: string
): ?GraphQLField<*, *> {
  if (fieldName === SchemaMetaFieldDef.name &&
      schema.getQueryType() === parentType) {
    return SchemaMetaFieldDef;
  } else if (fieldName === TypeMetaFieldDef.name &&
             schema.getQueryType() === parentType) {
    return TypeMetaFieldDef;
  } else if (fieldName === TypeNameMetaFieldDef.name) {
    return TypeNameMetaFieldDef;
  }
  return parentType.getFields()[fieldName];
}

function resolveWithLive<TSource>(
  exeContext: ExecutionContext,
  fieldDef: GraphQLField<TSource, *>,
  fieldNodes: Array<FieldNode>,
  resolveFn: GraphQLFieldResolver<TSource, *>,
  source: TSource,
  info: GraphQLResolveInfo
): Error | mixed {
  const path = responsePathAsArray(info.path).join('.');

  if ( exeContext.liveCache.hasOwnProperty(path) ) {
    return exeContext.liveCache[path];
  }

  let result = resolveFieldValueOrError(
    exeContext,
    fieldDef,
    fieldNodes,
    resolveFn,
    source,
    info
  );

  // if promise is returned, convert to async iterator.
  if ( getPromise(result) ) {
    result = toAsyncIterator(result);
  }

  // Store result for live if possible

  // no need to store result if node isn't possibly live till the end.
  // or parent is live itself. (not in liveCache)
  if ( exeContext.liveMap[path] ) {
    return result;
  }

  const iterator = getAsyncIterator(result);
  if ( iterator && !selectionPossiblyHasLive(exeContext, fieldNodes[0]) ) {
    result = takeFirstAsyncIterator(iterator);
  }

  exeContext.liveCache[path] = result;
  return result;
}

function handleDeferDirective<T>(
  exeContext: ExecutionContext,
  directives: ?Array<DirectiveNode>,
  info: GraphQLResolveInfo,
  path: ResponsePath,
  result: AsyncIterator<T>,
): AsyncIterator<?T> {

  if ( !directives ) {
    return result;
  }

  const isDeffered = directives
    .some(d => d.name.value === GraphQLDeferDirective.name);
  return isDeffered ? DefferAsyncIterator(result) : result;
}

function hasLiveDirective(
  directives: ?Array<DirectiveNode>
): boolean {
  if ( !directives ) {
    return false;
  }

  return directives
    .some(d => d.name.value === GraphQLLiveDirective.name);
}

function selectionPossiblyHasLive(
  exeContext: ExecutionContext,
  selection: SelectionNode,
) {
  if ( hasLiveDirective(selection.directives) ) {
    return true;
  }
  let selectionSet: ?SelectionSetNode;

  switch ( selection.kind ) {
    case Kind.FIELD:
      if (!shouldIncludeNode(exeContext, selection)) {
        return false;
      }

      selectionSet = selection.selectionSet;
      break;
    case Kind.INLINE_FRAGMENT:
      if (!shouldIncludeNode(exeContext, selection)) {
        return false;
      }

      selectionSet = selection.selectionSet;
      break;
    case Kind.FRAGMENT_SPREAD:
      const fragName = selection.name.value;
      if (!shouldIncludeNode(exeContext, selection)) {
        return false;
      }
      const fragment = exeContext.fragments[fragName];
      if (!fragment) {
        return false;
      }
      if ( hasLiveDirective(fragment.directives) ) {
        return true;
      }

      selectionSet = fragment.selectionSet;
      break;
    default:
      return false;
  }

  if ( !selectionSet ) {
    return false;
  }

  return selectionSet.selections.some(curSelection => {
    return selectionPossiblyHasLive(exeContext, curSelection);
  });
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

  if ( isAsyncIterable(object) || getPromise(object) ) {
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
function toAsyncIterator(result: mixed): AsyncIterator<mixed> {
  if (result === undefined) {
    return ((undefined: any): AsyncIterator<mixed>);
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
    return ((result: any): AsyncIterator<mixed>);
  }

  if (getPromise(result)) {
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
function combineLatestAsyncIterator(
  iterators: Array<AsyncIterator<mixed>>
): AsyncIterator<Array<mixed>> {
  let liveIterators:Array<AsyncIterator<mixed>> = [].concat(iterators);

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
            return state;
          });

        return p;
      });
    }

    // Yield latest state for each changing state.
    async function* nextValues() {
      let nextPromises = getNext();

      while ( nextPromises.length > 0 ) {
        const firstResolved = Promise.race(nextPromises);

        yield await firstResolved; // eslint-disable-line no-await-in-loop
        nextPromises = nextPromises.filter(p => !p.done);
      }
    }

    // First make sure every iterator runs at least once.
    await Promise.all(getNext());

    // Yield initial state
    yield state;

    while ( liveIterators.length > 0 ) {
      yield* nextValues();
    }
  }

  return combineLatestGenerator();
}

/**
 * Utility function to concat asyncIterator results
 */
function concatAsyncIterator<T>(
  iterator: AsyncIterator<T>,
  concatCallback: (latestValue: ?T) => AsyncIterator<T> | T
): AsyncIterator<T> {
  async function* concatGenerator() {
    let latestValue: T;
    const infinateLoop = true;

    while ( infinateLoop ) {
      const i = await iterator.next();
      if ( i.done ) {
        break;
      }

      latestValue = i.value;
    }

    const next: AsyncIterator<T> | T = concatCallback(latestValue);
    const nextIterator: ?AsyncIterator<T> = getAsyncIterator(next);
    if ( nextIterator ) {
      yield* nextIterator;
    } else {
      yield ((next: any): T);
    }
  }

  return concatGenerator();
}

/**
 * Utility function to take only first result of asyncIterator results
 */
function takeFirstAsyncIterator<T>(
  iterator: AsyncIterator<T>
): AsyncIterator<?T> {
  async function* takeFirstGenerator() {
    // take only first promise.
    yield await iterator.next().then(({ value }) => value);

    if ( typeof iterator.return === 'function' ) {
      iterator.return();
    }
  }

  return takeFirstGenerator();
}

/**
 * Utility function to catch errors of asyncIterator
 */
function catchErrorsAsyncIterator<T>(
  iterator: AsyncIterator<T>,
  errorHandler: (error: any) => AsyncIterator<T>
): AsyncIterator<T> {
  async function* catchGenerator() {
    let err: ?AsyncIterator<T>;
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
      for await (const item of err) { // eslint-disable-line semi
        yield item; // eslint-disable-line no-await-in-loop
      }
    }
  }

  return catchGenerator();
}

/**
 * Utility function to switchMap over asyncIterator
 */
function switchMapAsyncIterator<T, U>(
  iterator: AsyncIterator<T>,
  switchMapCallback: (value: T) => AsyncIterator<U>
): AsyncIterator<U> {
  async function* switchMapGenerator() {
    const infinateLoop = true;
    let outerValue:IteratorResult<T, void>;

    outerValue = await iterator.next();
    while (!outerValue.done) {
      const inner = switchMapCallback(outerValue.value);
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

  return switchMapGenerator();
}

/**
 * Utility function to deffer over asyncIterator
 */
function DefferAsyncIterator<T>(
  iterator: AsyncIterator<T>
): AsyncIterator<?T> {

  async function* defferGenerator() {
    // reply with undefine as initial result.
    yield undefined;

    // yield the origial iterator.
    yield* iterator;
  }

  return defferGenerator();
}

function addLocatedErrorAsyncIterator<T>(
  iterator: AsyncIterator<T>,
  fieldNodes: Array<FieldNode>,
  path: ResponsePath
): AsyncIterator<T> {
  return catchErrorsAsyncIterator(
    iterator,
    error => {
      async function* errorGenerator() {
        throw locatedError(error, fieldNodes, responsePathAsArray(path));
      }

      return errorGenerator();
    }
  );
}
