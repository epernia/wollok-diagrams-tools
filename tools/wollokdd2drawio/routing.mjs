/*
 * Ruteo: por dónde va cada flecha del diagrama de objetos.
 *
 * Acá las flechas son RECTAS de centro a centro (edgeStyle=none), no ortogonales
 * como en el diagrama de clases: un recorrido en ángulo recto se vería mal en un
 * dibujo radial de elipses. Así que el desvío, cuando hace falta, es un solo
 * punto corrido PERPENDICULARMENTE a la recta. Con `rounded=1` el quiebre se ve
 * como un arco, que es la forma natural de esquivar acá.
 *
 *        ,-----.                    el arco esquiva al de al lado
 *      ,'       `.
 *   (a)           (c)      en vez de partirlo al medio
 *      `. (b) ,-'
 *
 * Dos motivos para desviar una flecha, y en este orden:
 *
 *   1. DOS FLECHAS AL MISMO PAR. Pasa siempre que una colección repite un
 *      elemento: en [1,2,3,3] los índices 2 y 3 son el mismo objeto, así que
 *      salen dos flechas idénticas y se tapan. Se abren en abanico.
 *   2. LA RECTA ATRAVIESA OTRO OBJETO. Se prueba un desvío cada vez más grande,
 *      alternando lado, hasta que los dos tramos queden libres.
 *
 *   3. LA FLECHA CRUZA OTRA FLECHA. Lo mismo, pero el desvío se acepta sólo si
 *      el cruce DESAPARECE y no aparece otro en el camino.
 *
 * Lo que no se puede esquivar se deja recto y se avisa: una flecha dando una
 * vuelta enorme es peor que una que cruza, y además suele ser señal de que el
 * problema está en el layout y no en el dibujo de la flecha.
 */

const PARALLEL_GAP = 30     // entre dos flechas que unen el mismo par
const DODGE_STEP = 26       // de cuánto en cuánto se prueba el desvío
const DODGE_TRIES = 10      // hasta 10 pasos a cada lado
const CLEARANCE = 3         // aire que se le exige al borde de la elipse

const UNTANGLE_STEPS = 12   // para destrabar un cruce se llega hasta 12 pasos
const UNTANGLE_PASSES = 3
/** Dónde se prueba el quiebre, como fracción del camino. El medio primero. */
const UNTANGLE_ALONG = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.15, 0.85]

// ---------- geometría ----------

const EPSILON = 1e-9

/**
 * Si un segmento toca una elipse. Se lleva la elipse al círculo unitario
 * (trasladar al centro y dividir por los semiejes) y se resuelve |p + t·d| = 1,
 * que es una cuadrática. Comparar contra el rectángulo que la envuelve sobraría
 * justo en las esquinas, que es por donde más pasan las flechas.
 */
const touchesEllipse = ([a, b], shape) => {
	const rx = shape.width / 2 + CLEARANCE
	const ry = shape.height / 2 + CLEARANCE
	if (rx <= 0 || ry <= 0) return false
	const p = { x: (a.x - shape.x) / rx, y: (a.y - shape.y) / ry }
	const d = { x: (b.x - a.x) / rx, y: (b.y - a.y) / ry }
	const qa = d.x * d.x + d.y * d.y
	const qc = p.x * p.x + p.y * p.y - 1
	if (qa < EPSILON) return qc <= 0
	const qb = 2 * (p.x * d.x + p.y * d.y)
	const discriminant = qb * qb - 4 * qa * qc
	if (discriminant < 0) return false
	const root = Math.sqrt(discriminant)
	for (const t of [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)]) {
		if (t > EPSILON && t < 1 - EPSILON) return true
	}
	return qc < 0        // arranca adentro
}

/** Las cajas (números, strings) no son elipses: se comparan como rectángulos. */
const touchesRect = ([a, b], shape) => {
	const [left, right] = [shape.x - shape.width / 2 - CLEARANCE, shape.x + shape.width / 2 + CLEARANCE]
	const [top, bottom] = [shape.y - shape.height / 2 - CLEARANCE, shape.y + shape.height / 2 + CLEARANCE]
	// Liang-Barsky: se recorta el segmento contra las cuatro rectas del rectangulo
	let enter = 0
	let exit = 1
	const [dx, dy] = [b.x - a.x, b.y - a.y]
	for (const [p, q] of [[-dx, a.x - left], [dx, right - a.x], [-dy, a.y - top], [dy, bottom - a.y]]) {
		if (Math.abs(p) < EPSILON) {
			if (q < 0) return false            // paralelo y afuera
			continue
		}
		const t = q / p
		if (p < 0) enter = Math.max(enter, t)
		else exit = Math.min(exit, t)
		if (enter > exit) return false
	}
	return exit > EPSILON && enter < 1 - EPSILON
}

const touches = (segment, shape) => (shape.ellipse ? touchesEllipse(segment, shape) : touchesRect(segment, shape))

/** @param shapes [{ id, x, y, width, height, ellipse }] con x,y en el CENTRO */
const blocked = (segment, shapes, own) =>
	shapes.some((shape) => !own.has(shape.id) && touches(segment, shape))

const orientOf = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))

/** Si dos segmentos se cruzan de verdad (tocarse en una punta no cuenta). */
const segmentsCross = ([a, b], [c, d]) => {
	const [o1, o2] = [orientOf(a, b, c), orientOf(a, b, d)]
	const [o3, o4] = [orientOf(c, d, a), orientOf(c, d, b)]
	return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0
}

const perpendicularOf = (from, to) => {
	const [dx, dy] = [to.x - from.x, to.y - from.y]
	const length = Math.hypot(dx, dy) || 1
	return { x: -dy / length, y: dx / length }
}

const middleOf = (from, to) => ({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 })

// ---------- las dos razones para desviar ----------

/**
 * Dos o más referencias que unen el mismo par: se abren en abanico, repartidas
 * de forma simétrica. Con una cantidad impar, la del medio se deja recta.
 *
 * @returns los abanicos armados: [{ indexes, shifts }]. Después se mueven
 *          ENTEROS, nunca de a una: correr una sola volvería a taparla con sus
 *          hermanas.
 */
const fanOutParallels = (references, centerOf, waypoints) => {
	const groups = new Map()
	references.forEach((reference, index) => {
		const key = `${reference.from}|${reference.to}`
		groups.set(key, [...(groups.get(key) ?? []), index])
	})

	const fans = []
	for (const indexes of groups.values()) {
		if (indexes.length < 2) continue
		const from = centerOf(references[indexes[0]].from)
		const to = centerOf(references[indexes[0]].to)
		if (!from || !to) continue

		const perpendicular = perpendicularOf(from, to)
		const middle = middleOf(from, to)
		const shifts = new Map()
		indexes.forEach((index, i) => {
			const shift = (i - (indexes.length - 1) / 2) * PARALLEL_GAP
			shifts.set(index, shift)
			if (!shift) return
			waypoints.set(index, {
				x: Math.round(middle.x + perpendicular.x * shift),
				y: Math.round(middle.y + perpendicular.y * shift),
			})
		})
		fans.push({ indexes, shifts })
	}
	return fans
}

/**
 * La recta atraviesa otro objeto: se busca el desvío MÁS CHICO que deje los dos
 * tramos libres, probando de a DODGE_STEP y alternando lado para no sesgar el
 * dibujo hacia ninguno.
 *
 * @returns [indices de las referencias que no se pudieron desviar]
 */
const dodgeObstacles = (references, centerOf, shapes, waypoints) => {
	const stubborn = []
	references.forEach((reference, index) => {
		if (waypoints.has(index)) return           // ya la movió el abanico
		const from = centerOf(reference.from)
		const to = centerOf(reference.to)
		if (!from || !to) return
		const own = new Set([reference.from, reference.to])
		if (!blocked([from, to], shapes, own)) return

		const perpendicular = perpendicularOf(from, to)
		// El punto de quiebre no tiene por que estar en el medio: correrlo hacia una
		// punta suele ser lo unico que funciona cuando el estorbo esta pegado al
		// origen o al destino. Se prueba el medio primero, que es el que mejor se ve.
		for (let step = 1; step <= DODGE_TRIES; step++) {
			for (const along of [0.5, 0.35, 0.65, 0.2, 0.8]) {
				const anchor = {
					x: from.x + (to.x - from.x) * along,
					y: from.y + (to.y - from.y) * along,
				}
				for (const side of [1, -1]) {
					const shift = step * DODGE_STEP * side
					const point = {
						x: Math.round(anchor.x + perpendicular.x * shift),
						y: Math.round(anchor.y + perpendicular.y * shift),
					}
					if (blocked([from, point], shapes, own)) continue
					if (blocked([point, to], shapes, own)) continue
					waypoints.set(index, point)
					return
				}
			}
		}
		stubborn.push(index)
	})
	return stubborn
}

/**
 * Destraba los CRUCES entre flechas, que es lo único que no arregla ningún
 * desvío pensado objeto por objeto: una flecha puede tener el camino libre de
 * objetos y aun así pasar por encima de otra flecha.
 *
 * Acá no hay heurística: se prueba un quiebre, se CUENTA cuántos cruces quedan y
 * se acepta sólo si quedan menos. Alcanza con contar los cruces DE ESA flecha,
 * porque es la única que se movió: los demás pares siguen como estaban.
 *
 * Se mueve por UNIDADES, y un abanico es una sola unidad: las flechas que unen el
 * mismo par se corren todas juntas, conservando la separación que las distingue.
 * Mover una sola volvería a taparla con sus hermanas, que es el problema que el
 * abanico vino a resolver.
 *
 * Dos flechas que comparten una punta no cuentan como cruce — salen o llegan al
 * mismo objeto, tocarse ahí es lo normal.
 */
const untangleCrossings = (references, centerOf, shapes, waypoints, fans, stubborn) => {
	const ends = references.map((reference) => [reference.from, reference.to])
	const paths = references.map((_, index) => {
		const from = centerOf(references[index].from)
		const to = centerOf(references[index].to)
		if (!from || !to) return undefined
		const point = waypoints.get(index)
		return point ? [from, point, to] : [from, to]
	})
	const segmentsOf = (path) => path.slice(0, -1).map((point, i) => [point, path[i + 1]])

	const crossingsOf = (index, path) => {
		const mine = segmentsOf(path)
		let total = 0
		for (let other = 0; other < references.length; other++) {
			if (other === index || !paths[other]) continue
			if (ends[other].some((end) => ends[index].includes(end))) continue
			if (segmentsOf(paths[other]).some((theirs) => mine.some((ours) => segmentsCross(ours, theirs)))) total++
		}
		return total
	}

	// un abanico es una unidad; cada flecha suelta, la suya. Las que ni esquivando
	// quedan libres de objetos no se tocan: ahí el problema es el layout.
	const inFan = new Set(fans.flatMap((fan) => fan.indexes))
	const hopeless = new Set(stubborn)
	const units = [
		...fans.map((fan) => ({
			fan: true,
			members: fan.indexes.map((index) => ({ index, base: fan.shifts.get(index) })),
		})),
		...references
			.map((_, index) => index)
			.filter((index) => !inFan.has(index) && !hopeless.has(index) && paths[index])
			.map((index) => ({ fan: false, members: [{ index, base: 0 }] })),
	]

	const crossingsOfUnit = (unit, pointOf) => unit.members.reduce((total, member) => {
		const point = pointOf?.(member.index)
		return total + crossingsOf(member.index, point ? [point.from, point.at, point.to] : paths[member.index])
	}, 0)

	for (let pass = 0; pass < UNTANGLE_PASSES; pass++) {
		let improved = false
		for (const unit of units) {
			const crossings = crossingsOfUnit(unit)
			if (!crossings) continue

			const first = references[unit.members[0].index]
			const from = centerOf(first.from)
			const to = centerOf(first.to)
			if (!from || !to) continue
			const perpendicular = perpendicularOf(from, to)
			const own = new Set([first.from, first.to])

			// de menor a mayor desvío: el que menos se nota y alcanza. Para un abanico
			// el paso 0 ya es un candidato: correrlo a lo largo de la recta, sin abrirlo más.
			let best
			for (let step = unit.fan ? 0 : 1; step <= UNTANGLE_STEPS && !best?.clean; step++) {
				for (const along of UNTANGLE_ALONG) {
					for (const side of [1, -1]) {
						if (!step && side < 0) continue
						const anchor = { x: from.x + (to.x - from.x) * along, y: from.y + (to.y - from.y) * along }
						const points = new Map()
						for (const member of unit.members) {
							const shift = member.base + step * DODGE_STEP * side
							const at = {
								x: Math.round(anchor.x + perpendicular.x * shift),
								y: Math.round(anchor.y + perpendicular.y * shift),
							}
							if (blocked([from, at], shapes, own) || blocked([at, to], shapes, own)) break
							points.set(member.index, { from, at, to })
						}
						if (points.size < unit.members.length) continue
						const left = crossingsOfUnit(unit, (index) => points.get(index))
						if (left >= crossings || (best && left >= best.left)) continue
						best = { points, left, clean: left === 0 }
						if (best.clean) break
					}
					if (best?.clean) break
				}
			}
			if (!best) continue
			for (const [index, point] of best.points) {
				waypoints.set(index, point.at)
				paths[index] = [point.from, point.at, point.to]
			}
			improved = true
		}
		if (!improved) return
	}
}

/**
 * El punto por el que tiene que pasar cada flecha, si es que tiene que pasar por
 * alguno. Las que salen derecho no llevan waypoint: así el archivo no cambia
 * para los diagramas que ya estaban bien.
 *
 * @param centerOf  (id) -> { x, y } absoluto del centro, o undefined
 * @param shapes    [{ id, x, y, width, height, ellipse }] con x,y en el centro
 * @returns { waypoints: Map(indice -> punto), stubborn: [indices] }
 */
export const routeReferences = (references, centerOf, shapes) => {
	const waypoints = new Map()
	const fans = fanOutParallels(references, centerOf, waypoints)
	const stubborn = dodgeObstacles(references, centerOf, shapes, waypoints)
	untangleCrossings(references, centerOf, shapes, waypoints, fans, stubborn)
	return { waypoints, stubborn }
}
