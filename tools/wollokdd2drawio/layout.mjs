/*
 * Dónde va cada cosa.
 *
 * El layout es RADIAL: cada objeto que referencia a otros queda de un lado, y
 * los referenciados se abren en abanico sobre el perímetro de un círculo
 * imaginario, del lado opuesto a por donde le entra su propia flecha.
 *
 *                                    ( unMensajero )
 *                                   ╱
 *   hollimensajeros ──► ( unSet ) ──── ( unMensajero )
 *                                   ╲
 *                                    ( unMensajeroConTransporte )
 *
 * Con eso salen casi gratis tres de las pautas: los referenciados quedan cerca
 * del que los referencia, repartidos sin pisarse, y las flechas de un árbol
 * radial no se cruzan entre sí. La cuarta —agrupar los polimórficos— se
 * consigue ordenando los hermanos por familia antes de repartir el arco.
 *
 * Después de ubicar todo hay una pasada de relajación que separa lo que haya
 * quedado encimado (dos ramas distintas pueden chocar), y otra que empuja los
 * objetos hacia el lado del que los referencia para acortar las flechas.
 *
 * Las coordenadas de los objetos son RELATIVAS al ambiente (es un contenedor de
 * draw.io, así se puede mover todo junto). Las de las etiquetas globales son
 * absolutas, porque viven afuera.
 */

import { textWidthOf } from '../wollok-uml/text-width.mjs'
import { PARALLEL_GAP } from './routing.mjs'

const CHARACTER_WIDTH = 8.2   // calibrado para la letra de 14px del render
const MIN_WIDTH = 104
const MAX_WIDTH = 240
const HEIGHT = 62
const WKO_CIRCLE = 40         // los WKO y los booleanos
const COLLECTION_CIRCLE = 50  // las List y los Set
const DICTIONARY_CIRCLE = 80  // un Dictionary tiene más adentro, y se nota

// Los literales que se estiran: un número y un string son del alto de un círculo,
// pero crecen a lo ancho con lo que tienen adentro.
//
// Un número entra en 40 hasta los 4 dígitos y recién ahí empieza a crecer, 10 px
// por dígito: eso deja "1000000" en 70, que es el punto que medimos a mano, y
// además le gana al ancho real del texto (~8.2 px por carácter a 14px), así que
// nunca se desborda.
const FLAT_HEIGHT = 40
const FLAT_MIN_WIDTH = 40
const NUMBER_FREE_DIGITS = 4
const NUMBER_PER_DIGIT = 10

const GAP = 46                // separación mínima entre dos objetos
const MIN_RADIUS = 130
const MAX_RADIUS = 430        // tope: mas lejos no aporta, solo agranda el dibujo
const ROOT_ARC = Math.PI * 1.7        // ~305°: un raíz puede abrirse casi entero
const BRANCH_ARC = Math.PI * 0.95     // ~170°: una rama se abre hacia afuera
const MIN_ARC = Math.PI * 0.45        // el piso del sector que hereda un hijo
const TREE_GAP = 70
const MAX_COLUMN_HEIGHT = 900

const PADDING = 44            // margen interno del ambiente
const AMBIENTE_MARGIN = 30    // desde el borde del canvas hasta el ambiente
const LABEL_HEIGHT = 26
const LABEL_MIN_WIDTH = 60
const LABEL_GAP = 60          // separación entre la etiqueta global y el ambiente
const LABEL_SEPARATION = 14   // entre dos etiquetas del mismo borde
const PADLOCK_WIDTH = 16      // el candado de las const es más ancho que una letra

// El rotulo de una flecha entre objetos: draw.io lo escribe a 14px, centrado en la
// mitad del recorrido y con fondo blanco. text-width.mjs mide a 12px, asi que se
// escala; el candado se suma aparte porque es un emoji y la tabla no lo conoce.
const ARROW_FONT_SCALE = 14 / 12
const ARROW_PADLOCK_WIDTH = 17
const ARROW_LABEL_BACKGROUND = 4   // el fondo blanco asoma 2px por lado
const ARROW_LABEL_HEIGHT = 17      // un renglon de 14px
const ARROW_LABEL_AIR = 9          // la flecha que se tiene que ver entre el rotulo y cada objeto

/**
 * Los booleanos y las colecciones van como círculos: su etiqueta es corta y
 * fija, no hay nada que dimensionar.
 *
 * Los WKO NO: adentro llevan su propio nombre, y de 36 objetos del repo sólo
 * tres entran en 40 px. Así que son óvalos que crecen a lo ancho manteniendo los
 * 40 de alto — los cortos (`tom`, `pepe`) siguen saliendo redondos, y los largos
 * se estiran en vez de desbordarse.
 */
export const isCircle = (object) =>
	object.kind === 'collection' || object.module === 'wollok.lang.Boolean'

const diameterOf = (object) => {
	if (object.module === 'wollok.lang.Dictionary') return DICTIONARY_CIRCLE
	return object.kind === 'collection' ? COLLECTION_CIRCLE : WKO_CIRCLE
}

const isWko = (object) => object.kind === 'wko'

const isNumber = (object) => object.module === 'wollok.lang.Number'
const isString = (object) => object.module === 'wollok.lang.String'

/** Ancho de un literal que se estira: nunca menos de 40, nunca más que el tope. */
const flatWidth = (needed) =>
	Math.min(MAX_WIDTH, Math.max(FLAT_MIN_WIDTH, Math.round(needed)))

/** El tamaño con el que se dibuja. */
export const sizeOf = (object) => {
	if (isCircle(object)) return { width: diameterOf(object), height: diameterOf(object) }

	const characters = object.label.length
	// el WKO se dimensiona como un literal que se estira: alto de circulo, ancho
	// segun el nombre, y nunca menos de 40 para que los cortos queden redondos
	if (isWko(object)) return {
		width: flatWidth(characters * CHARACTER_WIDTH + 14),
		height: FLAT_HEIGHT,
	}
	if (isNumber(object)) return {
		width: flatWidth(FLAT_MIN_WIDTH + Math.max(0, characters - NUMBER_FREE_DIGITS) * NUMBER_PER_DIGIT),
		height: FLAT_HEIGHT,
	}
	if (isString(object)) return {
		width: flatWidth(characters * CHARACTER_WIDTH + 14),
		height: FLAT_HEIGHT,
	}
	return {
		width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(characters * CHARACTER_WIDTH + 34))),
		height: HEIGHT,
	}
}

/**
 * El tamaño que ocupa para el layout. En un círculo la etiqueta puede salirse un
 * poco ("unDictionary" no entra en 80px), así que para separarlo de sus vecinos
 * se usa el ancho del texto y no el del círculo.
 */
const spacingSizeOf = (object) => {
	const drawn = sizeOf(object)
	return { width: Math.max(drawn.width, object.label.length * CHARACTER_WIDTH + 8), height: drawn.height }
}

const extentOf = (size) => Math.max(size.width, size.height)

// ---------- los rotulos de las flechas ----------

/*
 * Una flecha tiene que ser MAS LARGA que su rotulo.
 *
 * draw.io escribe el nombre de la referencia en la mitad de la flecha, con fondo
 * blanco. Si la flecha es corta, el rotulo se come las puntas y se lee mal:
 *
 *   (camion)-(0)              (camion)---cantidadDeAcoplados--->(0)
 *   "camcantidadDeAcoplados"
 *
 * Cuanto hace falta depende de la DIRECCION: un rotulo es ancho y bajo, asi que
 * acostado necesita mucho mas largo que parado. Por eso no se suma un numero fijo
 * sino que se mide, para la direccion que tiene la flecha, a que distancia del
 * centro de cada punta el rotulo deja de tocarla.
 */

/** El tamanio del rotulo tal como se dibuja, o undefined si la flecha no lleva nombre. */
const arrowLabelSizeOf = (reference, padlock) => {
	const text = String(reference.label ?? '')
	if (!text) return undefined
	const padlocked = padlock && reference.constant
	return {
		width: textWidthOf(text) * ARROW_FONT_SCALE + (padlocked ? ARROW_PADLOCK_WIDTH : 0) + ARROW_LABEL_BACKGROUND,
		height: ARROW_LABEL_HEIGHT,
	}
}

const pairKey = (a, b) => (a < b ? `${a}--${b}` : `${b}--${a}`)

/**
 * Las flechas con nombre, una por PAR de objetos. Si dos referencias unen el mismo
 * par (en cualquier sentido) van una arriba de la otra, y manda la del rotulo mas
 * ancho: es la que mas largo pide.
 */
const labeledArrowsOf = (model, padlock) => {
	const known = new Set(model.objects.map((object) => object.id))
	const fans = new Map()
	for (const reference of model.references) {
		if (reference.from === reference.to || !known.has(reference.from) || !known.has(reference.to)) continue
		const key = `${reference.from}->${reference.to}`
		fans.set(key, [...(fans.get(key) ?? []), reference])
	}
	const byPair = new Map()
	for (const fan of fans.values()) {
		const { from, to } = fan[0]
		const key = pairKey(from, to)
		const entry = byPair.get(key) ?? { from, to, label: undefined, labels: [] }
		fan.forEach((reference, index) => {
			const size = arrowLabelSizeOf(reference, padlock)
			if (!size) return
			entry.labels.push({ from, to, size, shift: (index - (fan.length - 1) / 2) * PARALLEL_GAP })
			if (!entry.label || entry.label.width < size.width) entry.label = size
		})
		if (entry.label) byPair.set(key, entry)
	}
	return byPair
}

/**
 * Si el rotulo, centrado en `at`, toca la elipse de un objeto agrandada por el aire.
 * Se lleva la elipse al circulo unitario dividiendo por los semiejes: el rotulo
 * sigue siendo un rectangulo, y alcanza con ver si su punto mas cercano al centro
 * cae adentro.
 */
const labelTouches = (label, at, center, size) => {
	const rx = size.width / 2 + ARROW_LABEL_AIR
	const ry = size.height / 2 + ARROW_LABEL_AIR
	const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
	const nearestX = clamp(0, (at.x - label.width / 2 - center.x) / rx, (at.x + label.width / 2 - center.x) / rx)
	const nearestY = clamp(0, (at.y - label.height / 2 - center.y) / ry, (at.y + label.height / 2 - center.y) / ry)
	return nearestX * nearestX + nearestY * nearestY < 1
}

/**
 * A que distancia del centro de un objeto, yendo en la direccion (dx, dy), el
 * rotulo deja de tocarlo. Las posiciones donde lo toca forman una figura convexa
 * alrededor del centro, asi que el camino sale de ella una sola vez y se puede
 * buscar partiendo al medio.
 */
const reachOf = (size, label, dx, dy) => {
	const center = { x: 0, y: 0 }
	let [inside, outside] = [0, size.width + size.height + label.width + label.height + 2 * ARROW_LABEL_AIR]
	for (let step = 0; step < 18; step++) {
		const middle = (inside + outside) / 2
		if (labelTouches(label, { x: dx * middle, y: dy * middle }, center, size)) inside = middle
		else outside = middle
	}
	return outside
}

/**
 * Lo que tiene que medir, de centro a centro, una flecha con esa direccion para que
 * su rotulo entre sin tocar ninguna punta. Se mide con los centros y no con los
 * bordes, que es donde draw.io la corta de verdad: el rotulo es el mismo en las dos
 * puntas, y con eso la cuenta por centros es la mas exigente de las dos.
 */
const arrowLengthFor = (arrow, spacing, dx, dy) => 2 * Math.max(
	reachOf(spacing.get(arrow.from), arrow.label, dx, dy),
	reachOf(spacing.get(arrow.to), arrow.label, dx, dy),
)

// ---------- el bosque de referencias ----------

/**
 * Arma el árbol que se va a dibujar: cada objeto cuelga del primero que lo
 * referencia. Las raíces son los que nadie referencia (los que solo tienen su
 * nombre global), que es lo que uno espera ver arriba de todo.
 */
const forestOf = (model) => {
	const known = new Set(model.objects.map((object) => object.id))
	const children = new Map(model.objects.map((object) => [object.id, []]))
	const outgoing = new Map(model.objects.map((object) => [object.id, []]))
	const incoming = new Map(model.objects.map((object) => [object.id, 0]))

	for (const reference of model.references) {
		if (!known.has(reference.from) || !known.has(reference.to)) continue
		outgoing.get(reference.from).push(reference.to)
		incoming.set(reference.to, incoming.get(reference.to) + 1)
	}

	// las raíces primero: las que tienen nombre global, después el resto
	const globalOrder = new Map(model.globals.map((global, index) => [global.to, index]))
	const candidates = model.objects
		.filter((object) => incoming.get(object.id) === 0)
		.sort((a, b) => (globalOrder.get(a.id) ?? Infinity) - (globalOrder.get(b.id) ?? Infinity))
		.map((object) => object.id)

	const seen = new Set()
	const roots = []
	const walk = (start) => {
		if (seen.has(start)) return
		seen.add(start)
		roots.push(start)
		const queue = [start]
		while (queue.length) {
			const id = queue.shift()
			for (const next of outgoing.get(id)) {
				if (seen.has(next)) continue
				seen.add(next)
				children.get(id).push(next)
				queue.push(next)
			}
		}
	}
	for (const id of candidates) walk(id)
	// lo que quedó en un ciclo también necesita una raíz
	for (const object of model.objects) walk(object.id)

	return { children, roots }
}

/** Hermanos de la misma familia, juntos: es la pauta de agrupar los polimórficos. */
const groupByFamily = (children, model) => {
	const familyOf = new Map(model.objects.map((object) => [object.id, object.family]))
	const order = new Map()
	for (const [, kids] of children) {
		for (const kid of kids) {
			const family = familyOf.get(kid)
			if (!order.has(family)) order.set(family, order.size)
		}
	}
	for (const [, kids] of children) {
		kids.sort((a, b) => (order.get(familyOf.get(a)) ?? 0) - (order.get(familyOf.get(b)) ?? 0))
	}
}

// ---------- ubicación radial ----------

/** Los ángulos de k hijos repartidos en un arco, centrado en la dirección de salida. */
const anglesFor = (count, outward, arc) => {
	if (count === 1) return [outward]
	const step = arc / (count - 1)
	return Array.from({ length: count }, (_, index) => outward - arc / 2 + step * index)
}

/**
 * Radio que hace falta para que los hijos no se toquen entre sí ni con el padre.
 *
 * El radio está topeado: si el arco es angosto, la cuenta de la cuerda pide un
 * radio enorme y el dibujo se desarma. Es preferible dejar que queden un poco
 * encimados y que la relajación posterior los separe.
 */
const radiusFor = (node, kids, arc, spacing) => {
	const biggest = Math.max(...kids.map((kid) => extentOf(spacing.get(kid))))
	const own = extentOf(spacing.get(node))
	const byParent = own / 2 + biggest / 2 + GAP
	if (kids.length < 2) return Math.min(MAX_RADIUS, Math.max(byParent, MIN_RADIUS))
	// cuerda entre dos hijos vecinos = 2 * R * sen(paso / 2)
	const step = arc / (kids.length - 1)
	const byChord = (biggest + GAP) / (2 * Math.sin(Math.min(step, Math.PI) / 2))
	return Math.min(MAX_RADIUS, Math.max(byParent, byChord, MIN_RADIUS))
}

/**
 * Ubica un árbol en coordenadas locales, con la raíz en el origen.
 *
 * El radio del abanico es uno para todos los hermanos, pero el hijo cuya flecha
 * lleva un rotulo que no entra se aleja lo que haga falta, en su misma direccion:
 * asi un `cantidadDeAcoplados` no arrastra a sus hermanos de nombre corto.
 */
const placeTree = (root, children, spacing, arrows) => {
	const points = new Map([[root, { x: 0, y: 0 }]])

	const walk = (node, outward, sector) => {
		const kids = children.get(node) ?? []
		if (!kids.length) return

		// con un solo hijo no hay abanico: sale derecho hacia afuera
		const arc = kids.length === 1 ? 0 : Math.min(sector, BRANCH_ARC)
		const radius = radiusFor(node, kids, arc || MIN_ARC, spacing)
		const center = points.get(node)
		const angles = anglesFor(kids.length, outward, arc)

		// La porción que hereda cada hijo es generosa a propósito: apretarla haría
		// que un nieto con muchos hijos necesitara un radio enorme. Prefiero arcos
		// anchos y que la relajación arregle lo que se encime.
		const share = kids.length === 1
			? Math.min(BRANCH_ARC, sector)
			: Math.min(BRANCH_ARC, Math.max(MIN_ARC, (arc / kids.length) * 1.6))

		kids.forEach((kid, index) => {
			const angle = angles[index]
			const arrow = arrows.get(pairKey(node, kid))
			const [dx, dy] = [Math.cos(angle), Math.sin(angle)]
			const distance = arrow ? Math.max(radius, arrowLengthFor(arrow, spacing, dx, dy)) : radius
			points.set(kid, {
				x: center.x + distance * dx,
				y: center.y + distance * dy,
			})
			walk(kid, angle, share)
		})
	}

	walk(root, 0, ROOT_ARC)
	return points
}

const boundingBox = (points, spacing) => {
	const values = [...points.entries()]
	const left = Math.min(...values.map(([id, at]) => at.x - spacing.get(id).width / 2))
	const right = Math.max(...values.map(([id, at]) => at.x + spacing.get(id).width / 2))
	const top = Math.min(...values.map(([id, at]) => at.y - spacing.get(id).height / 2))
	const bottom = Math.max(...values.map(([id, at]) => at.y + spacing.get(id).height / 2))
	return { left, right, top, bottom, width: right - left, height: bottom - top }
}

// ---------- relajación ----------

/** Cuánto pesa cada defecto al elegir dónde poner un compartido. */
const THROUGH_PENALTY = 3     // una flecha que parte un objeto al medio
const CROSSING_PENALTY = 1    // dos flechas que se cruzan
const LABEL_PENALTY = 2       // un rotulo que tapa un objeto, el suyo o uno ajeno

/** Las posiciones que se prueban, como fracción del camino hacia el promedio. */
const SHARED_CANDIDATES = [0, 0.25, 0.5, 0.75, 1]
const SHARED_PASSES = 3
const SWAP_PASSES = 3

const orient = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))

/** Si dos segmentos se cruzan de verdad (tocarse en una punta no cuenta). */
const segmentsCross = ([a, b], [c, d]) => {
	const [o1, o2] = [orient(a, b, c), orient(a, b, d)]
	const [o3, o4] = [orient(c, d, a), orient(c, d, b)]
	return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0
}

/**
 * Si un segmento atraviesa la caja de un objeto. Se compara contra el rectángulo
 * y no contra la elipse: acá alcanza y es barato, porque esto se llama muchas
 * veces y sólo sirve para COMPARAR posiciones entre sí, no para decidir el
 * dibujo final — de eso se encarga routing.mjs, que sí resuelve la elipse.
 */
const segmentHitsBox = ([a, b], center, size) => {
	const [left, right] = [center.x - size.width / 2, center.x + size.width / 2]
	const [top, bottom] = [center.y - size.height / 2, center.y + size.height / 2]
	let enter = 0
	let exit = 1
	for (const [p, q] of [[-(b.x - a.x), a.x - left], [b.x - a.x, right - a.x],
		[-(b.y - a.y), a.y - top], [b.y - a.y, bottom - a.y]]) {
		if (Math.abs(p) < 1e-9) {
			if (q < 0) return false
			continue
		}
		const t = q / p
		if (p < 0) enter = Math.max(enter, t)
		else exit = Math.min(exit, t)
		if (enter > exit) return false
	}
	return exit > 1e-9 && enter < 1 - 1e-9
}

/** Las referencias que se dibujan como flecha: de un objeto a otro distinto. */
const linksOf = (model, centers) => model.references
	.filter((reference) => reference.from !== reference.to
		&& centers.has(reference.from) && centers.has(reference.to))
	.map((reference) => [reference.from, reference.to])

/**
 * Cuántos defectos tiene el dibujo tal como está: flechas que parten un objeto al
 * medio y flechas que se cruzan. Es la vara con la que se aceptan o se descartan
 * los movimientos de abajo — ninguno se aplica por parecer buena idea.
 */
const scoreOf = (centers, links, spacing, arrows) => {
	const segments = links.map(([from, to]) => [centers.get(from), centers.get(to)])
	let total = 0
	for (const arrow of arrows.values()) {
		// cada rotulo donde va a quedar de verdad: las flechas que unen el mismo par
		// salen en abanico, y sus rotulos siguen a la flecha (ver fanOutParallels)
		for (const label of arrow.labels) {
			const [from, to] = [centers.get(label.from), centers.get(label.to)]
			if (!from || !to) continue
			const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
			const middle = {
				x: (from.x + to.x) / 2 - ((to.y - from.y) / length) * label.shift,
				y: (from.y + to.y) / 2 + ((to.x - from.x) / length) * label.shift,
			}
			for (const [id, at] of centers) {
				if (labelTouches(label.size, middle, at, spacing.get(id))) total += LABEL_PENALTY
			}
		}
	}
	for (let i = 0; i < segments.length; i++) {
		for (const [id, at] of centers) {
			if (links[i][0] === id || links[i][1] === id) continue
			if (segmentHitsBox(segments[i], at, spacing.get(id))) total += THROUGH_PENALTY
		}
		for (let j = i + 1; j < segments.length; j++) {
			if (links[i].some((end) => links[j].includes(end))) continue
			if (segmentsCross(segments[i], segments[j])) total += CROSSING_PENALTY
		}
	}
	return total
}

/** Un objeto y todo lo que cuelga de él: lo que se mueve junto. */
const branchOf = (id, centers, children) => {
	const all = []
	const queue = [id]
	while (queue.length) {
		const current = queue.shift()
		if (all.includes(current) || !centers.has(current)) continue
		all.push(current)
		queue.push(...(children.get(current) ?? []))
	}
	return all
}

const shiftBranch = (branch, centers, dx, dy) => {
	for (const member of branch) {
		centers.get(member).x += dx
		centers.get(member).y += dy
	}
}

/**
 * Acerca los objetos COMPARTIDOS a quienes los referencian.
 *
 * El árbol cuelga cada objeto del PRIMERO que lo alcanza, así que uno
 * referenciado por varios queda pegado a ese y los demás le tiran una flecha
 * larga que cruza medio dibujo. Y es un caso muy común sin que se note: Wollok no
 * crea dos números iguales, así que el 4 que es la batería de un celular es EL
 * MISMO objeto que la batería del otro.
 *
 *   antes                          después
 *   (samsung)--(4)                 (samsung)--(4)--(iphone)
 *      |          \                    |
 *   (juliana)      \                (juliana)
 *      |            \
 *   (iphone)---------'   <- esta flecha cruzaba todo
 *
 * Sólo se mueven los que NO tienen hijos: arrastrar una rama entera desarmaría
 * el abanico del que cuelga. Y el que quede encimado lo separa pullApart, que
 * corre justo después.
 */
const pullShared = (centers, model, children, spacing, arrows) => {
	const links = linksOf(model, centers)
	if (!links.length) return

	const referrers = new Map([...centers.keys()].map((id) => [id, new Set()]))
	for (const [from, to] of links) referrers.get(to).add(from)

	// El que tiene hijos también se puede mover: se translada la RAMA ENTERA, así
	// el abanico que cuelga de él se mantiene igual y sólo cambia de lugar. Mover
	// sólo la cabeza sí lo desarmaría.
	const movable = [...referrers]
		.filter(([, from]) => from.size > 1)
		.map(([id, from]) => ({ id, from: [...from], branch: branchOf(id, centers, children) }))
		// una rama que se lleva medio dibujo no es un ajuste, es otro layout
		.filter((entry) => entry.branch.length <= Math.max(3, centers.size / 4))
	if (!movable.length) return

	const score = () => scoreOf(centers, links, spacing, arrows)

	for (let pass = 0; pass < SHARED_PASSES; pass++) {
		let improved = false
		for (const { id, from, branch } of movable) {
			const origin = { x: centers.get(id).x, y: centers.get(id).y }
			const target = from.reduce((sum, other) => {
				const point = centers.get(other)
				return { x: sum.x + point.x / from.length, y: sum.y + point.y / from.length }
			}, { x: 0, y: 0 })
			const shift = (dx, dy) => shiftBranch(branch, centers, dx, dy)

			let best = { dx: 0, dy: 0, value: score() }
			let applied = { dx: 0, dy: 0 }
			for (const fraction of SHARED_CANDIDATES) {
				if (!fraction) continue
				const wanted = { dx: (target.x - origin.x) * fraction, dy: (target.y - origin.y) * fraction }
				shift(wanted.dx - applied.dx, wanted.dy - applied.dy)
				applied = wanted
				const value = score()
				// se acepta sólo si MEJORA: ante empate gana quedarse donde está,
				// que es la posición que el abanico radial eligió a propósito
				if (value < best.value) best = { ...wanted, value }
			}
			shift(best.dx - applied.dx, best.dy - applied.dy)
			if (best.dx || best.dy) improved = true
		}
		if (!improved) return
	}
}

/**
 * Prueba PERMUTAR dos hermanos del árbol.
 *
 * El abanico radial reparte a los hijos en el orden en que los encontró, que no
 * tiene nada que ver con dónde están los objetos a los que ellos apuntan. A veces
 * alcanza con cambiar dos de lugar para que dos flechas dejen de cruzarse, y el
 * dibujo queda igual de ordenado porque los lugares son los mismos.
 *
 *   antes                   después
 *   (a)   (b)               (a)   (b)
 *     \   /                   |   |
 *      \ /                    |   |
 *      / \                    |   |
 *   (b')  (a')              (a')  (b')
 *
 * Cada hermano se lleva su rama entera, y el cambio se acepta sólo si el dibujo
 * mide mejor.
 */
const swapSiblings = (centers, model, children, spacing, arrows) => {
	const links = linksOf(model, centers)
	if (!links.length) return

	const families = [...children.values()]
		.filter((siblings) => siblings.length > 1)
		.map((siblings) => siblings.filter((id) => centers.has(id)))
	if (!families.length) return

	let best = scoreOf(centers, links, spacing, arrows)
	for (let pass = 0; pass < SWAP_PASSES; pass++) {
		let improved = false
		for (const siblings of families) {
			for (let i = 0; i < siblings.length; i++) {
				for (let j = i + 1; j < siblings.length; j++) {
					const [here, there] = [branchOf(siblings[i], centers, children), branchOf(siblings[j], centers, children)]
					// ramas que se pisan no se pueden permutar de a una
					if (here.some((id) => there.includes(id))) continue
					const [from, to] = [centers.get(siblings[i]), centers.get(siblings[j])]
					const [dx, dy] = [to.x - from.x, to.y - from.y]
					shiftBranch(here, centers, dx, dy)
					shiftBranch(there, centers, -dx, -dy)
					const value = scoreOf(centers, links, spacing, arrows)
					if (value < best) {
						best = value
						improved = true
						continue
					}
					shiftBranch(here, centers, -dx, -dy)
					shiftBranch(there, centers, dx, dy)
				}
			}
		}
		if (!improved) return
	}
}

const TURN_STEPS = 16         // las direcciones que se prueban al girar una rama
const TURN_PASSES = 3

/** Si algun objeto de la rama quedo encimado con uno que no es de la rama. */
const branchOverlaps = (branch, centers, spacing) => {
	const members = new Set(branch)
	for (const id of branch) {
		const [a, sa] = [centers.get(id), spacing.get(id)]
		for (const [other, b] of centers) {
			if (members.has(other)) continue
			const sb = spacing.get(other)
			if (Math.abs(a.x - b.x) < (sa.width + sb.width) / 2 + GAP / 2
				&& Math.abs(a.y - b.y) < (sa.height + sb.height) / 2 + GAP / 2) return true
		}
	}
	return false
}

/**
 * GIRA una rama alrededor del padre, buscando un lugar mejor.
 *
 * Alargar una flecha para que entre su rotulo empuja al hijo hacia afuera, y a
 * veces lo deja justo donde molesta: encima del rotulo de otra flecha, o cruzando
 * una. Como el abanico radial ya eligio una direccion para cada hijo, lo que queda
 * es probar OTRAS direcciones para la rama entera, sin cambiar de padre:
 *
 *        (a)                       (a)
 *          \                          \
 *          (b)--largoNombre--(c)       (b)
 *                                        \
 *                                        (c)   <- mismo padre, otra direccion
 *
 * Cada giro se acepta solo si el dibujo mide mejor (scoreOf, que ahora tambien
 * cuenta los rotulos tapados) y si la rama no queda encimada con nada. El giro no
 * puede pasar por encima de un hermano: el orden del abanico se respeta.
 */
const turnBranches = (centers, model, children, spacing, arrows) => {
	const links = linksOf(model, centers)
	if (!links.length) return
	const score = () => scoreOf(centers, links, spacing, arrows)
	const limit = Math.max(3, centers.size / 4)
	const pairs = [...children].flatMap(([parent, kids]) => kids.map((kid) => [parent, kid, kids]))
		.filter(([parent, kid]) => centers.has(parent) && centers.has(kid))
	const angleOf = (from, to) => Math.atan2(to.y - from.y, to.x - from.x)

	let best = score()
	for (let pass = 0; pass < TURN_PASSES; pass++) {
		let improved = false
		for (const [parent, kid, kids] of pairs) {
			const branch = branchOf(kid, centers, children)
			if (branch.length > limit) continue
			const pivot = centers.get(parent)
			const here = angleOf(pivot, centers.get(kid))
			// hasta donde puede girar sin cruzar a un hermano
			let [ahead, back] = [Math.PI, Math.PI]
			const others = kids.filter((other) => other !== kid && centers.has(other))
				.map((other) => (angleOf(pivot, centers.get(other)) - here + 4 * Math.PI) % (2 * Math.PI))
			if (others.length) {
				ahead = Math.min(...others)
				back = 2 * Math.PI - Math.max(...others)
			}
			const saved = branch.map((id) => ({ ...centers.get(id) }))
			const restore = () => branch.forEach((id, i) => Object.assign(centers.get(id), saved[i]))
			const arrow = arrows.get(pairKey(parent, kid))
			let choice
			const current = best
			for (let step = 1; step < TURN_STEPS; step++) {
				const full = (2 * Math.PI * step) / TURN_STEPS
				const turn = full > Math.PI ? full - 2 * Math.PI : full
				if (turn >= ahead || -turn >= back) continue
				const [cos, sin] = [Math.cos(turn), Math.sin(turn)]
				branch.forEach((id, i) => {
					const [dx, dy] = [saved[i].x - pivot.x, saved[i].y - pivot.y]
					Object.assign(centers.get(id), { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos })
				})
				if (arrow) {
					const head = centers.get(kid)
					const distance = Math.hypot(head.x - pivot.x, head.y - pivot.y)
					const [ux, uy] = [(head.x - pivot.x) / distance, (head.y - pivot.y) / distance]
					const missing = arrowLengthFor(arrow, spacing, ux, uy) - distance
					if (missing > 0) shiftBranch(branch, centers, ux * missing, uy * missing)
				}
				const value = branchOverlaps(branch, centers, spacing) ? Infinity : score()
				// ante empate gana el primero: el lugar que eligio el abanico radial
				if (value < current && value < best) {
					best = value
					choice = branch.map((id) => ({ ...centers.get(id) }))
				}
				restore()
			}
			if (!choice) continue
			branch.forEach((id, i) => Object.assign(centers.get(id), choice[i]))
			improved = true
		}
		if (!improved) return
	}
}

/**
 * Separa lo que haya quedado encimado, empujando por el eje que menos molesta, y
 * ESTIRA las flechas cuyo rotulo no entra, apartando las dos puntas en la direccion
 * de la flecha. Las dos cosas van juntas en la misma vuelta porque se pelean entre
 * si: estirar una flecha puede encimar dos objetos, y separarlos puede acortar otra.
 */
const pullApart = (centers, spacing, arrows, iterations = 120) => {
	const ids = [...centers.keys()]
	for (let round = 0; round < iterations; round++) {
		let moved = false
		for (let i = 0; i < ids.length; i++) {
			for (let j = i + 1; j < ids.length; j++) {
				const [a, b] = [centers.get(ids[i]), centers.get(ids[j])]
				const [sa, sb] = [spacing.get(ids[i]), spacing.get(ids[j])]
				const overlapX = (sa.width + sb.width) / 2 + GAP / 2 - Math.abs(a.x - b.x)
				const overlapY = (sa.height + sb.height) / 2 + GAP / 2 - Math.abs(a.y - b.y)
				if (overlapX <= 0 || overlapY <= 0) continue
				moved = true
				if (overlapX < overlapY) {
					const push = (overlapX / 2 + 1) * (a.x <= b.x ? -1 : 1)
					a.x += push
					b.x -= push
				} else {
					const push = (overlapY / 2 + 1) * (a.y <= b.y ? -1 : 1)
					a.y += push
					b.y -= push
				}
			}
		}
		for (const arrow of arrows.values()) {
			const [a, b] = [centers.get(arrow.from), centers.get(arrow.to)]
			const distance = Math.hypot(b.x - a.x, b.y - a.y)
			const [dx, dy] = distance > 1e-6 ? [(b.x - a.x) / distance, (b.y - a.y) / distance] : [1, 0]
			const missing = arrowLengthFor(arrow, spacing, dx, dy) - distance
			if (missing <= 0) continue
			moved = true
			const push = missing / 2 + 1
			a.x -= dx * push
			a.y -= dy * push
			b.x += dx * push
			b.y += dy * push
		}
		if (!moved) return
	}
}

// ---------- el layout completo ----------

export const layout = (model, previous = new Map(), padlock = true) => {
	const shape = new Map(model.objects.map((object) => [object.id, sizeOf(object)]))
	const spacing = new Map(model.objects.map((object) => [object.id, spacingSizeOf(object)]))

	const { children, roots } = forestOf(model)
	groupByFamily(children, model)
	const arrows = labeledArrowsOf(model, padlock)

	// --- cada árbol por su cuenta, y después se acomodan entre ellos ---
	const trees = roots.map((root) => {
		const points = placeTree(root, children, spacing, arrows)
		return { root, points, box: boundingBox(points, spacing) }
	})
	const withChildren = trees.filter((tree) => tree.points.size > 1)
	const alone = trees.filter((tree) => tree.points.size === 1)

	const centers = new Map()
	let x = PADDING
	let y = PADDING
	let columnWidth = 0

	for (const tree of withChildren) {
		if (y > PADDING && y + tree.box.height > MAX_COLUMN_HEIGHT) {
			x += columnWidth + TREE_GAP
			y = PADDING
			columnWidth = 0
		}
		for (const [id, at] of tree.points) {
			centers.set(id, { x: x - tree.box.left + at.x, y: y - tree.box.top + at.y })
		}
		columnWidth = Math.max(columnWidth, tree.box.width)
		y += tree.box.height + TREE_GAP
	}

	// los objetos sueltos, en una columna aparte a la derecha
	if (alone.length) {
		x += columnWidth + TREE_GAP
		let loose = PADDING
		const width = Math.max(...alone.map((tree) => spacing.get(tree.root).width))
		for (const tree of alone) {
			const size = spacing.get(tree.root)
			if (loose > PADDING && loose + size.height > MAX_COLUMN_HEIGHT) {
				x += width + TREE_GAP
				loose = PADDING
			}
			centers.set(tree.root, { x: x + width / 2, y: loose + size.height / 2 })
			loose += size.height + GAP
		}
	}

	// El orden importa: pullShared decide MIDIENDO el dibujo, asi que primero hay
	// que dejarlo en su forma definitiva (pullApart separa lo encimado), despues
	// buscar mejores lugares para los compartidos, y volver a separar por si
	// alguno quedo pegado a un vecino.
	pullApart(centers, spacing, arrows)
	pullShared(centers, model, children, spacing, arrows)
	swapSiblings(centers, model, children, spacing, arrows)
	turnBranches(centers, model, children, spacing, arrows)
	pullApart(centers, spacing, arrows)

	// --- de centros a esquinas, ya con las posiciones guardadas a mano ---
	const left = Math.min(...[...centers.entries()].map(([id, at]) => at.x - spacing.get(id).width / 2))
	const top = Math.min(...[...centers.entries()].map(([id, at]) => at.y - spacing.get(id).height / 2))

	const positions = new Map()
	for (const object of model.objects) {
		const size = shape.get(object.id)
		const saved = previous.get(object.id)
		if (saved) { positions.set(object.id, { x: saved.x, y: saved.y, ...size }); continue }
		const center = centers.get(object.id)
		positions.set(object.id, {
			x: Math.round(center.x - left + PADDING - size.width / 2),
			y: Math.round(center.y - top + PADDING - size.height / 2),
			...size,
		})
	}

	// --- el tamaño del ambiente ---
	// De la versión anterior se respeta DÓNDE está y que no se achique, pero el
	// tamaño se recalcula siempre: si no, los objetos nuevos quedarían dibujados
	// afuera del rectángulo aunque en el XML cuelguen de él.
	const right = Math.max(...[...positions.values()].map((at) => at.x + at.width), 200)
	const bottom = Math.max(...[...positions.values()].map((at) => at.y + at.height), 120)
	const savedAmbiente = previous.get('ambiente')
	const size = {
		width: Math.max(right + PADDING, savedAmbiente?.width ?? 0),
		height: Math.max(bottom + PADDING, savedAmbiente?.height ?? 0),
	}

	const globals = placeLabels(model, positions, size, previous, savedAmbiente, padlock)
	return { ambiente: globals.ambiente, positions, globals: globals.labels }
}

// ---------- las etiquetas de las referencias globales ----------

/**
 * El ancho del rótulo, medido sobre el texto que se va a DIBUJAR. Si lleva candado
 * hay que sumarlo: no alcanza con `(name + '🔒').length`, porque el emoji ocupa
 * dos unidades UTF-16 y `length` lo contaría como dos letras.
 */
const labelWidthOf = (name, padlocked) => Math.max(
	LABEL_MIN_WIDTH,
	Math.round(name.length * CHARACTER_WIDTH + 12) + (padlocked ? PADLOCK_WIDTH : 0),
)

/** Por qué borde del ambiente conviene que salga: el que tenga más cerca. */
const closestSide = (target, size) => {
	const distances = {
		left: target.x,
		right: size.width - (target.x + target.width),
		top: target.y,
		bottom: size.height - (target.y + target.height),
	}
	// empate a favor de los costados: las etiquetas son anchas y apilan mejor en vertical
	distances.top *= 1.15
	distances.bottom *= 1.15
	return Object.entries(distances).sort((a, b) => a[1] - b[1])[0][0]
}

/**
 * Ubica los nombres globales por FUERA del ambiente, cada uno por el borde que le
 * queda más cerca de su objeto. Así la flecha es corta y cruza poco: una etiqueta
 * empujada al borde equivocado se lleva la flecha de punta a punta del dibujo.
 */
const placeLabels = (model, positions, size, previous, savedAmbiente, padlock) => {
	const bySide = { left: [], right: [], top: [], bottom: [] }
	for (const global of model.globals) {
		const target = positions.get(global.to)
		if (!target) continue
		const width = labelWidthOf(global.name, padlock && global.constant)
		bySide[closestSide(target, size)].push({ global, target, width })
	}

	// A lo largo de cada borde, en el orden en que están sus objetos, corriéndose
	// lo justo para no pisarse con la etiqueta anterior.
	const offsets = new Map()
	for (const [side, entries] of Object.entries(bySide)) {
		const vertical = side === 'left' || side === 'right'
		const center = ({ target }) => vertical
			? target.y + target.height / 2
			: target.x + target.width / 2
		const extent = (entry) => vertical ? LABEL_HEIGHT : entry.width

		entries.sort((a, b) => center(a) - center(b))
		let cursor = -Infinity
		for (const entry of entries) {
			const at = Math.max(center(entry) - extent(entry) / 2, cursor)
			cursor = at + extent(entry) + LABEL_SEPARATION
			offsets.set(entry.global.name, at)
		}
	}

	// El ambiente deja lugar para las etiquetas que le quedan a la izquierda y arriba
	const widest = (side) => Math.max(0, ...bySide[side].map((entry) => entry.width))
	const overflow = (side) => Math.min(0, ...bySide[side].map((entry) => offsets.get(entry.global.name)))
	const ambiente = {
		x: savedAmbiente?.x ?? AMBIENTE_MARGIN + widest('left') + LABEL_GAP - Math.min(0, overflow('top'), overflow('bottom')),
		y: savedAmbiente?.y ?? AMBIENTE_MARGIN + (bySide.top.length ? LABEL_HEIGHT + LABEL_GAP : 0) - Math.min(0, overflow('left'), overflow('right')),
		...size,
	}

	const labels = new Map()
	for (const [side, entries] of Object.entries(bySide)) {
		for (const entry of entries) {
			const name = entry.global.name
			const saved = previous.get(`global::${name}`)
			const align = side === 'left' ? 'right' : side === 'right' ? 'left' : 'center'
			if (saved) {
				labels.set(name, { ...saved, width: entry.width, height: LABEL_HEIGHT, side, align })
				continue
			}
			const at = offsets.get(name)
			const geometry = {
				left: { x: ambiente.x - LABEL_GAP - entry.width, y: ambiente.y + at },
				right: { x: ambiente.x + ambiente.width + LABEL_GAP, y: ambiente.y + at },
				top: { x: ambiente.x + at, y: ambiente.y - LABEL_GAP - LABEL_HEIGHT },
				bottom: { x: ambiente.x + at, y: ambiente.y + ambiente.height + LABEL_GAP },
			}[side]
			labels.set(name, {
				x: Math.round(geometry.x),
				y: Math.round(geometry.y),
				width: entry.width,
				height: LABEL_HEIGHT,
				side,
				align,
			})
		}
	}

	return { ambiente, labels }
}
