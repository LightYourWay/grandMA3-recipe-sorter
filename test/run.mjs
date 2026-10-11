// @ts-check

// Runs test/tests.lua in a real Lua 5.4 (wasmoon) against the built plugin and the
// mocked grandMA3 API in test/mock_ma.lua. Run `npm run build` first.

import { readFile } from 'node:fs/promises';
import { LuaFactory } from 'wasmoon';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const read = (file) => readFile(new URL(file, import.meta.url), 'utf8');

const lua = await new LuaFactory().createEngine();
try {
	lua.global.set('PLUGIN_SOURCE', await read(`../dist/${pkg.name}.lua`));
	lua.global.set('MOCK_SOURCE', await read('./mock_ma.lua'));
	// Lua tables don't survive a round trip through JS, so the mock is loaded inside Lua
	await lua.doString("MA = assert(load(MOCK_SOURCE, '@mock_ma.lua'))()");
	const failures = await lua.doString(await read('./tests.lua'));
	process.exitCode = failures === 0 ? 0 : 1;
} finally {
	lua.global.close();
}
