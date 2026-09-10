/*
 * Lectura de las posiciones de un .drawio ya existente, para poder regenerarlo
 * sin perder lo que se acomodó a mano. Lo usan las dos herramientas que generan
 * .drawio (el diagrama dinámico y el estático).
 *
 * La clave del mecanismo no está acá sino en los generadores: emiten ids
 * ESTABLES (el nombre de la entidad, o el camino hasta el objeto). Esta función
 * solo devuelve un mapa id -> geometría.
 *
 * No asume el orden de los atributos: draw.io reescribe el archivo a su manera
 * cuando guardás, y ahí el orden cambia.
 */

const CELL = /<(mxCell|object|UserObject)\b([^>]*?)(\/?)>/g
const GEOMETRY = /<mxGeometry\b([^>]*?)\/?>/

const attribute = (blob, name) => blob.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]
const number = (blob, name) => {
	const value = attribute(blob, name)
	return value === undefined ? undefined : Number(value)
}

/**
 * Cuando el archivo tiene varias páginas (la secuencia de --genseq), el mismo id
 * aparece una vez por página con la MISMA geometría: así las escribe el
 * generador. Si una difiere, es porque alguien movió esa caja en esa página, y
 * eso es lo que hay que conservar — aunque el resto de las páginas siga con la
 * posición vieja. Por eso, ante desacuerdo, gana la geometría menos repetida.
 */
const resolve = (candidates) => {
	if (candidates.length === 1) return candidates[0]
	const votes = new Map()
	for (const candidate of candidates) {
		const key = `${candidate.x},${candidate.y},${candidate.width},${candidate.height}`
		votes.set(key, [...(votes.get(key) ?? []), candidate])
	}
	if (votes.size === 1) return candidates[candidates.length - 1]
	return [...votes.values()].sort((a, b) => a.length - b.length)[0].at(-1)
}

/** @returns Map(id -> { x, y, width, height, parent }) */
export const readGeometry = (xml) => {
	const candidates = new Map()
	let wrapperId

	for (const match of xml.matchAll(CELL)) {
		const [, tag, blob, selfClosing] = match

		if (tag !== 'mxCell') {
			// <object id="..."><mxCell .../></object>: el id vive en el envoltorio
			wrapperId = selfClosing ? undefined : attribute(blob, 'id')
			continue
		}

		const id = attribute(blob, 'id') ?? wrapperId
		wrapperId = undefined
		if (!id || attribute(blob, 'vertex') !== '1') continue

		// la geometría es el primer <mxGeometry> que viene después de la celda
		const rest = xml.slice(match.index + match[0].length, match.index + match[0].length + 400)
		const found = rest.match(GEOMETRY)
		if (!found) continue

		candidates.set(id, [...(candidates.get(id) ?? []), {
			x: number(found[1], 'x') ?? 0,
			y: number(found[1], 'y') ?? 0,
			width: number(found[1], 'width') ?? 0,
			height: number(found[1], 'height') ?? 0,
			parent: attribute(blob, 'parent'),
		}])
	}

	return new Map([...candidates].map(([id, found]) => [id, resolve(found)]))
}
