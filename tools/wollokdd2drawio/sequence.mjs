/*
 * La secuencia: una foto del ambiente por cada línea del .wrepl, salvo que la
 * línea no aporte un dibujo nuevo.
 *
 * Hay dos razones para NO abrir una página:
 *
 *   1. La línea no cambia nada (una consulta): se suma al pie del dibujo que no
 *      modificó.
 *   2. La línea solo CONSTRUYE: se suma a la página de la tanda de creaciones en
 *      curso. Crear diez objetos sueltos no son diez dibujos interesantes; el
 *      dibujo interesante empieza cuando algo cambia. Una modificación corta la
 *      tanda, y las creaciones que vengan después arman una tanda nueva.
 *
 *   // existe el WKO docentes
 *   const eric = new Persona()      ──► construye  ─┐
 *   const martin = new Persona()    ──► construye  ─┤ una sola página
 *   docentes.agregar(eric)          ──► MODIFICA   ─┴─► página nueva
 *   const ana = new Persona()       ──► construye  ─┐ otra tanda,
 *   const juan = new Persona()      ──► construye  ─┘ otra sola página
 */

import { textsFor } from './texts.mjs'

/**
 * Forma canónica de un modelo, para poder comparar dos fotos.
 *
 * Se ordena todo: el recorrido del grafo es determinista, pero un cambio en el
 * medio puede reordenar lo que viene después, y eso no es un cambio del diagrama.
 */
export const signatureOf = (model) => JSON.stringify({
	objects: model.objects
		.map((object) => `${object.id}|${object.kind}|${object.label}`)
		.sort(),
	references: model.references
		.map((reference) => `${reference.from}|${reference.label}|${reference.to}|${reference.constant}`)
		.sort(),
	globals: model.globals
		.map((global) => `${global.name}|${global.to}|${global.constant}`)
		.sort(),
})

/**
 * ¿El paso solo agregó cosas nuevas, sin tocar lo que ya estaba?
 *
 * Esta es la pregunta que separa una tanda de creaciones de una modificación.
 *
 * Construye:   const eric = new Persona()   (aparece un objeto, y las flechas
 *              que salen de él son suyas)
 *              var empleadoDelMes = neo     (le pone otro nombre a algo que ya
 *              está: no modifica ningún objeto)
 *
 * Modifica:    docentes.agregar(eric)       (le sale una flecha nueva a un
 *              objeto que YA existía)
 *              paquete.estaPago(true)       (una flecha que ya existía ahora
 *              apunta a otro lado)
 *              favorito = laika             (un global que ya existía cambia de
 *              destino)
 */
export const isConstructionOnly = (before, after) => {
	const existing = new Set(before.objects.map((object) => object.id))
	const afterById = new Map(after.objects.map((object) => [object.id, object]))

	// desapareció alguno, o cambió lo que dice adentro
	for (const object of before.objects) {
		const now = afterById.get(object.id)
		if (!now || now.label !== object.label) return false
	}

	// las flechas que SALEN de lo que ya existía tienen que ser las mismas
	const outgoing = (model) => model.references
		.filter((reference) => existing.has(reference.from))
		.map((reference) => `${reference.from}|${reference.label}|${reference.to}|${reference.constant}`)
		.sort().join('\n')
	if (outgoing(before) !== outgoing(after)) return false

	// y los nombres globales que ya existían tienen que apuntar a lo mismo
	const globalsAfter = new Map(after.globals.map((global) => [global.name, global]))
	return before.globals.every((global) => globalsAfter.get(global.name)?.to === global.to)
}

/**
 * Una línea del pie del dibujo: el texto numerado y, si falló, el error.
 *
 * Se devuelve como dato y no como texto ya armado porque el error se dibuja
 * distinto —en rojo, con una ✗, en su propio renglón— y eso lo decide el render.
 *
 * La usan la secuencia (todas las líneas) y el diagrama de un solo instante (sólo
 * las que fallaron): así las dos anotan una falla exactamente igual.
 *
 * @param sentence  { line, text } de la línea del .wrepl
 * @param message   el mensaje del error, si falló
 */
export const captionLineOf = ({ line, text }, message) => ({
	text: `${String(line).padStart(2, ' ')}:  ${text}`,
	error: message,
})

const captionLine = (step) => captionLineOf(step.sentence, step.error?.message)

/** El nombre de la pestaña: entra poco, así que se recorta. */
const TAB_LENGTH = 34
const tabName = (step) => {
	const text = step.sentence.text
	const short = text.length > TAB_LENGTH ? `${text.slice(0, TAB_LENGTH - 1)}…` : text
	return `${step.sentence.line}: ${short}`
}

/**
 * Agrupa los pasos en páginas.
 *
 * @param initial           la foto de antes de ejecutar nada (el ambiente ya tiene los WKO)
 * @param steps             [{ sentence, model, error }] en orden de ejecución
 * @param options.language  el idioma de los nombres de pestaña ("Construcción" o "Construction")
 * @returns [{ model, lines, name }] una entrada por página
 */
export const groupSteps = (initial, steps, { language } = {}) => {
	const texts = textsFor(language)
	const pages = []
	const openPage = (model, name) => {
		pages.push({ model, lines: [], name })
		return pages[pages.length - 1]
	}

	// La primera página de construcción arranca con el estado inicial, si es que
	// hay algo que mostrar: los WKO del modelo existen antes de la primera línea.
	let construction = initial.objects.length ? openPage(initial, texts.initialState) : undefined
	let previous = initial
	let previousSignature = signatureOf(initial)

	for (const step of steps) {
		const signature = signatureOf(step.model)

		if (signature === previousSignature) {
			// no cambió nada: la línea se documenta al pie de la página actual
			const current = pages[pages.length - 1] ?? (construction = openPage(step.model, texts.initialState))
			current.lines.push(captionLine(step))
		} else if (isConstructionOnly(previous, step.model)) {
			// una tanda de creaciones entra toda en la misma página, esté al
			// principio del ejemplo o en el medio
			const first = !pages.length
			construction ??= openPage(step.model, first ? texts.construction : tabName(step))
			construction.model = step.model
			if (construction === pages[0]) construction.name = texts.construction
			construction.lines.push(captionLine(step))
		} else {
			// una modificación corta la tanda y se lleva su propia página
			construction = undefined
			const page = openPage(step.model, tabName(step))
			page.lines.push(captionLine(step))
		}

		previous = step.model
		previousSignature = signature
	}

	return pages
}
