/*
 * El armado comun a las dos herramientas: leer argumentos, leer fuentes,
 * construir el entorno de Wollok, cargar el sidecar y extraer el modelo UML.
 *
 * Lo unico que cambia entre wolloksd2puml y wolloksd2drawio es el `render`.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { relative, sep } from 'node:path'
import { readSources } from './sources.mjs'
import { loadConfig } from './config.mjs'
import { importWollokTs } from './wollok.mjs'
import { extractModel } from './extract.mjs'

/** Opciones que entienden las dos herramientas. */
const COMMON_OPTIONS = {
	'-o': (o, v) => { o.output = v() },
	'--output': (o, v) => { o.output = v() },
	'-c': (o, v) => { o.config = v() },
	'--config': (o, v) => { o.config = v() },
	'-t': (o, v) => { o.title = v() },
	'--title': (o, v) => { o.title = v() },
	'--associations': (o, v) => { o.associations = v() },
	'--no-attributes': (o) => { o.showAttributes = false },
	'--no-operations': (o) => { o.showOperations = false },
	'--no-mutability': (o) => { o.showMutability = false },
	// Apaga TODA la inferencia de familias polimorficas: ni interfaces deducidas
	// ni color por familia. Es la valvula de escape por si en algun modelo la
	// heuristica agrupa cosas que no van juntas.
	'--without-inference': (o) => { o.showFamilies = false },
	'--include-tests': (o) => { o.includeTests = true },
	'-q': (o) => { o.quiet = true },
	'--quiet': (o) => { o.quiet = true },
	'-h': (o) => { o.help = true },
	'--help': (o) => { o.help = true },
}

export const parseArguments = (argv, extraOptions = {}) => {
	const handlers = { ...COMMON_OPTIONS, ...extraOptions }
	const options = {
		sources: [],
		associations: 'both',
		showAttributes: true,
		showOperations: true,
		showMutability: true,
		includeTests: false,
		quiet: false,
	}
	for (let i = 0; i < argv.length; i++) {
		const handler = handlers[argv[i]]
		if (handler) handler(options, () => argv[++i])
		else options.sources.push(argv[i])
	}
	return options
}

/** La ayuda es el comentario de cabecera del cli.mjs de cada herramienta. */
const printHelp = async (helpFrom) => {
	const text = await readFile(new URL(helpFrom), 'utf8')
	console.log(text.split('*/')[0].replace(/^#!.*\n/, '').replace(/^\/\*\n?/, '').replace(/^ \* ?/gm, ''))
}

/**
 * @param render  ({ model, config, options, files }) => string
 */
export const runGenerator = async ({ helpFrom, extraOptions, render }) => {
	const options = parseArguments(process.argv.slice(2), extraOptions)

	if (options.help || !options.sources.length) {
		await printHelp(helpFrom)
		process.exit(options.help ? 0 : 1)
	}

	const files = await readSources(options.sources, options.includeTests)
	const { buildEnvironment } = await importWollokTs()
	const environment = buildEnvironment(files)
	const config = await loadConfig(options)
	const model = extractModel(environment, config, { deriveInterfaces: options.showFamilies !== false })

	// Conviene decir cuales son las que NO escribiste vos: si te gustan, el paso
	// siguiente es declararlas con @UmlImplements y dejarlas de tu lado.
	const derived = model.interfaces.filter((entity) => entity.derived)
	if (derived.length && !options.quiet) {
		console.log(`   ${derived.length} interfaz(ces) deducida(s) de las familias polimorficas: ${derived.map((entity) => entity.name).join(', ')}`)
	}

	const output = await render({ model, config, options, files })

	if (options.output) {
		await writeFile(options.output, output, 'utf8')
		console.log(`✓ ${options.output}  (${model.entities.length} entidades, ${model.interfaces.length} interfaces, ${model.relations.length} relaciones)`)
	} else {
		process.stdout.write(output)
	}

	if (!options.quiet && model.warnings.length) {
		console.error(`\n${model.warnings.length} cosa(s) que no pude deducir del codigo:`)
		for (const warning of model.warnings) console.error(`  - ${warning}`)
	}
}

/*
 * Igual que en sources.mjs: en la cabecera van rutas relativas y con barras
 * normales, para que el archivo generado sea el mismo se lo invoque con la ruta
 * relativa (npm run uml) o con la absoluta (el boton de VSCode).
 */
const asRelativePath = (path) => relative(process.cwd(), path).split(sep).join('/')

/** Las lineas de "generado por" que las dos herramientas ponen de cabecera. */
export const provenanceOf = (toolName, files, config) => [
	`Generado por tools/${toolName} a partir de: ${files.map((f) => f.name).join(', ')}`,
	'No editar a mano: volver a generarlo.',
	...(config.configFile ? [`Configuracion: ${asRelativePath(config.configFile)}`] : []),
]
