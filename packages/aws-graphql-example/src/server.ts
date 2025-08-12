import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import morgan from 'morgan';
import finalhandler from 'finalhandler';
import chalk from 'chalk';
import { createHandler } from 'graphql-http/lib/use/http';

import { schema } from './graphql';
import { cors } from './utils';
import { useServer } from 'graphql-ws/use/ws';

const logger = morgan('tiny');

const graphqlHandler = createHandler({ schema });

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

useServer({ schema }, wss);

const port = process.env.PORT || 4000;

server.listen(port, () => {
	console.log(` \
		\n${chalk.bold.green(`🚀 Server is running!`)} \ 
		\n${chalk.gray('> GraphQL:')} ${chalk.cyan.underline(`http://localhost:${port}/graphql`)} \
		\n${chalk.gray('> WebSocket:')} ${chalk.cyan.underline(`ws://localhost:${port}/graphql`)}
	`);
});
