/*
 * El sidecar .uml.json: lo que es del diagrama y no del codigo (titulo, notas de
 * una interfaz que no existe como nodo, relaciones extra, diccionario de tipos).
 *
 * Es el mismo archivo para las dos herramientas: describe el modelo, no el
 * formato de salida.
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { messagesFor } from './i18n.mjs'

/** Lo que este modulo le dice al usuario. Mismas claves en los dos idiomas. */
const MESSAGES = {
	en: {
		configNotFound: (path) => `I couldn't find the configuration file ${path}`,
	},
	es: {
		configNotFound: (path) => `No encontre el archivo de configuracion ${path}`,
	},
}

const withoutExtension = (path) => path.replace(/\.[^./\\]+$/, '')

/** @param options.language  uno de LANGUAGES: el idioma de los errores propios */
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
	if (options.config) throw new Error(messagesFor(MESSAGES, options.language).configNotFound(options.config))
	return {}
}
