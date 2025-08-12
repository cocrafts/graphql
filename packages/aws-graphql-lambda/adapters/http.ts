import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyHandlerV2,
	Context,
} from 'aws-lambda';
import { createHandler, type Request } from 'graphql-http';

import type { HttpAdapterOptions } from '../interface';

export function AWSGraphQLHttpAdapter({
	...handlerOptions
}: HttpAdapterOptions): APIGatewayProxyHandlerV2 {
	const handle = createHandler<APIGatewayProxyEventV2, Context>(handlerOptions);

	return async (event, context) => {
		try {
			const [body, init] = await handle(toRequest(event, context));

			return {
				statusCode: init.status,
				headers: init.headers,
				body: body ?? undefined,
			};
		} catch (error) {
			console.error('Internal error occurred during request handling.', error);
			return { statusCode: 500 };
		}
	};
}

function toRequest(
	event: APIGatewayProxyEventV2,
	context: Context,
): Request<APIGatewayProxyEventV2, Context> {
	return {
		method: event.requestContext.http.method,
		url: event.requestContext.http.path,
		headers: event.headers,
		body: event.body ?? null,
		raw: event,
		context,
	};
}
