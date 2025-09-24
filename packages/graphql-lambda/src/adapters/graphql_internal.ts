/**
 * Copies of `graphql-js` internal functions (not exported by index file).
 * To make sure there's no multiple module realms (instances) of `graphql` package
 * which causes the type checking error
 *
 * TODO: should ask `graphql-js` to export these internal functions
 */

import {
	defaultFieldResolver,
	defaultTypeResolver,
	getDirectiveValues,
	getVariableValues,
	GraphQLError,
	GraphQLIncludeDirective,
	GraphQLObjectType,
	GraphQLSchema,
	GraphQLSkipDirective,
	isAbstractType,
	Kind,
	SchemaMetaFieldDef,
	typeFromAST,
	TypeMetaFieldDef,
	TypeNameMetaFieldDef,
	type ExecutionArgs,
	type FieldNode,
	type FragmentDefinitionNode,
	type FragmentSpreadNode,
	type GraphQLField,
	type GraphQLFieldResolver,
	type GraphQLResolveInfo,
	type GraphQLTypeResolver,
	type InlineFragmentNode,
	type OperationDefinitionNode,
	type SelectionSetNode,
} from 'graphql';

export interface ObjMap<T> {
	[key: string]: T;
}

export interface ExecutionContext {
	schema: GraphQLSchema;
	fragments: ObjMap<FragmentDefinitionNode>;
	rootValue: unknown;
	contextValue: unknown;
	operation: OperationDefinitionNode;
	variableValues: { [variable: string]: unknown };
	fieldResolver: GraphQLFieldResolver<any, any>;
	typeResolver: GraphQLTypeResolver<any, any>;
	subscribeFieldResolver: GraphQLFieldResolver<any, any>;
	errors: Array<GraphQLError>;
}

/**
 * Constructs a ExecutionContext object from the arguments passed to
 * execute, which we will pass throughout the other execution methods.
 *
 * Throws a GraphQLError if a valid execution context cannot be created.
 *
 * @internal
 */
export function buildExecutionContext(
	args: ExecutionArgs,
): ReadonlyArray<GraphQLError> | ExecutionContext {
	const {
		schema,
		document,
		rootValue,
		contextValue,
		variableValues: rawVariableValues,
		operationName,
		fieldResolver,
		typeResolver,
		subscribeFieldResolver,
		options,
	} = args;

	let operation: OperationDefinitionNode | undefined;
	const fragments = Object.create(null);
	for (const definition of document.definitions) {
		switch (definition.kind) {
			case Kind.OPERATION_DEFINITION:
				if (operationName == null) {
					if (operation !== undefined) {
						return [
							new GraphQLError(
								'Must provide operation name if query contains multiple operations.',
							),
						];
					}
					operation = definition;
				} else if (definition.name?.value === operationName) {
					operation = definition;
				}
				break;
			case Kind.FRAGMENT_DEFINITION:
				fragments[definition.name.value] = definition;
				break;
			default:
			// ignore non-executable definitions
		}
	}

	if (!operation) {
		if (operationName != null) {
			return [new GraphQLError(`Unknown operation named "${operationName}".`)];
		}
		return [new GraphQLError('Must provide an operation.')];
	}

	// FIXME: https://github.com/graphql/graphql-js/issues/2203
	/* c8 ignore next */
	const variableDefinitions = operation.variableDefinitions ?? [];

	const coercedVariableValues = getVariableValues(
		schema,
		variableDefinitions,
		rawVariableValues ?? {},
		{ maxErrors: options?.maxCoercionErrors ?? 50 },
	);

	if (coercedVariableValues.errors) {
		return coercedVariableValues.errors;
	}

	return {
		schema,
		fragments,
		rootValue,
		contextValue,
		operation,
		variableValues: coercedVariableValues.coerced,
		fieldResolver: fieldResolver ?? defaultFieldResolver,
		typeResolver: typeResolver ?? defaultTypeResolver,
		subscribeFieldResolver: subscribeFieldResolver ?? defaultFieldResolver,
		errors: [],
	};
}

export type Maybe<T> = null | undefined | T;

/**
 * This method looks up the field on the given type definition.
 * It has special casing for the three introspection fields,
 * __schema, __type and __typename. __typename is special because
 * it can always be queried as a field, even in situations where no
 * other fields are allowed, like on a Union. __schema and __type
 * could get automatically added to the query type, but that would
 * require mutating type definitions, which would cause issues.
 *
 * @internal
 */
export function getFieldDef(
	schema: GraphQLSchema,
	parentType: GraphQLObjectType,
	fieldNode: FieldNode,
): Maybe<GraphQLField<unknown, unknown>> {
	const fieldName = fieldNode.name.value;

	if (
		fieldName === SchemaMetaFieldDef.name &&
		schema.getQueryType() === parentType
	) {
		return SchemaMetaFieldDef;
	} else if (
		fieldName === TypeMetaFieldDef.name &&
		schema.getQueryType() === parentType
	) {
		return TypeMetaFieldDef;
	} else if (fieldName === TypeNameMetaFieldDef.name) {
		return TypeNameMetaFieldDef;
	}

	return parentType.getFields()[fieldName];
}

/**
 * @internal
 */
export function buildResolveInfo(
	exeContext: ExecutionContext,
	fieldDef: GraphQLField<unknown, unknown>,
	fieldNodes: ReadonlyArray<FieldNode>,
	parentType: GraphQLObjectType,
	path: Path,
): GraphQLResolveInfo {
	// The resolve function's optional fourth argument is a collection of
	// information about the current execution state.
	return {
		fieldName: fieldDef.name,
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

export interface Path {
	readonly prev: Path | undefined;
	readonly key: string | number;
	readonly typename: string | undefined;
}

/**
 * Given a Path and a key, return a new Path containing the new key.
 */
export function addPath(
	prev: Readonly<Path> | undefined,
	key: string | number,
	typename: string | undefined,
): Path {
	return { prev, key, typename };
}

/**
 * Given a Path, return an Array of the path keys.
 */
export function pathToArray(
	path: Maybe<Readonly<Path>>,
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
 * Given a selectionSet, collects all of the fields and returns them.
 *
 * CollectFields requires the "runtime type" of an object. For a field that
 * returns an Interface or Union type, the "runtime type" will be the actual
 * object type returned by that field.
 *
 * @internal
 */
export function collectFields(
	schema: GraphQLSchema,
	fragments: ObjMap<FragmentDefinitionNode>,
	variableValues: { [variable: string]: unknown },
	runtimeType: GraphQLObjectType,
	selectionSet: SelectionSetNode,
): Map<string, ReadonlyArray<FieldNode>> {
	const fields = new Map();
	collectFieldsImpl(
		schema,
		fragments,
		variableValues,
		runtimeType,
		selectionSet,
		fields,
		new Set(),
	);
	return fields;
}

function collectFieldsImpl(
	schema: GraphQLSchema,
	fragments: ObjMap<FragmentDefinitionNode>,
	variableValues: { [variable: string]: unknown },
	runtimeType: GraphQLObjectType,
	selectionSet: SelectionSetNode,
	fields: Map<string, Array<FieldNode>>,
	visitedFragmentNames: Set<string>,
): void {
	for (const selection of selectionSet.selections) {
		switch (selection.kind) {
			case Kind.FIELD: {
				if (!shouldIncludeNode(variableValues, selection)) {
					continue;
				}
				const name = getFieldEntryKey(selection);
				const fieldList = fields.get(name);
				if (fieldList !== undefined) {
					fieldList.push(selection);
				} else {
					fields.set(name, [selection]);
				}
				break;
			}
			case Kind.INLINE_FRAGMENT: {
				if (
					!shouldIncludeNode(variableValues, selection) ||
					!doesFragmentConditionMatch(schema, selection, runtimeType)
				) {
					continue;
				}
				collectFieldsImpl(
					schema,
					fragments,
					variableValues,
					runtimeType,
					selection.selectionSet,
					fields,
					visitedFragmentNames,
				);
				break;
			}
			case Kind.FRAGMENT_SPREAD: {
				const fragName = selection.name.value;
				if (
					visitedFragmentNames.has(fragName) ||
					!shouldIncludeNode(variableValues, selection)
				) {
					continue;
				}
				visitedFragmentNames.add(fragName);
				const fragment = fragments[fragName];
				if (
					!fragment ||
					!doesFragmentConditionMatch(schema, fragment, runtimeType)
				) {
					continue;
				}
				collectFieldsImpl(
					schema,
					fragments,
					variableValues,
					runtimeType,
					fragment.selectionSet,
					fields,
					visitedFragmentNames,
				);
				break;
			}
		}
	}
}

/**
 * Determines if a field should be included based on the `@include` and `@skip`
 * directives, where `@skip` has higher precedence than `@include`.
 */
function shouldIncludeNode(
	variableValues: { [variable: string]: unknown },
	node: FragmentSpreadNode | FieldNode | InlineFragmentNode,
): boolean {
	const skip = getDirectiveValues(GraphQLSkipDirective, node, variableValues);
	if (skip?.if === true) {
		return false;
	}

	const include = getDirectiveValues(
		GraphQLIncludeDirective,
		node,
		variableValues,
	);
	if (include?.if === false) {
		return false;
	}
	return true;
}

/**
 * Determines if a fragment is applicable to the given type.
 */
function doesFragmentConditionMatch(
	schema: GraphQLSchema,
	fragment: FragmentDefinitionNode | InlineFragmentNode,
	type: GraphQLObjectType,
): boolean {
	const typeConditionNode = fragment.typeCondition;
	if (!typeConditionNode) {
		return true;
	}
	const conditionalType = typeFromAST(schema, typeConditionNode);
	if (conditionalType === type) {
		return true;
	}
	if (isAbstractType(conditionalType)) {
		return schema.isSubType(conditionalType, type);
	}
	return false;
}

/**
 * Implements the logic to compute the key of a given field's entry
 */
function getFieldEntryKey(node: FieldNode): string {
	return node.alias ? node.alias.value : node.name.value;
}
