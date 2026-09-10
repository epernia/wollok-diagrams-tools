/*
 * Ruteo: por donde va cada flecha.
 *
 * Existe porque mxGraph NO esquiva obstaculos. Su ruteador ortogonal
 * (`OrthConnector`) recibe solamente el estado de la caja de origen y el de la
 * de destino: no consulta el resto del dibujo, no hace pathfinding y no tiene
 * forma de saber que hay una caja en el medio. Si no le decimos por donde ir,
 * las flechas cruzan por arriba de las cajas — que es exactamente lo que se veia
 * antes.
 *
 * Asi que las esquinas se calculan aca y se emiten como waypoints explicitos.
 *
 * La forma de cada asociacion es la de un diagrama de clases hecho a mano:
 *
 *      juliana                          samsung
 *    ┌──────────────┐                 ┌───────────┐
 *    │  «WKO»       │      celular    │  «WKO»    │   la punta pincha
 *    ├──────────────┤   ┌────────────►│  samsung  │   la BANDA DEL TITULO
 *    │ var celular ─┼───┘             ├───────────┤
 *    │ var empresa ─┼───┐             │ ...       │
 *    └──────────────┘   │  sale a la altura de la fila
 *                       │  donde esta declarado el atributo
 *                       │             personal
 *                       │           ┌───────────┐
 *                       └──────────►│ personal  │
 *                     el tramo vertical baja por el
 *                     pasillo vacio entre columnas
 *
 * El router no confia en el layout: para cada flecha BUSCA un pasillo libre en
 * la geometria real y VERIFICA que ningun tramo toque una caja ajena. Por eso
 * sigue funcionando despues de que movas las cajas a mano y regeneres.
 */

import { attributeCenterOf } from './layout.mjs'

const JETTY = 20          // tramo recto minimo al salir/entrar de una caja
const LANE_STEP = 20      // separacion entre dos flechas que bajan por el mismo pasillo
const PAD = 12            // aire que se le exige a las cajas ajenas
const EPSILON = 0.5

const STRUCTURAL = ['inheritance', 'realization', 'mixin']

// ---------- geometria ----------

const rectOf = (box, position) => ({
	name: box.name, x: position.x, y: position.y, width: box.width, height: box.height,
	right: position.x + box.width, bottom: position.y + box.height,
})

/** Los tramos de una ruta, como pares de puntos. */
export const segmentsOf = (route) => {
	const points = [route.exit, ...route.points, route.entry]
	return points.slice(0, -1).map((point, i) => [point, points[i + 1]])
}

/** Si un tramo (horizontal o vertical) toca el rectangulo de una caja. */
const touches = ([a, b], rect) => {
	const x = [Math.min(a.x, b.x), Math.max(a.x, b.x)]
	const y = [Math.min(a.y, b.y), Math.max(a.y, b.y)]
	return x[0] < rect.right - EPSILON && x[1] > rect.x + EPSILON
		&& y[0] < rect.bottom - EPSILON && y[1] > rect.y + EPSILON
}

/** Las cajas ajenas que toca una ruta (las dos puntas no cuentan). */
export const collisionsOf = (route, rects) => {
	const own = new Set([route.relation.from, route.relation.to])
	const hit = []
	for (const segment of segmentsOf(route)) {
		for (const rect of rects) {
			if (own.has(rect.name)) continue
			if (touches(segment, rect)) hit.push(rect.name)
		}
	}
	return hit
}

/**
 * Los huecos libres de un intervalo, sacando los que ocupan los bloqueadores.
 * @param blockers [[desde, hasta]] ordenados o no
 */
const gapsIn = ([from, to], blockers) => {
	const busy = blockers
		.map(([a, b]) => [a - PAD, b + PAD])
		.filter(([a, b]) => b > from && a < to)
		.sort((p, q) => p[0] - q[0])
	const gaps = []
	let cursor = from
	for (const [a, b] of busy) {
		if (a > cursor) gaps.push([cursor, Math.min(a, to)])
		cursor = Math.max(cursor, b)
		if (cursor >= to) break
	}
	if (cursor < to) gaps.push([cursor, to])
	return gaps.filter(([a, b]) => b - a > 1)
}

/** Franjas verticales libres entre dos X, para un tramo que va de y1 a y2. */
const freeColumns = (rects, y1, y2, from, to) => {
	const [top, bottom] = [Math.min(y1, y2), Math.max(y1, y2)]
	const blockers = rects
		.filter((rect) => rect.y < bottom + PAD && rect.bottom > top - PAD)
		.map((rect) => [rect.x, rect.right])
	return gapsIn([from, to], blockers)
}

/** Franjas horizontales libres entre dos Y, para un tramo que va de x1 a x2. */
const freeRows = (rects, x1, x2, from, to) => {
	const [left, right] = [Math.min(x1, x2), Math.max(x1, x2)]
	const blockers = rects
		.filter((rect) => rect.x < right + PAD && rect.right > left - PAD)
		.map((rect) => [rect.y, rect.bottom])
	return gapsIn([from, to], blockers)
}

/**
 * Las posiciones candidatas dentro de un hueco: primero el centro y despues
 * abriendose hacia los costados de a LANE_STEP. Asi dos flechas que comparten
 * pasillo no se superponen (la segunda toma el carril de al lado).
 */
const lanesIn = ([from, to]) => {
	const center = (from + to) / 2
	const room = Math.floor((to - from) / 2 / LANE_STEP)
	const lanes = [center]
	for (let k = 1; k <= room; k++) lanes.push(center + k * LANE_STEP, center - k * LANE_STEP)
	return lanes.filter((x) => x > from && x < to)
}

// ---------- las rutas ----------

/** Un carril ya usado: para no dibujar dos flechas encimadas en el mismo x. */
const occupied = (taken, x, y1, y2) => taken.some((leg) =>
	Math.abs(leg.x - x) < LANE_STEP - 1
	&& Math.min(y1, y2) < leg.bottom + EPSILON && Math.max(y1, y2) > leg.top - EPSILON)

/**
 * Arma la ruta de una asociacion probando formas en orden de preferencia:
 * recta, ele/zeta por un solo pasillo, y escalera por dos pasillos. Se queda
 * con la primera que no toca ninguna caja ajena.
 */
const routeAssociation = (route, rects, taken) => {
	const { exit, entry } = route
	const others = rects.filter((rect) => rect.name !== route.relation.from && rect.name !== route.relation.to)
	const clean = (points) => {
		const candidate = { ...route, points }
		return !collisionsOf(candidate, others).length
	}

	// 1. recta: el destino quedo justo a la altura de la fila
	if (Math.abs(exit.y - entry.y) < EPSILON && clean([])) return []

	// 2. una sola vertical, por un pasillo entre las dos cajas
	const [from, to] = exit.x <= entry.x
		? [exit.x + JETTY, entry.x - JETTY]
		: [entry.x + JETTY, exit.x - JETTY]
	if (to > from) {
		for (const gap of freeColumns(others, exit.y, entry.y, from, to)) {
			for (const x of lanesIn(gap)) {
				if (occupied(taken, x, exit.y, entry.y)) continue
				const points = [{ x, y: exit.y }, { x, y: entry.y }]
				if (clean(points)) {
					taken.push({ x, top: Math.min(exit.y, entry.y), bottom: Math.max(exit.y, entry.y) })
					return points
				}
			}
		}
	}

	// 3. escalera: baja por un pasillo cerca del origen, cruza por una franja
	//    horizontal libre y vuelve a bajar cerca del destino. Es lo que hace
	//    falta cuando la flecha salta mas de una columna.
	const near = exit.x <= entry.x
		? freeColumns(others, exit.y, exit.y, exit.x + JETTY, entry.x - JETTY)
		: freeColumns(others, exit.y, exit.y, entry.x + JETTY, exit.x - JETTY)
	const far = exit.x <= entry.x
		? freeColumns(others, entry.y, entry.y, exit.x + JETTY, entry.x - JETTY)
		: freeColumns(others, entry.y, entry.y, entry.x + JETTY, exit.x - JETTY)
	for (const first of near.slice(0, 6)) {
		for (const last of [...far].reverse().slice(0, 6)) {
			const x1 = (first[0] + first[1]) / 2
			const x2 = (last[0] + last[1]) / 2
			if (Math.abs(x1 - x2) < LANE_STEP) continue
			const band = freeRows(others, x1, x2, Math.min(exit.y, entry.y) - 400, Math.max(exit.y, entry.y) + 400)
			for (const gap of band) {
				const y = (gap[0] + gap[1]) / 2
				const points = [{ x: x1, y: exit.y }, { x: x1, y }, { x: x2, y }, { x: x2, y: entry.y }]
				if (clean(points)) {
					taken.push({ x: x1, top: Math.min(exit.y, y), bottom: Math.max(exit.y, y) })
					taken.push({ x: x2, top: Math.min(y, entry.y), bottom: Math.max(y, entry.y) })
					return points
				}
			}
		}
	}
	return undefined
}

/**
 * Herencia y realizacion: sale por arriba del hijo, sube hasta el tronco, cruza
 * y entra por abajo del padre. Todos los hermanos comparten la altura del
 * tronco, asi que los tramos horizontales se superponen y se ve como un unico
 * peine con una sola punta — el aspecto clasico de UML.
 *
 * Si el tronco choca contra algo (una nota, por ejemplo) se prueban otras
 * alturas. Lo que NUNCA se hace es quedarse sin waypoints: sin ellos la arista
 * queda como una diagonal de punta a punta, que es peor que cualquier rodeo.
 */
const routeStructural = (route, parent, child, others) => {
	const cx = child.x + child.width / 2
	const px = parent.x + parent.width / 2
	if (Math.abs(cx - px) < EPSILON) return []          // justo debajo: recta vertical

	const top = parent.bottom
	const bottom = child.y > parent.bottom ? child.y : parent.bottom + 2 * JETTY
	const middle = (top + bottom) / 2
	const candidates = [middle]
	for (let k = 1; k <= 5; k++) candidates.push(middle + k * 6, middle - k * 6)

	for (const y of candidates) {
		if (y <= top + 2 || y >= bottom - 2) continue
		const points = [{ x: cx, y }, { x: px, y }]
		if (!collisionsOf({ ...route, points }, others).length) return points
	}
	return [{ x: cx, y: middle }, { x: px, y: middle }]
}

/**
 * Calcula la ruta de todas las relaciones.
 *
 * @returns { routes, warnings }
 *   route = { relation, index, structural, exitSide, entrySide, exitOffset,
 *             entryOffset, exit, entry, points }
 */
export const routeAll = (boxes, relations, positions, obstacles = []) => {
	const byName = new Map(boxes.map((box) => [box.name, box]))
	const rectOfName = new Map(boxes
		.filter((box) => positions.has(box.name))
		.map((box) => [box.name, rectOf(box, positions.get(box.name))]))
	// las notas no son cajas del modelo, pero ocupan lugar y hay que esquivarlas
	const rects = [...rectOfName.values(), ...obstacles]
	const known = (relation) => rectOfName.has(relation.from) && rectOfName.has(relation.to)

	const routes = []
	const warnings = []
	const taken = []

	// --- estructurales: el peine de flechas huecas hacia el padre ---
	relations.forEach((relation, index) => {
		if (!STRUCTURAL.includes(relation.kind) || !known(relation)) return
		const parent = rectOfName.get(relation.from)
		const child = rectOfName.get(relation.to)
		const route = {
			relation, index, structural: true,
			exitSide: 'top', entrySide: 'bottom',
			exit: { x: child.x + child.width / 2, y: child.y },
			entry: { x: parent.x + parent.width / 2, y: parent.bottom },
		}
		const others = rects.filter((rect) => rect.name !== relation.from && rect.name !== relation.to)
		route.points = routeStructural(route, parent, child, others)
		if (collisionsOf(route, rects).length) warnings.push(descriptionOf(relation))
		routes.push(route)
	})

	// --- asociaciones ---
	// Las que entran por el mismo lado de la misma caja se reparten sobre la
	// banda del titulo, para que no caigan todas en el mismo punto.
	const associations = relations
		.map((relation, index) => ({ relation, index }))
		.filter(({ relation }) => !STRUCTURAL.includes(relation.kind) && known(relation))

	const sideOf = ({ relation }) => {
		const source = rectOfName.get(relation.from)
		const target = rectOfName.get(relation.to)
		if (relation.from === relation.to) return { exit: 'right', entry: 'right' }
		if (target.x >= source.right) return { exit: 'right', entry: 'left' }
		if (target.right <= source.x) return { exit: 'left', entry: 'right' }
		return { exit: 'left', entry: 'left' }
	}

	const entryOffsets = new Map()
	const groups = new Map()
	for (const item of associations) {
		const key = `${item.relation.to}|${sideOf(item).entry}`
		groups.set(key, [...(groups.get(key) ?? []), item])
	}
	for (const [, list] of groups) {
		const header = byName.get(list[0].relation.to).headerHeight
		list.sort((a, b) => a.index - b.index)
		list.forEach((item, i) => entryOffsets.set(item.index, Math.round((header * (i + 1)) / (list.length + 1))))
	}

	// Sin la fila del atributo (--associations=arrow, --no-attributes) no hay
	// altura a la que salir. Para que dos flechas del mismo objeto no arranquen
	// del mismo punto, se reparten sobre el costado.
	const fallbackExits = new Map()
	const outgoing = new Map()
	for (const item of associations) {
		if (attributeCenterOf(byName.get(item.relation.from), item.relation.fromAttribute) !== undefined) continue
		const key = `${item.relation.from}|${sideOf(item).exit}`
		outgoing.set(key, [...(outgoing.get(key) ?? []), item])
	}
	for (const [, list] of outgoing) {
		const source = byName.get(list[0].relation.from)
		list.sort((a, b) => a.index - b.index)
		list.forEach((item, i) => fallbackExits.set(item.index,
			Math.round((source.height * (i + 1)) / (list.length + 1))))
	}

	for (const item of associations) {
		const { relation, index } = item
		const source = byName.get(relation.from)
		const target = byName.get(relation.to)
		const sourceRect = rectOfName.get(relation.from)
		const targetRect = rectOfName.get(relation.to)
		const sides = sideOf(item)

		const exitOffset = attributeCenterOf(source, relation.fromAttribute)
			?? fallbackExits.get(index)
			?? source.headerHeight / 2
		const entryOffset = entryOffsets.get(index) ?? target.headerHeight / 2
		const route = {
			relation, index, structural: false,
			exitSide: sides.exit, entrySide: sides.entry,
			exitOffset, entryOffset,
			exit: { x: sides.exit === 'right' ? sourceRect.right : sourceRect.x, y: sourceRect.y + exitOffset },
			entry: { x: sides.entry === 'right' ? targetRect.right : targetRect.x, y: targetRect.y + entryOffset },
			points: [],
		}

		if (relation.from === relation.to) {
			// auto-relacion: un lazo pegadito al costado derecho, sin ir hasta el pasillo
			const lane = taken.filter((leg) => Math.abs(leg.x - (sourceRect.right + JETTY)) < 1).length
			const x = sourceRect.right + JETTY + lane * LANE_STEP
			route.points = [{ x, y: route.exit.y }, { x, y: route.entry.y }]
			taken.push({ x, top: Math.min(route.exit.y, route.entry.y), bottom: Math.max(route.exit.y, route.entry.y) })
		} else {
			const points = routeAssociation(route, rects, taken)
			if (points === undefined) {
				// No hay camino limpio (pasa cuando se movieron cajas a mano y una
				// quedo tapando el paso). Igual se dibuja en angulo recto: dejarla sin
				// waypoints la convierte en una diagonal de punta a punta, que se ve
				// mucho peor que un rodeo.
				const middle = (route.exit.x + route.entry.x) / 2
				route.points = [{ x: middle, y: route.exit.y }, { x: middle, y: route.entry.y }]
				warnings.push(descriptionOf(relation))
			} else {
				route.points = points
			}
		}
		routes.push(route)
	}

	return { routes, warnings, rects }
}

const descriptionOf = (relation) =>
	`${relation.from} -> ${relation.to}${relation.label ? ` (${relation.label})` : ''}`

/** Cuantos tramos de flecha quedaron encima de una caja ajena. */
export const countCollisions = (routes, rects) =>
	routes.reduce((total, route) => total + collisionsOf(route, rects).length, 0)
