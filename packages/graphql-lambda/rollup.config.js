import { defineConfig } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { dts } from 'rollup-plugin-dts';

const externalDeps = [
	'@aws-sdk/client-apigatewaymanagementapi',
	'@types/aws-lambda',
	'graphql',
	'graphql/execution/execute',
	'graphql/execution/collectFields',
	'graphql/jsutils/Path',
	'graphql-http',
	'graphql-ws',
	'redis',
];

const jsPlugins = [
	nodeResolve({ extensions: ['.js', '.ts'] }),
	commonjs(),
	typescript({
		tsconfig: './tsconfig.json',
		declaration: false,
		exclude: ['**/*.d.ts', '**/*.test.ts', '**/*.spec.ts'],
		compilerOptions: {
			declaration: false,
			emitDeclarationOnly: false,
		},
	}),
];

const onwarn = (warning, warn) => {
	if (warning.code === 'UNUSED_EXTERNAL_IMPORT') {
		return;
	}

	warn(warning);
};

export default defineConfig([
	{
		input: 'src/index.ts',
		output: {
			file: 'dist/index.esm.js',
			format: 'esm',
			sourcemap: true,
		},
		plugins: jsPlugins,
		external: externalDeps,
		onwarn,
	},
	{
		input: 'src/index.ts',
		output: {
			file: 'dist/index.cjs.js',
			format: 'cjs',
			sourcemap: true,
		},
		plugins: jsPlugins,
		external: externalDeps,
		onwarn,
	},
	{
		input: 'src/index.ts',
		output: {
			file: 'dist/index.d.ts',
			format: 'esm',
		},
		plugins: [dts()],
		external: externalDeps,
	},
]);
