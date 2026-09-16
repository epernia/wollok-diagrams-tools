#!/usr/bin/env node
/*
 * wollokdd2drawio — genera un DIAGRAMA DE OBJETOS en formato draw.io a partir de un
 * modelo Wollok (.wlk) y un ejemplo ejecutable (.wrepl), ejecutandolo.
 *
 *   node tools/wollokdd2drawio/cli.mjs ejercicio1
 *   node tools/wollokdd2drawio/cli.mjs modelo.wlk ejemplo.wrepl -o diagrama.drawio --genseq
 *
 * Las opciones y lo que dibuja estan en help.mjs (o con --help). Los mensajes
 * salen en ingles por defecto y en castellano con cualquiera de los --es...
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
import { DEFAULT_LANGUAGE, LANGUAGE_FLAGS, isLanguageFlag, messagesFor } from '../wollok-uml/i18n.mjs'
import { renderObjectDiagram, renderSequence } from './render.mjs'
import { groupSteps, captionLineOf } from './sequence.mjs'
import { textsFor } from './texts.mjs'
import { familyCountOf } from './colors.mjs'
import { HELP } from './help.mjs'

/** Lo que este modulo le dice al usuario. Mismas claves en los dos idiomas. */
const MESSAGES = {
	en: {
		renamedFlag: (flag, renamed) => `The option ${flag} is now called ${renamed}`,
		unknownFlag: (flag) => `I don't know the option ${flag} (try --help)`,
		noModelInFolder: (folder) => `There is no .wlk in the folder ${folder}`,
		severalRepls: (folder, repls) => `There are ${repls.length} .wrepl files in ${folder}: tell me which one you want (${repls.join(', ')})`,
		modelNotFound: (model) =>
			`With a single argument I look for <name>.wlk, and I couldn't find ${model}\n` +
			'If the files have different names, pass them to me: cli.mjs model.wlk [example.wrepl]',
		missingModel: 'The .wlk file with the model is missing',
		failedLines: (count) => `${count} .wrepl line(s) failed to run (they are marked in red at the bottom of the diagram):`,
		summary: (objects, references, globals, families) => `${objects} objects, ${references} references, ${globals} globals, ${families} polymorphic families`,
		sequenceSummary: (pages, lines, summary) => `${pages} pages for ${lines} lines · at the end: ${summary}`,
		keptPositions: (count) => `(I kept the position of ${count} element(s) from the previous file)`,
		withoutRepl: "(there is no .wrepl: the diagram only shows the model's WKOs)",
		unroutedArrows: (count) => `${count} arrow(s) I couldn't reroute:`,
		warnings: (count) => `${count} warning(s):`,
	},
	es: {
		renamedFlag: (flag, renamed) => `La opción ${flag} ahora se llama ${renamed}`,
		unknownFlag: (flag) => `No conozco la opción ${flag} (probá --help)`,
		noModelInFolder: (folder) => `No hay ningún .wlk en la carpeta ${folder}`,
		severalRepls: (folder, repls) => `Hay ${repls.length} archivos .wrepl en ${folder}: pasame cuál querés (${repls.join(', ')})`,
		modelNotFound: (model) =>
			`Con un solo parámetro busco <nombre>.wlk, y no encontré ${model}\n` +
			'Si los archivos se llaman distinto, pasamelos: cli.mjs modelo.wlk [ejemplo.wrepl]',
		missingModel: 'Falta el archivo .wlk con el modelo',
		failedLines: (count) => `${count} línea(s) del .wrepl fallaron al ejecutarse (quedan marcadas en rojo al pie del diagrama):`,
		summary: (objects, references, globals, families) => `${objects} objetos, ${references} referencias, ${globals} globales, ${families} familias polimórficas`,
		sequenceSummary: (pages, lines, summary) => `${pages} páginas para ${lines} líneas · al final: ${summary}`,
		keptPositions: (count) => `(conservé la posición de ${count} elemento(s) del archivo anterior)`,
		withoutRepl: '(no hay .wrepl: el diagrama muestra solo los WKO del modelo)',
		unroutedArrows: (count) => `${count} flecha(s) que no pude desviar:`,
		warnings: (count) => `${count} advertencia(s):`,
	},
}

const SUFFIX = '_dynamic'
const SEQUENCE_SUFFIX = '_dynamic_seq'

/** Los flags que cambiaron de nombre, para avisar cual es el nuevo. */
const RENAMED_FLAGS = {
	'--englang': '--enlang',
	'--engarticlelang': '--enarticlelang',
	'--inclusivelang': '--esinclusivelang',
	'--genderlang': '--esgenderlang',
}

const parseArguments = (argv) => {
	const options = { positional: [], unknown: [], feminine: [], masculine: [], language: DEFAULT_LANGUAGE }
	for (let i = 0; i < argv.length; i++) {
		switch (argv[i]) {
			case '-o': case '--output': options.output = argv[++i]; break
			case '-t': case '--title': options.title = argv[++i]; break
			case '--feminine': options.feminine = argv[++i].split(',').map((name) => name.trim()); break
			case '--masculine': options.masculine = argv[++i].split(',').map((name) => name.trim()); break
			case '--genseq': options.sequence = true; break
			case '--wkoshowref': options.showWkoRef = true; break
			case '--showenv': options.showEnv = true; break
			case '--hidepadlock': options.hidePadlock = true; break
			case '--refcolors': options.refColors = true; break
			// el ultimo que se pase es el que vale
			case '--pastelcolors': options.palette = 'pastel'; break
			case '--colourblind': options.palette = 'colourblind'; break
			case '--relayout': options.relayout = true; break
			case '--keep-going': options.keepGoing = true; break
			case '-q': case '--quiet': options.quiet = true; break
			case '-h': case '--help': options.help = true; break
			default:
				// los flags de idioma (--enlang, --eslang...): el ultimo que se pase es el que vale
				if (isLanguageFlag(argv[i])) options.language = LANGUAGE_FLAGS[argv[i]]
				// un archivo nunca empieza con guion: si empieza, es un flag mal escrito
				else if (argv[i].startsWith('-')) options.unknown.push(argv[i])
				else options.positional.push(argv[i])
		}
	}
	return options
}

const isDirectory = async (path) => {
	try { return (await stat(path)).isDirectory() } catch { return false }
}

/**
 * Una carpeta: adentro tiene que haber al menos un .wlk. El .wrepl es opcional.
 */
const fromFolder = async (folder, say) => {
	const entries = await readdir(folder)
	const repls = entries.filter((entry) => extname(entry) === '.wrepl')
	const models = entries.filter((entry) => extname(entry) === '.wlk')

	if (!models.length) throw new Error(say.noModelInFolder(folder))
	if (repls.length > 1) throw new Error(say.severalRepls(folder, repls))

	return {
		replPath: repls.length ? join(folder, repls[0]) : undefined,
		modelPaths: models.map((model) => join(folder, model)),
		base: join(folder, basename(resolve(folder))),
	}
}

/** Un nombre base: ejercicio1 -> ejercicio1.wlk + ejercicio1.wrepl (si existe) */
const fromBaseName = async (base, say) => {
	if (await isDirectory(base)) return fromFolder(base, say)

	const model = `${base}.wlk`
	if (!existsSync(model)) throw new Error(say.modelNotFound(model))
	const repl = `${base}.wrepl`
	return { replPath: existsSync(repl) ? repl : undefined, modelPaths: [model], base }
}

/** De los argumentos posicionales a los archivos concretos. */
const resolveInputs = async (positional, say) => {
	const looksLikeBaseName = positional.length === 1 && !['.wlk', '.wrepl'].includes(extname(positional[0]))
	if (looksLikeBaseName) return fromBaseName(positional[0], say)

	const replPath = positional.find((path) => extname(path) === '.wrepl')
	const modelPaths = positional.filter((path) => path !== replPath)
	if (!modelPaths.length) throw new Error(say.missingModel)
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
	// parseArguments recorre todos los argumentos, asi que el idioma se conoce aunque
	// alguno este mal escrito: hasta ese aviso sale en el idioma pedido
	const say = messagesFor(MESSAGES, options.language)

	// Antes un flag desconocido se tomaba por nombre de archivo, y el error que
	// salia hablaba de un .wlk que no existe. Ahora se dice lo que es, y para los
	// que cambiaron de nombre se sugiere el nuevo.
	if (options.unknown.length) {
		for (const flag of options.unknown) {
			const renamed = RENAMED_FLAGS[flag]
			console.error(renamed ? say.renamedFlag(flag, renamed) : say.unknownFlag(flag))
		}
		process.exit(1)
	}

	if (options.help || !options.positional.length) {
		console.log(messagesFor(HELP, options.language))
		process.exit(options.help ? 0 : 1)
	}

	const { replPath, modelPaths, base } = await resolveInputs(options.positional, say)

	const files = withPackageNames(await readSources(modelPaths, false, { language: options.language }), modelPaths)
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
	const genders = {
		feminine: options.feminine,
		masculine: options.masculine,
		language: options.language,
	}
	const registry = createIdentityRegistry()
	/*
	 * La referencia global de un WKO que se llama igual que su propia caja no se
	 * dibuja: su nombre ya esta ADENTRO del ovalo, y dibujarla deja dos veces la
	 * misma palabra unidas por una flecha. Las demas quedan siempre: si el ejemplo
	 * escribio `const a = miObjeto`, ese "a" es un nombre que solo existe ahi y hay
	 * que verlo. Con --wkoshowref se dibujan todas.
	 */
	const onlyUsefulGlobals = (model) => options.showWkoRef
		? model
		: { ...model, globals: model.globals.filter((global) => !global.ownName) }
	const snapshot = (session) => onlyUsefulGlobals(buildObjectModel(session, { ...genders, registry }))

	let initialModel
	const steps = []
	const session = await run(files, replSource, {
		mainFile,
		language: options.language,
		...(options.sequence ? {
			onStart: (session) => { initialModel = snapshot(session) },
			afterEach: (sentence, session, error) => steps.push({ sentence, error, model: snapshot(session) }),
		} : {}),
	})

	// Una línea que falla no corta nada. El .wrepl se ejecuta completo —el REPL de
	// Wollok hace lo mismo: sigue con la línea siguiente— y el diagrama se genera
	// con lo que haya quedado. Las líneas que fallaron se anotan en el dibujo, al
	// pie, con su error en rojo: ver dónde falló el ejemplo es justamente algo que
	// conviene tener a la vista, no un motivo para no tener diagrama.
	if (session.errors.length) {
		console.error(`\n${say.failedLines(session.errors.length)}`)
		for (const error of session.errors) console.error(`  ✗ ${error.text}\n      ${error.message}`)
		console.error('')
	}

	const model = options.sequence ? steps[steps.length - 1]?.model ?? initialModel : snapshot(session)
	const pages = options.sequence ? groupSteps(initialModel, steps, { language: options.language }) : undefined

	const output = options.output ?? `${base}${options.sequence ? SEQUENCE_SUFFIX : SUFFIX}.drawio`
	const previousGeometry = !options.relayout && existsSync(output)
		? readGeometry(await readFile(output, 'utf8'))
		: new Map()

	// El color de cada familia lo decide el modelo ESTÁTICO, el mismo que usa el
	// diagrama de clases, para que una familia salga del mismo color en los dos.
	// Se lee también el sidecar, porque su diccionario de tipos puede cambiar qué
	// entidades terminan siendo polimórficas entre sí.
	const colorIndex = colorIndexOf(extractModel(
		session.environment,
		await loadConfig({ sources: modelPaths, language: options.language }),
		{ language: options.language },
	))

	const settings = {
		name: options.title ?? `${basename(base)} — ${textsFor(options.language).objectDiagram}`,
		previousGeometry,
		colorIndex,
		showEnv: options.showEnv === true,
		showPadlock: options.hidePadlock !== true,
		refColors: options.refColors === true,
		palette: options.palette,
		language: options.language,
		// El ruteo verifica lo que dibuja. Si alguna flecha no encontro por donde
		// esquivar conviene enterarse: casi siempre quiere decir que el layout dejo
		// un objeto en un lugar incomodo, y se arregla moviendolo a mano.
		report: ({ warnings }) => {
			if (!warnings.length || options.quiet) return
			console.log(`   ${say.unroutedArrows(warnings.length)}`)
			for (const warning of warnings) console.log(`     - ${warning}`)
		},
		header: [
			`${textsFor(options.language).generatedFrom} ${files.map((f) => f.name).join(', ')}`
				+ (replPath ? ` + ${basename(replPath)}` : ` ${textsFor(options.language).withoutRepl}`),
			textsFor(options.language).doNotEdit,
		],
	}
	const failures = session.errors.map((error) => captionLineOf(error, error.message))
	const diagram = pages ? renderSequence(pages, settings) : renderObjectDiagram(model, { ...settings, failures })

	await writeFile(output, diagram, 'utf8')
	const summary = say.summary(model.objects.length, model.references.length, model.globals.length, familyCountOf(model))
	console.log(`✓ ${output}  (${pages ? say.sequenceSummary(pages.length, steps.length, summary) : summary})`)
	if (previousGeometry.size && !options.quiet) {
		console.log(`   ${say.keptPositions(previousGeometry.size)}`)
	}

	if (!replPath && !options.quiet) {
		console.log(`   ${say.withoutRepl}`)
	}

	if (!options.quiet && model.warnings.length) {
		console.error(`\n${say.warnings(model.warnings.length)}`)
		for (const warning of model.warnings) console.error(`  - ${warning}`)
	}
}

main().catch((error) => {
	console.error(error.message)
	process.exit(1)
})
