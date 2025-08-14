/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
	app(input) {
		return {
			name: 'aws-graphql-example',
			removal: 'remove',
			home: 'aws',
			providers: {
				aws: {
					region: 'ap-southeast-1',
				},
			},
		};
	},
	async run() {
		const vpc = new sst.aws.Vpc('default', { nat: 'managed' });
		const redis = new sst.aws.Redis('redis', { vpc, cluster: false });
		const api = new sst.aws.ApiGatewayV2('http');
		const ws = new sst.aws.ApiGatewayWebSocket('ws');

		const shared = new sst.Linkable('shared', {
			properties: { region: 'ap-southeast-1' },
		});

		const httpHandler = new sst.aws.Function('graphql-http', {
			handler: 'src/lambda/http.handler',
			vpc,
			link: [redis, ws, shared],
			permissions: [
				{
					actions: ['execute-api:Invoke', 'execute-api:ManageConnections'],
					resources: [ws.nodes.api.executionArn.apply(t => `${t}/**/*`)],
				},
			],
		});

		const wsHandler = new sst.aws.Function('graphql-ws', {
			handler: 'src/lambda/ws.handler',
			vpc,
			link: [redis, ws, shared],
			permissions: [
				{
					actions: ['execute-api:Invoke', 'execute-api:ManageConnections'],
					resources: [ws.nodes.api.executionArn.apply(t => `${t}/**/*`)],
				},
			],
		});

		api.route('GET /graphql', httpHandler.arn);
		api.route('POST /graphql', httpHandler.arn);

		ws.route('$connect', wsHandler.arn);
		ws.route('$disconnect', wsHandler.arn);
		ws.route('$default', wsHandler.arn);
	},
});
