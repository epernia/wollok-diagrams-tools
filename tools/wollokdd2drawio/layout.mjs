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

/**
 * Los WKO, los booleanos y las colecciones van como círculos: su etiqueta es
 * corta y fija, no hay nada que dimensionar, y se distinguen de un vistazo entre
 * los óvalos de las instancias.
 */
export const isCircle = (object) =>
	object.kind === 'wko' || object.kind === 'collection' || object.module === 'wollok.lang.Boolean'

const diameterOf = (object) => {
	if (object.module === 'wollok.lang.Dictionary') return DICTIONARY_CIRCLE
	return object.kind === 'collection' ? COLLECTION_CIRCLE : WKO_CIRCLE
}

const isNumber = (object) => object.module === 'wollok.lang.Number'
const isString = (object) => object.module === 'wollok.lang.String'

/** Ancho de un literal que se estira: nunca menos de 40, nunca más que el tope. */
const flatWidth = (needed) =>
	Math.min(MAX_WIDTH, Math.max(FLAT_MIN_WIDTH, Math.round(needed)))

/** El tamaño con el que se dibuja. */
export const sizeOf = (object) => {
	if (isCircle(object)) return { width: diameterOf(object), height: diameterOf(object) }

	const characters = object.label.length
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

export const layout = (model, previous = new Map()) => {
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

	const globals = placeLabels(model, positions, size, previous, savedAmbiente)
	return { ambiente: globals.ambiente, positions, globals: globals.labels }
}

// ---------- las etiquetas de las referencias globales ----------

const labelWidthOf = (name) => Math.max(LABEL_MIN_WIDTH, Math.round(name.length * CHARACTER_WIDTH + 12))

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
const placeLabels = (model, positions, size, previous, savedAmbiente) => {
	const bySide = { left: [], right: [], top: [], bottom: [] }
	for (const global of model.globals) {
		const target = positions.get(global.to)
		if (!target) continue
		bySide[closestSide(target, size)].push({ global, target, width: labelWidthOf(global.name) })
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
