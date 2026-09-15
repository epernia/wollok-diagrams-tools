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
 *   - un rectángulo "Environment" con todos los objetos adentro, como elipses
 *     ("Ambiente" con los modos en castellano);
 *   - las var y const de cada objeto, como flechas salientes con su nombre, en
 *     negro, con un candado 🔒 pegado al nombre si son const;
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
 *       --wkoshowref         dibujar tambien la referencia global de cada WKO,
 *                            aunque su nombre ya este adentro del ovalo
 *       --showenv            dibujar el rectangulo del Ambiente
 *       --hidepadlock        no poner el candado 🔒 en las referencias const
 *       --refcolors          pintar las referencias: const y nombres de object en
 *                            rojo, var en verde (por defecto todas en negro)
 *       --colourblind        colorear por familia polimorfica, con tonos aptos
 *                            para daltonicos
 *       --pastelcolors       idem, con la paleta pastel de draw.io
 *                            (sin ninguno de los dos: wollok light mode, verde lo
 *                            que trae Wollok y azul lo que escribiste vos)
 *   -t, --title <texto>      nombre de la pestaña del diagrama
 *   El idioma y el articulo de las instancias (si se pasan varios, vale el ultimo):
 *       --enlang             POR DEFECTO. Textos en ingles (Environment,
 *                            Construction, Object diagram) y en las instancias
 *                            solo el nombre de la clase: Persona
 *       --enarticlelang      idem, con "a"/"an" delante: aPersona,
 *                            anEmpresaConEmpleados
 *       --eslang             textos en castellano (Ambiente, Construccion) y
 *                            solo el nombre de la clase: Persona
 *       --esinclusivelang    idem, con "une" sin marcar genero: unePersona
 *       --esgenderlang       idem, con "un"/"una" segun el genero inferido de la
 *                            PRIMERA palabra del nombre: unaEmpresaConEmpleados
 *       --feminine <A,B>     clases que llevan "una"; solo cuenta con --esgenderlang
 *       --masculine <A,B>    idem al reves
 *       --relayout           ignorar las posiciones del archivo anterior
 *   -q, --quiet              no mostrar advertencias
 */

import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { readSources } from '../wollok-uml/sources.mjs'
import { readGeometry } from '../wollok-uml/drawio-merge.mjs'
import { run, buildObjectModel, createIdentityRegistry, DEFAULT_LANGUAGE } from '../wollok-uml/objects.mjs'
import { loadConfig } from '../wollok-uml/config.mjs'
import { extractModel } from '../wollok-uml/extract.mjs'
import { colorIndexOf } from '../wollok-uml/families.mjs'
import { renderObjectDiagram, renderSequence } from './render.mjs'
import { groupSteps, captionLineOf } from './sequence.mjs'
import { textsFor } from './texts.mjs'
import { familyCountOf } from './colors.mjs'

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
			// el ultimo que se pase es el que vale
			case '--enlang': options.language = 'en'; break
			case '--enarticlelang': options.language = 'enArticle'; break
			case '--eslang': options.language = 'es'; break
			case '--esinclusivelang': options.language = 'esInclusive'; break
			case '--esgenderlang': options.language = 'esGendered'; break
			case '--relayout': options.relayout = true; break
			case '--keep-going': options.keepGoing = true; break
			case '-q': case '--quiet': options.quiet = true; break
			case '-h': case '--help': options.help = true; break
			default:
				// un archivo nunca empieza con guion: si empieza, es un flag mal escrito
				if (argv[i].startsWith('-')) options.unknown.push(argv[i])
				else options.positional.push(argv[i])
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

	// Antes un flag desconocido se tomaba por nombre de archivo, y el error que
	// salia hablaba de un .wlk que no existe. Ahora se dice lo que es, y para los
	// que cambiaron de nombre se sugiere el nuevo.
	if (options.unknown.length) {
		for (const flag of options.unknown) {
			const renamed = RENAMED_FLAGS[flag]
			console.error(renamed
				? `La opción ${flag} ahora se llama ${renamed}`
				: `No conozco la opción ${flag} (probá --help)`)
		}
		process.exit(1)
	}

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
		console.error(`\n${session.errors.length} línea(s) del .wrepl fallaron al ejecutarse (quedan marcadas en rojo al pie del diagrama):`)
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
	const colorIndex = colorIndexOf(extractModel(session.environment, await loadConfig({ sources: modelPaths })))

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
			console.log(`   ${warnings.length} flecha(s) que no pude desviar:`)
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
