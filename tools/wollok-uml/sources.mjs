/* Busqueda y lectura de los fuentes Wollok. */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, extname, relative, sep } from 'node:path'

const SOURCE_EXTENSIONS = ['.wlk']
const TEST_EXTENSIONS = ['.wtest', '.wpgm']

/** Archivos Wollok de una ruta, que puede ser un archivo o una carpeta. */
const wollokFilesIn = async (path, extensions) => {
	const info = await stat(path)
	if (info.isFile()) return extensions.includes(extname(path)) ? [path] : []
	const entries = await readdir(path, { withFileTypes: true })
	const files = await Promise.all(entries.map((entry) =>
		wollokFilesIn(join(path, entry.name), extensions)
	))
	return files.flat()
}

/** [{ name, content }] listo para buildEnvironment. */
export const readSources = async (sources, includeTests = false) => {
	const extensions = includeTests ? [...SOURCE_EXTENSIONS, ...TEST_EXTENSIONS] : SOURCE_EXTENSIONS
	const paths = (await Promise.all(sources.map((source) => wollokFilesIn(source, extensions)))).flat()
	if (!paths.length) throw new Error(`No encontre archivos Wollok en: ${sources.join(', ')}`)

	return Promise.all(paths.map(async (path) => ({
		name: relative(process.cwd(), path).split(sep).join('/'),
		content: await readFile(path, 'utf8'),
	})))
}
