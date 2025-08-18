import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import morgan from 'morgan';
import finalhandler from 'finalhandler';
import chalk from 'chalk';
import { createHandler } from 'graphql-http/lib/use/http';
import { useServer } from 'graphql-ws/use/ws';

import { graphqlHttpOptions, graphqlWsOptions, schema } from './graphql';
import { cors } from './utils';
import { setPubsub } from './pubsub';
import { DefaultGraphQLPubSub } from 'graphql-pubsub';

const logger = morgan('tiny');

const graphqlHandler = createHandler(graphqlHttpOptions);

const server = createServer((req, res) => {
	var done = finalhandler(req, res);
	logger(req, res, err => err && done(err));

	cors(req, res);
	if (req.method === 'OPTIONS') {
		res.writeHead(204).end();
		return false;
	}

	if (req.url?.startsWith('/graphql')) {
		graphqlHandler(req, res);
	}
});

const wss = new WebSocketServer({ server, path: '/graphql' });

useServer(graphqlWsOptions, wss);

setPubsub(new DefaultGraphQLPubSub());

const port = process.env.PORT || 4000;

server.listen(port, () => {
	console.log(` \
		\n${chalk.bold.green(`🚀 Server is running!`)} \ 
		\n${chalk.gray('➜ GraphQL:')} ${chalk.cyan.underline(`http://localhost:${port}/graphql`)} \
		\n${chalk.gray('➜ WebSocket:')} ${chalk.cyan.underline(`ws://localhost:${port}/graphql`)}
	`);
});
