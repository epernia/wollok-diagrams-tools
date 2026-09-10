/*
 * El sidecar .uml.json: lo que es del diagrama y no del codigo (titulo, notas de
 * una interfaz que no existe como nodo, relaciones extra, diccionario de tipos).
 *
 * Es el mismo archivo para las dos herramientas: describe el modelo, no el
 * formato de salida.
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const withoutExtension = (path) => path.replace(/\.[^./\\]+$/, '')

export const loadConfig = async (options) => {
	const candidates = options.config
		? [options.config]
		: [
			options.output && `${withoutExtension(options.output)}.uml.json`,
			options.sources[0]?.endsWith('.wlk') && `${withoutExtension(options.sources[0])}.uml.json`,
		].filter(Boolean)

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return { ...JSON.parse(await readFile(candidate, 'utf8')), configFile: candidate }
		}
	}
	if (options.config) throw new Error(`No encontre el archivo de configuracion ${options.config}`)
	return {}
}
