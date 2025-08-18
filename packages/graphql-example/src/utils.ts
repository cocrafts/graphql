import chalk from 'chalk';
import type { GraphQLResolveInfo } from 'graphql';
import http from 'http';
import { inspect } from 'util';

const corsOrigin = process.env.CORS_ORIGIN ?? '*';
const corsMethods = process.env.CORS_METHODS ?? '*';
const corsHeaders = process.env.CORS_HEADERS ?? '*';
const corsMaxAge = process.env.CORS_MAX_AGE ?? 2592000;

export function cors(req: http.IncomingMessage, res: http.ServerResponse) {
	res.setHeader('Access-Control-Allow-Origin', corsOrigin);
	res.setHeader('Access-Control-Allow-Methods', corsMethods);
	res.setHeader('Access-Control-Allow-Headers', corsHeaders);
	res.setHeader('Access-Control-Max-Age', corsMaxAge);

	return true;
}

export function logOperation(
	obj: any,
	args: any,
	ctx: any,
	info: GraphQLResolveInfo,
) {
	console.log(
		chalk.gray(`${info.operation.operation} ${info.fieldName} \
			\n - obj: ${inspect(obj)} \
			\n - args: ${inspect(args)} \
			\n - ctx: ${inspect(ctx)}`),
	);
}

export function randomIndex() {
	return Math.round(Math.random() * 100);
}
