#!/usr/bin/env node
/*
 * wollokdd2drawio — genera un DIAGRAMA DE OBJETOS en formato draw.io a partir de un
 * modelo Wollok (.wlk) y un ejemplo ejecutable (.wrepl).
 *
 *   node tools/wollokdd2drawio/cli.mjs ejercicio1
 *   node tools/wollokdd2drawio/cli.mjs modelo.wlk ejemplo.wrepl -o diagrama.drawio
 *
 * Con UN solo parámetro se lo toma como nombre base: busca <base>.wlk y
 * <base>.wrepl y escribe <base>_dynamic.drawio. Si el parámetro es una carpeta,
 * busca adentro el .wlk y el .wrepl.
 *
 * Con dos o más, el .wrepl se reconoce por su extensión y el orden no importa.
 *
 * El .wrepl es OPCIONAL: sin ejemplo que ejecutar, el diagrama muestra el ambiente
 * tal como queda al cargar el modelo, o sea solamente sus WKO.
 *
 * A diferencia del diagrama de clases, este no se puede sacar leyendo el código:
 * hay que EJECUTARLO. El .wrepl se corre línea por línea con el mismo intérprete
 * que usa el REPL de Wollok, y después se camina el grafo de objetos que quedó
 * vivo en el ambiente.
 *
 * Qué dibuja:
 *   - un rectángulo "Ambiente" con todos los objetos adentro, como elipses;
 *   - las var y const de cada objeto, como flechas salientes con su nombre
 *     (const en rojo, var en verde);
 *   - las referencias globales del .wrepl, como texto fuera del ambiente con una
 *     flecha que entra y pincha al objeto;
 *   - los WKO como un círculo que dice "WKO", con su nombre como referencia
 *     global constante;
 *   - los elementos de una List numerados 0, 1, 2...;
 *   - un color por familia polimórfica.
 *
 * Con --genseq no genera una sola foto sino la SECUENCIA: un archivo con una
 * página por cada línea del .wrepl, y al pie del ambiente la línea que se
 * ejecutó. Las líneas que no cambian el diagrama no abren página nueva: se
 * suman al pie del dibujo que no modificaron.
 *
 * Opciones:
 *   -o, --output <archivo>   .drawio de salida (por defecto: <base>_dynamic.drawio,
 *                            o <base>_dynamic_seq.drawio con --genseq)
 *       --genseq             generar la secuencia paso a paso
 *   -t, --title <texto>      nombre de la pestaña del diagrama
 *       --feminine <A,B>     clases que llevan "una" (por defecto se deduce del nombre)
 *       --masculine <A,B>    clases que llevan "un"
 *       --relayout           ignorar las posiciones del archivo anterior
 *       --keep-going         seguir aunque alguna línea del .wrepl falle
 *   -q, --quiet              no mostrar advertencias
 */

import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { readSources } from '../wollok-uml/sources.mjs'
import { readGeometry } from '../wollok-uml/drawio-merge.mjs'
import { run, buildObjectModel, createIdentityRegistry } from '../wollok-uml/objects.mjs'
import { loadConfig } from '../wollok-uml/config.mjs'
import { extractModel } from '../wollok-uml/extract.mjs'
import { colorIndexOf } from '../wollok-uml/families.mjs'
import { renderObjectDiagram, renderSequence } from './render.mjs'
import { groupSteps } from './sequence.mjs'
import { familyCountOf } from './colors.mjs'

const SUFFIX = '_dynamic'
const SEQUENCE_SUFFIX = '_dynamic_seq'

const parseArguments = (argv) => {
	const options = { positional: [], feminine: [], masculine: [] }
	for (let i = 0; i < argv.length; i++) {
		switch (argv[i]) {
			case '-o': case '--output': options.output = argv[++i]; break
			case '-t': case '--title': options.title = argv[++i]; break
			case '--feminine': options.feminine = argv[++i].split(',').map((name) => name.trim()); break
			case '--masculine': options.masculine = argv[++i].split(',').map((name) => name.trim()); break
			case '--genseq': options.sequence = true; break
			case '--relayout': options.relayout = true; break
			case '--keep-going': options.keepGoing = true; break
			case '-q': case '--quiet': options.quiet = true; break
			case '-h': case '--help': options.help = true; break
			default: options.positional.push(argv[i])
		}
	}
	return options
}

const printHelp = async () => {
	const text = await readFile(new URL(import.meta.url), 'utf8')
	console.log(text.split('*/')[0].replace(/^#!.*\n/, '').replace(/^\/\*\n?/, '').replace(/^ \* ?/gm, ''))
}

const isDirectory = async (path) => {
	try { return (await stat(path)).isDirectory() } catch { return false }
}

/**
 * Una carpeta: adentro tiene que haber al menos un .wlk. El .wrepl es opcional.
 */
const fromFolder = async (folder) => {
	const entries = await readdir(folder)
	const repls = entries.filter((entry) => extname(entry) === '.wrepl')
	const models = entries.filter((entry) => extname(entry) === '.wlk')

	if (!models.length) throw new Error(`No hay ningún .wlk en la carpeta ${folder}`)
	if (repls.length > 1) throw new Error(`Hay ${repls.length} archivos .wrepl en ${folder}: pasame cuál querés (${repls.join(', ')})`)

	return {
		replPath: repls.length ? join(folder, repls[0]) : undefined,
		modelPaths: models.map((model) => join(folder, model)),
		base: join(folder, basename(resolve(folder))),
	}
}

/** Un nombre base: ejercicio1 -> ejercicio1.wlk + ejercicio1.wrepl (si existe) */
const fromBaseName = async (base) => {
	if (await isDirectory(base)) return fromFolder(base)

	const model = `${base}.wlk`
	if (!existsSync(model)) {
		throw new Error(
			`Con un solo parámetro busco <nombre>.wlk, y no encontré ${model}\n` +
			'Si los archivos se llaman distinto, pasamelos: cli.mjs modelo.wlk [ejemplo.wrepl]'
		)
	}
	const repl = `${base}.wrepl`
	return { replPath: existsSync(repl) ? repl : undefined, modelPaths: [model], base }
}

/** De los argumentos posicionales a los archivos concretos. */
const resolveInputs = async (positional) => {
	const looksLikeBaseName = positional.length === 1 && !['.wlk', '.wrepl'].includes(extname(positional[0]))
	if (looksLikeBaseName) return fromBaseName(positional[0])

	const replPath = positional.find((path) => extname(path) === '.wrepl')
	const modelPaths = positional.filter((path) => path !== replPath)
	if (!modelPaths.length) throw new Error('Falta el archivo .wlk con el modelo')
	return {
		replPath,
		modelPaths,
		base: replPath ? replPath.slice(0, -'.wrepl'.length) : modelPaths[0].slice(0, -'.wlk'.length),
	}
}

/**
 * Los nombres de archivo que ve wollok-ts definen los paquetes, así que se los
 * hace relativos a la carpeta que los contiene y no al cwd: si no, un modelo que
 * vive fuera del proyecto quedaría en un paquete llamado "...".
 */
const withPackageNames = (files, modelPaths) => {
	const base = dirname(resolve(modelPaths[0]))
	return files.map((file) => ({
		...file,
		name: relative(base, resolve(file.name)).split(sep).join('/'),
	}))
}

const main = async () => {
	const options = parseArguments(process.argv.slice(2))

	if (options.help || !options.positional.length) {
		await printHelp()
		process.exit(options.help ? 0 : 1)
	}

	const { replPath, modelPaths, base } = await resolveInputs(options.positional)

	const files = withPackageNames(await readSources(modelPaths), modelPaths)
	// Sin ejemplo el diagrama se genera igual: muestra el ambiente recién cargado,
	// o sea los WKO del modelo y lo que cuelgue de ellos.
	const replSource = replPath ? await readFile(replPath, 'utf8') : ''

	// el .wlk que le da nombre al paquete del REPL: el que se llama igual que el
	// .wrepl si existe, y si no el primero
	const twin = replPath && `${basename(replPath, '.wrepl')}.wlk`
	const mainFile = files.find((file) => basename(file.name) === twin)?.name ?? files[0].name

	// Con --genseq hace falta una foto del ambiente despues de cada linea, no solo
	// al final: se saca desde los callbacks de run(). El registro de identidades
	// hace que un mismo objeto conserve su id entre foto y foto.
	const genders = { feminine: options.feminine, masculine: options.masculine }
	const registry = createIdentityRegistry()
	const snapshot = (session) => buildObjectModel(session, { ...genders, registry })

	let initialModel
	const steps = []
	const session = await run(files, replSource, {
		mainFile,
		...(options.sequence ? {
			onStart: (session) => { initialModel = snapshot(session) },
			afterEach: (sentence, session, error) => steps.push({ sentence, error, model: snapshot(session) }),
		} : {}),
	})

	if (session.errors.length) {
		console.error(`\n${session.errors.length} línea(s) del .wrepl fallaron al ejecutarse:`)
		for (const error of session.errors) console.error(`  ✗ ${error.text}\n      ${error.message}`)
		if (!options.keepGoing) {
			console.error('\nEl diagrama saldría incompleto. Corregí el ejemplo, o usá --keep-going para generarlo igual.')
			process.exit(1)
		}
		console.error('')
	}

	const model = options.sequence ? steps[steps.length - 1]?.model ?? initialModel : snapshot(session)
	const pages = options.sequence ? groupSteps(initialModel, steps) : undefined

	const output = options.output ?? `${base}${options.sequence ? SEQUENCE_SUFFIX : SUFFIX}.drawio`
	const previousGeometry = !options.relayout && existsSync(output)
		? readGeometry(await readFile(output, 'utf8'))
		: new Map()

	// El color de cada familia lo decide el modelo ESTÁTICO, el mismo que usa el
	// diagrama de clases, para que una familia salga del mismo color en los dos.
	// Se lee también el sidecar, porque su diccionario de tipos puede cambiar qué
	// entidades terminan siendo polimórficas entre sí.
	const colorIndex = colorIndexOf(extractModel(session.environment, await loadConfig({ sources: modelPaths })))

	const settings = {
		name: options.title ?? `${basename(base)} — Diagrama de objetos`,
		previousGeometry,
		colorIndex,
		header: [
			`Generado por tools/wollokdd2drawio a partir de: ${files.map((f) => f.name).join(', ')}`
				+ (replPath ? ` + ${basename(replPath)}` : ' (sin .wrepl: solo los WKO del modelo)'),
			'No editar a mano: volver a generarlo.',
		],
	}
	const diagram = pages ? renderSequence(pages, settings) : renderObjectDiagram(model, settings)

	await writeFile(output, diagram, 'utf8')
	const resumen = `${model.objects.length} objetos, ${model.references.length} referencias, ${model.globals.length} globales, ${familyCountOf(model)} familias polimórficas`
	console.log(pages
		? `✓ ${output}  (${pages.length} páginas para ${steps.length} líneas · al final: ${resumen})`
		: `✓ ${output}  (${resumen})`)
	if (previousGeometry.size && !options.quiet) {
		console.log(`   (conservé la posición de ${previousGeometry.size} elemento(s) del archivo anterior)`)
	}

	if (!replPath && !options.quiet) {
		console.log('   (no hay .wrepl: el diagrama muestra solo los WKO del modelo)')
	}

	if (!options.quiet && model.warnings.length) {
		console.error(`\n${model.warnings.length} advertencia(s):`)
		for (const warning of model.warnings) console.error(`  - ${warning}`)
	}
}

main().catch((error) => {
	console.error(error.message)
	process.exit(1)
})
