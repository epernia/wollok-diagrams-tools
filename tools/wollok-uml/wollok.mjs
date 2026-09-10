/*
 * De donde sacamos wollok-ts.
 *
 * OJO: no conviene instalar wollok-ts dentro de un proyecto Wollok. El comando
 * `wollok test` busca los fuentes con el glob **\/*.wlk sobre todo el proyecto,
 * asi que se traga los .wlk de la libreria que quedan en node_modules y falla.
 * Por eso lo primero que se intenta es un import normal (util si estas
 * herramientas viven en su propio repo) y, si no esta, se usa el wollok-ts que
 * ya viene adentro del wollok-ts-cli instalado globalmente.
 *
 * Es tambien la razon por la que ninguna de las dos herramientas usa librerias
 * de terceros: ni para el layout ni para leer XML.
 */

import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

export const importWollokTs = async () => {
	try {
		return await import('wollok-ts')
	} catch { /* no esta instalado localmente: lo buscamos en el global */ }

	const wollokTsIn = (root) => [
		join(root, 'wollok-ts', 'dist', 'index.js'),
		join(root, 'wollok-ts-cli', 'node_modules', 'wollok-ts', 'dist', 'index.js'),
	].find(existsSync)

	const globalRoots = [
		process.env.APPDATA && join(process.env.APPDATA, 'npm', 'node_modules'),
		join(dirname(process.execPath), 'node_modules'),
		'/usr/local/lib/node_modules',
		'/usr/lib/node_modules',
	].filter(Boolean)

	for (const root of globalRoots) {
		const path = wollokTsIn(root)
		if (path) return import(pathToFileURL(path).href)
	}

	// ultimo recurso: preguntarle a npm donde instala lo global
	try {
		const path = wollokTsIn(execSync('npm root -g', { encoding: 'utf8' }).trim())
		if (path) return import(pathToFileURL(path).href)
	} catch { /* npm no disponible */ }

	throw new Error(
		'No encontre wollok-ts. Instala el CLI de Wollok (npm i -g wollok-ts-cli),\n' +
		'o instala wollok-ts local SOLO si estas herramientas viven fuera de un proyecto Wollok.'
	)
}
