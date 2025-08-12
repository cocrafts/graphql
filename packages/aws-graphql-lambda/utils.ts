import type { APIGatewayProxyEventBase } from 'aws-lambda';

export const isAWSBaseEvent = (
	event: any,
): event is APIGatewayProxyEventBase<any> => {
	if ('multiValueHeaders' in event) return true;
	return false;
};

export const storageKey = {
	context: (connectionId: string) => {
		return `AWSWebsocketGraphQL:${connectionId}:context`;
	},
};
