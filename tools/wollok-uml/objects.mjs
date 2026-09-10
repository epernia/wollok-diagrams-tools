/*
 * Modelo de OBJETOS (a diferencia de extract.mjs, que arma el modelo de clases).
 *
 * Acá no alcanza con leer el código: hay que EJECUTARLO. Un diagrama de objetos
 * muestra el estado del ambiente en un momento dado, y ese estado sale de correr
 * el ejemplo. Se usa el mismo intérprete que el REPL de Wollok:
 *
 *     buildEnvironment([.wlk])  ──►  Interpreter  ──►  interprete(línea) x N
 *                                                              │
 *                                          frame.locals ◄──────┘
 *                                                │
 *                                    se camina el grafo desde ahí
 *
 * El modelo que sale es plano y no sabe nada de draw.io:
 *
 *   {
 *     objects:    [{ id, label, kind, module, className, family }],
 *     references: [{ from, to, label, constant }],   // flechas entre objetos
 *     globals:    [{ name, to, constant }],          // referencias del ambiente
 *     warnings:   [string]
 *   }
 */

import { importWollokTs } from './wollok.mjs'

const WOLLOK_BASE = 'wollok.'
const COLLECTIONS = ['wollok.lang.List', 'wollok.lang.Set', 'wollok.lang.Dictionary']
const LIST = 'wollok.lang.List'

// ---------- el género de la clase, para "unMensajero" / "unaUbicacion" ----------

const FEMININE_ENDINGS = ['a', 'cion', 'sion', 'dad', 'tad', 'tud', 'umbre', 'ez', 'itis', 'esis']

// Masculinos terminados en -a: casi todos de origen griego. Son los que mas
// rompen la heuristica del sufijo, asi que van listados.
const MASCULINE_EXCEPTIONS = [
	'dia', 'mapa', 'problema', 'sistema', 'tema', 'idioma', 'programa', 'planeta',
	'clima', 'poema', 'drama', 'esquema', 'sofa', 'tranvia', 'diagrama', 'telegrama',
	'fantasma', 'panorama', 'aroma', 'enigma', 'sintoma', 'cometa', 'pijama',
]

export const articleFor = (className, { feminine = [], masculine = [] } = {}) => {
	if (!className) return 'un'
	if (feminine.includes(className)) return 'una'
	if (masculine.includes(className)) return 'un'
	const name = className.toLowerCase()
	if (MASCULINE_EXCEPTIONS.includes(name)) return 'un'
	return FEMININE_ENDINGS.some((ending) => name.endsWith(ending)) ? 'una' : 'un'
}

/** Mensajero -> unMensajero | Ubicacion -> unaUbicacion */
export const instanceLabel = (className, genders) =>
	`${articleFor(className, genders)}${className ?? 'Objeto'}`

// ---------- lectura del .wrepl ----------

/**
 * Sentencias del .wrepl, una por elemento.
 *
 * Es line-based como el REPL, pero se juntan las líneas mientras haya paréntesis,
 * llaves o corchetes abiertos, así una expresión larga se puede partir en varias.
 */
export const sentencesOf = (source) => {
	const sentences = []
	let pending = ''
	let startedAt = 0
	let depth = 0

	source.split(/\r?\n/).forEach((rawLine, index) => {
		const line = rawLine.replace(/\/\/.*$/, '').trim()
		if (!line && !pending) return
		if (!pending) startedAt = index + 1        // numero de linea del archivo, 1-based
		pending = pending ? `${pending} ${line}` : line
		for (const character of line) {
			if ('([{'.includes(character)) depth++
			if (')]}'.includes(character)) depth--
		}
		if (depth <= 0 && pending) {
			sentences.push({ text: pending, line: startedAt })
			pending = ''
			depth = 0
		}
	})
	if (pending) sentences.push({ text: pending, line: startedAt })
	return sentences
}

// ---------- ejecución ----------

/**
 * Levanta el intérprete con el .wlk y corre las sentencias del .wrepl.
 *
 * @param options.onStart    se llama con (session) antes de la primera sentencia
 * @param options.afterEach  se llama despues de CADA sentencia con
 *   (sentencia, session, error). Sirve para sacar una foto del ambiente en cada
 *   paso, que es lo que hace --genseq.
 * @returns { interpreter, environment, replPackage, errors }
 */
export const run = async (files, replSource, { mainFile, onStart, afterEach } = {}) => {
	const wollok = await importWollokTs()
	const { buildEnvironment, Interpreter, Evaluation, WRENatives, REPL, interprete } = wollok

	const environment = buildEnvironment(files)

	// El REPL "vive adentro" del archivo del dominio: así se pueden usar sus
	// clases y objetos sin escribir ningún import, igual que `wollok repl archivo.wlk`.
	const main = mainFile ?? files[0].name
	const fqn = main.replace(/\.[^./\\]+$/, '').split(/[\\/]/).join('.')
	const entity = environment.getNodeOrUndefinedByFQN(fqn)
	if (!entity) throw new Error(`No pude encontrar el paquete ${fqn} (¿el nombre del archivo tiene caracteres raros?)`)
	environment.scope.register([REPL, entity])

	const interpreter = new Interpreter(Evaluation.build(environment, WRENatives ?? {}))

	const errors = []
	const session = { wollok, interpreter, environment, replPackage: entity, errors }
	onStart?.(session)

	for (const sentence of sentencesOf(replSource)) {
		const result = interprete(interpreter, sentence.text)
		const error = result.errored
			? { ...sentence, message: (result.error?.message ?? String(result.result)).split('\n')[0].trim() }
			: undefined
		if (error) errors.push(error)
		afterEach?.(sentence, session, error)
	}

	return session
}

// ---------- recorrido del grafo ----------

/**
 * Que es cada objeto. Se le pregunta al propio modulo del runtime en vez de
 * deducirlo del nombre del paquete: asi un object anonimo, o un WKO de la
 * biblioteca, se reconocen igual que uno con nombre propio.
 */
const kindOf = (object) => {
	if (object.innerValue === null) return 'null'
	if (object.module.kind === 'Singleton') return 'wko'
	if (COLLECTIONS.includes(object.module.fullyQualifiedName) || Array.isArray(object.innerValue)) return 'collection'
	if (object.innerValue !== undefined) return 'literal'
	return 'instance'
}

const literalLabel = (object) => {
	const value = object.innerValue
	if (value === null || value === undefined) return object.module.name
	return typeof value === 'string' ? `"${value}"` : String(value)
}

/**
 * Un valor de la biblioteca: un numero, un string, una lista. NO cuenta como tal
 * un WKO, ni siquiera uno anonimo: `object { ... }` tiene un nombre de modulo
 * sintetico (wollok.lang.Object#<uuid>) pero es codigo del usuario, y tiene que
 * poder entrar en una familia polimorfica como cualquier otro objeto.
 */
const isLibraryValue = (object) =>
	object.module.kind !== 'Singleton' && object.module.fullyQualifiedName.startsWith(WOLLOK_BASE)

/** Los objetos "cortos" (numeros, strings, booleanos) no se abren. */
const expands = (object) =>
	!object.shouldShortenRepresentation?.() && !object.shouldShowShortValue?.()

/**
 * Familias polimórficas: dos objetos van del mismo color si son polimórficos.
 *
 * Se unen por tres criterios, de más estructural a más circunstancial:
 *   1. Están en la misma cadena de herencia (un MensajeroConTransporte es
 *      polimórfico con un Mensajero).
 *   2. Entienden exactamente los mismos mensajes (un WKO puede ser polimórfico
 *      con una clase sin heredar de nada).
 *   3. Ocupan el mismo lugar. Si dos objetos son, en algún momento, el valor del
 *      mismo atributo de la misma clase — o elementos de la colección que vive en
 *      ese atributo — el ejemplo está diciendo que los usa de manera
 *      intercambiable. Es el criterio más propio de un diagrama de OBJETOS:
 *      evidencia de uso, no de estructura. Une, por ejemplo, a la Cadena con la
 *      Camara y la Alarma, porque las tres viven en algún `medidasDeSeguridad`,
 *      aunque no compartan ni herencia ni la lista concreta.
 */
const familiesOf = (modules, extraUnions = []) => {
	const parent = new Map()
	const find = (name) => {
		while (parent.get(name) !== name) { parent.set(name, parent.get(parent.get(name))); name = parent.get(name) }
		return name
	}
	const union = (a, b) => { const [ra, rb] = [find(a), find(b)]; if (ra !== rb) parent.set(rb, ra) }

	for (const module of modules) parent.set(module.fullyQualifiedName, module.fullyQualifiedName)

	// 1. herencia
	for (const module of modules) {
		for (const ancestor of module.hierarchy ?? []) {
			if (ancestor.name === 'Object') continue
			if (parent.has(ancestor.fullyQualifiedName) && ancestor !== module) {
				union(ancestor.fullyQualifiedName, module.fullyQualifiedName)
			}
		}
	}

	// 2. mismo conjunto de mensajes
	// los metodos que vienen de Object no distinguen a nadie; los de un object
	// anonimo si, aunque su modulo se llame wollok.lang.Object#<uuid>
	const fromLibrary = (fqn) => fqn?.startsWith(WOLLOK_BASE) && !fqn.includes('#')
	const selectorsOf = (module) => [...new Set((module.allMethods ?? [])
		.filter((method) => !fromLibrary(method.parent?.fullyQualifiedName))
		.map((method) => `${method.name}/${method.parameters.length}`))].sort().join(',')

	const bySelectors = new Map()
	for (const module of modules) {
		const key = selectorsOf(module)
		if (!key) continue
		if (bySelectors.has(key)) union(bySelectors.get(key), module.fullyQualifiedName)
		else bySelectors.set(key, module.fullyQualifiedName)
	}

	// 3. ocupan el mismo lugar (mismo atributo de la misma clase)
	for (const slot of extraUnions.values()) {
		const inhabitants = [...slot].filter((fqn) => parent.has(fqn))
		for (let i = 1; i < inhabitants.length; i++) union(inhabitants[0], inhabitants[i])
	}

	return (module) => find(module.fullyQualifiedName)
}

/** Ids estables: el camino desde el primer global que llega al objeto. */
const sanitize = (text) => String(text).replace(/[^A-Za-z0-9_.-]/g, '_')

/**
 * Un registro de identidades compartido entre varias fotos del ambiente.
 *
 * Los ids son el camino desde la referencia global (`neo`, `caja.cosas.0`), y eso
 * alcanza para una sola foto. Pero en una secuencia el mismo camino puede pasar a
 * apuntar a OTRO objeto (`var x = a` y despues `x = b`): sin registro, las dos
 * fotos usarian el id `x` para dos objetos distintos. Con registro, cada objeto
 * del runtime se queda con el id que le toco la primera vez, y el que llega
 * despues a un camino ya usado recibe un sufijo.
 */
export const createIdentityRegistry = () => ({ byRuntime: new Map(), used: new Set() })

/**
 * Camina el ambiente y arma el modelo de objetos.
 * @param options.feminine   nombres de clase que llevan "una" aunque la heuristica diga otra cosa
 * @param options.masculine  idem al reves
 * @param options.registry   createIdentityRegistry(), para una secuencia de fotos
 */
export const buildObjectModel = ({ interpreter, environment, replPackage }, options = {}) => {
	const warnings = []
	const frame = interpreter.evaluation.currentFrame
	const prefix = `${replPackage.fullyQualifiedName}.`

	// --- raices: las referencias globales del ambiente ---
	const roots = []
	for (const name of frame.locals.keys()) {
		const node = environment.getNodeOrUndefinedByFQN(name)
		const object = frame.get(name)
		if (!object) continue

		// las var y const del ejemplo viven en el paquete del REPL
		if (node?.kind === 'Variable' && name.startsWith(prefix)) {
			roots.push({ name: name.slice(prefix.length), object, constant: !!node.isConstant })
			continue
		}
		// El nombre de un WKO es, en los hechos, una referencia global constante.
		// Se toman los de todos los archivos del usuario, no solo el principal;
		// los de la biblioteca (wollok.*) solo si el ejemplo los usa (mas abajo).
		if (node?.kind === 'Singleton' && !name.startsWith(WOLLOK_BASE)) {
			roots.push({ name: node.name ?? name, object, constant: true, wko: true })
		}
	}

	// --- recorrido en anchura desde las raíces ---
	const objects = []
	const references = []
	const globals = []
	const idByRuntimeId = new Map()
	const modules = new Set()
	const queue = []

	// "lugares": un atributo de una clase (Pertenencia#medidasDeSeguridad) o los
	// elementos de la colección que vive ahí (Pertenencia#medidasDeSeguridad[]).
	// Todo lo que pasa por el mismo lugar se usa de manera intercambiable.
	const slots = new Map()
	const occupy = (slot, object) => {
		if (!slot || isLibraryValue(object)) return
		if (!slots.has(slot)) slots.set(slot, new Set())
		slots.get(slot).add(object.module.fullyQualifiedName)
	}

	const registry = options.registry
	const stableId = (object, wanted) => {
		if (!registry) return wanted
		const known = registry.byRuntime.get(object.id)
		if (known) return known
		let id = wanted
		for (let n = 2; registry.used.has(id); n++) id = `${wanted}~${n}`
		registry.byRuntime.set(object.id, id)
		registry.used.add(id)
		return id
	}

	const register = (object, wantedId, slot) => {
		occupy(slot, object)
		if (idByRuntimeId.has(object.id)) return idByRuntimeId.get(object.id)
		const id = stableId(object, wantedId)
		idByRuntimeId.set(object.id, id)
		modules.add(object.module)
		objects.push({ id, object })
		queue.push({ object, id, slot })
		return id
	}

	for (const root of roots) {
		const id = register(root.object, sanitize(root.name), `global::${root.name}`)
		globals.push({ name: root.name, to: id, constant: root.constant })
	}

	while (queue.length) {
		const { object, id, slot } = queue.shift()
		if (!expands(object)) continue

		// referencias de instancia (las var y const que define el objeto o su clase)
		for (const name of object.locals.keys()) {
			if (name === 'self') continue
			const target = object.get(name)
			if (!target) continue
			const targetId = register(target, `${id}.${sanitize(name)}`, `${object.module.fullyQualifiedName}#${name}`)
			references.push({ from: id, to: targetId, label: name, constant: object.isConstant(name) })
		}

		// elementos de una colección: en una List el nombre de la flecha es el índice
		const isList = object.module.fullyQualifiedName === LIST
		;(object.innerCollection ?? []).forEach((item, index) => {
			const targetId = register(item, `${id}.${index}`, `${slot}[]`)
			references.push({ from: id, to: targetId, label: isList ? String(index) : '', constant: false })
		})
	}

	// Un WKO al que se llego por referencia (por ejemplo console, o uno de otro
	// archivo) tambien es un objeto con nombre: se le agrega su flecha global,
	// porque si no queda un ovalo que dice "WKO" y no hay forma de saber cual es.
	const alreadyGlobal = new Set(globals.map((global) => global.to))
	for (const { id, object } of objects) {
		if (object.module.kind !== 'Singleton' || alreadyGlobal.has(id)) continue
		const name = object.module.name
		if (!name) continue     // un object anonimo no tiene nombre que poner
		globals.push({ name, to: id, constant: true })
		alreadyGlobal.add(id)
	}

	// --- etiquetas, tipos y familias ---
	const familyOf = familiesOf([...modules], slots)
	const genders = { feminine: options.feminine ?? [], masculine: options.masculine ?? [] }

	const described = objects.map(({ id, object }) => {
		const kind = kindOf(object)
		const className = object.module.name
		return {
			id,
			kind,
			module: object.module.fullyQualifiedName,
			className,
			// un WKO es un objeto como cualquier otro: tambien entra en una familia
			family: kind === 'instance' || kind === 'wko' ? familyOf(object.module) : kind,
			// el articulo va para todo lo que es instancia de una clase, incluidas
			// las de la biblioteca: unList, unSet, unaDate
			label: kind === 'wko' ? 'WKO'
				: kind === 'null' ? 'null'
					: kind === 'literal' ? literalLabel(object)
						: instanceLabel(className, genders),
		}
	})

	if (!described.length) {
		warnings.push('No encontré ningún objeto: el modelo no define ningún WKO y el ejemplo no crea nada')
	}

	return { objects: described, references, globals, warnings }
}
