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

/** Ubica un árbol en coordenadas locales, con la raíz en el origen. */
const placeTree = (root, children, spacing) => {
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
			points.set(kid, {
				x: center.x + radius * Math.cos(angle),
				y: center.y + radius * Math.sin(angle),
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
const scoreOf = (centers, links, spacing) => {
	const segments = links.map(([from, to]) => [centers.get(from), centers.get(to)])
	let total = 0
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
const pullShared = (centers, model, children, spacing) => {
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

	const score = () => scoreOf(centers, links, spacing)

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
const swapSiblings = (centers, model, children, spacing) => {
	const links = linksOf(model, centers)
	if (!links.length) return

	const families = [...children.values()]
		.filter((siblings) => siblings.length > 1)
		.map((siblings) => siblings.filter((id) => centers.has(id)))
	if (!families.length) return

	let best = scoreOf(centers, links, spacing)
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
					const value = scoreOf(centers, links, spacing)
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

/** Separa lo que haya quedado encimado, empujando por el eje que menos molesta. */
const pullApart = (centers, spacing, iterations = 120) => {
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
		if (!moved) return
	}
}

// ---------- el layout completo ----------

export const layout = (model, previous = new Map(), padlock = true) => {
	const shape = new Map(model.objects.map((object) => [object.id, sizeOf(object)]))
	const spacing = new Map(model.objects.map((object) => [object.id, spacingSizeOf(object)]))

	const { children, roots } = forestOf(model)
	groupByFamily(children, model)

	// --- cada árbol por su cuenta, y después se acomodan entre ellos ---
	const trees = roots.map((root) => {
		const points = placeTree(root, children, spacing)
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
	pullApart(centers, spacing)
	pullShared(centers, model, children, spacing)
	swapSiblings(centers, model, children, spacing)
	pullApart(centers, spacing)

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
