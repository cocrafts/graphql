import {
	getArgumentValues,
	GraphQLError,
	locatedError,
	type DocumentNode,
	type ExecutionArgs,
} from 'graphql';
import {
	buildExecutionContext,
	buildResolveInfo,
	getFieldDef,
	type ExecutionContext,
} from 'graphql/execution/execute';
import { collectFields } from 'graphql/execution/collectFields';
import { addPath, pathToArray } from 'graphql/jsutils/Path';

/**
 * A custom version of the `subscribe` function from the `graphql` package.
 * This function only processes the arguments and runs the subscription resolver's subscribe method,
 * without checking the event stream or re-executing to validate the data from the stream.
 *
 * Event streaming is not available in serverless runtimes.
 * The data flow is handled by a custom pubsub engine.
 */
export async function customSubscribe(...rawArgs: BackwardsCompatibleArgs) {
	const args = toNormalizedArgs(rawArgs);
	const exeContext = buildExecutionContext(args);

	if (!('schema' in exeContext)) return { errors: exeContext };

	try {
		return await executeSubscription(exeContext);
	} catch (error) {
		if (error instanceof GraphQLError) return { errors: [error] };
		throw error;
	}
}

async function executeSubscription(
	exeContext: ExecutionContext,
): Promise<unknown> {
	const { schema, fragments, operation, variableValues, rootValue } =
		exeContext;

	const rootType = schema.getSubscriptionType();
	if (rootType == null) {
		throw new GraphQLError(
			'Schema is not configured to execute subscription operation.',
			{ nodes: operation },
		);
	}

	const rootFields = collectFields(
		schema,
		fragments,
		variableValues,
		rootType,
		operation.selectionSet,
	);
	const [responseName, fieldNodes] = [...rootFields.entries()][0] as any;
	const fieldDef = getFieldDef(schema, rootType, fieldNodes[0]);

	if (!fieldDef) {
		const fieldName = fieldNodes[0].name.value;
		throw new GraphQLError(
			`The subscription field "${fieldName}" is not defined.`,
			{ nodes: fieldNodes },
		);
	}

	const path = addPath(undefined, responseName, rootType.name);
	const info = buildResolveInfo(
		exeContext,
		fieldDef,
		fieldNodes,
		rootType,
		path,
	);

	try {
		const args = getArgumentValues(fieldDef, fieldNodes[0], variableValues);
		const contextValue = exeContext.contextValue;
		const resolveFn = fieldDef.subscribe ?? exeContext.subscribeFieldResolver;

		return await resolveFn(rootValue, args, contextValue, info);
	} catch (error) {
		throw locatedError(error, fieldNodes, pathToArray(path));
	}
}

type BackwardsCompatibleArgs =
	| [options: ExecutionArgs]
	| [
			schema: ExecutionArgs['schema'],
			document: ExecutionArgs['document'],
			rootValue?: ExecutionArgs['rootValue'],
			contextValue?: ExecutionArgs['contextValue'],
			variableValues?: ExecutionArgs['variableValues'],
			operationName?: ExecutionArgs['operationName'],
			subscribeFieldResolver?: ExecutionArgs['subscribeFieldResolver'],
	  ];

function toNormalizedArgs(args: BackwardsCompatibleArgs): ExecutionArgs {
	const firstArg = args[0];
	if (firstArg && 'document' in firstArg) {
		return firstArg;
	}

	return {
		schema: firstArg,
		document: args[1] as DocumentNode,
		rootValue: args[2],
		contextValue: args[3],
		variableValues: args[4],
		operationName: args[5],
		subscribeFieldResolver: args[6],
	};
}
