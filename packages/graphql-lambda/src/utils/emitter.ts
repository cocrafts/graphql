import {
	MessageType,
	stringifyMessage,
	type ExecutionResult,
	type ServerOptions,
	type SubscribeMessage,
} from 'graphql-ws';
import type { Socket } from '../interface';
import type { ExecutionArgs, GraphQLError } from 'graphql';

export const createSubscriptionEmitter = (
	options: ServerOptions,
	socket: Socket,
) => {
	const next = async (
		result: ExecutionResult,
		{ id, payload }: SubscribeMessage,
		args: ExecutionArgs,
	) => {
		const { errors, ...resultWithoutErrors } = result;

		const ctx = await socket.context();
		const maybeResult = await options.onNext?.(ctx, id, payload, args, result);

		await socket.send(
			stringifyMessage<MessageType.Next>(
				{
					id,
					type: MessageType.Next,
					payload: maybeResult || {
						...resultWithoutErrors,
						// omit errors completely if not defined
						...(errors ? { errors: errors.map(e => e.toJSON()) } : {}),
					},
				},
				options.jsonMessageReplacer,
			),
		);
	};

	const error = async (
		errors: readonly GraphQLError[],
		{ id, payload }: SubscribeMessage,
	) => {
		const ctx = await socket.context();
		const maybeErrors = await options.onError?.(ctx, id, payload, errors);

		await socket.send(
			stringifyMessage<MessageType.Error>(
				{
					id,
					type: MessageType.Error,
					payload: maybeErrors || errors.map(e => e.toJSON()),
				},
				options.jsonMessageReplacer,
			),
		);
	};

	/**
	 * This complete function is supposed to be called if:
	 * - the subscription execution return single object
	 * - the async iterator of execution return done
	 *
	 * How about called when disconnect???
	 */
	const complete = async (
		notifyClient: boolean,
		{ id, payload }: SubscribeMessage,
	) => {
		const ctx = await socket.context();
		await options.onComplete?.(ctx, id, payload);

		if (notifyClient) {
			await socket.send(
				stringifyMessage<MessageType.Complete>(
					{ id, type: MessageType.Complete },
					options.jsonMessageReplacer,
				),
			);
		}
	};

	return { next, error, complete };
};
