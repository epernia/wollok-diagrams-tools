/*
 * Layout: donde va cada caja.
 *
 * draw.io no acomoda nada solo: el archivo guarda las coordenadas. Eso es
 * justamente lo bueno (podes mover todo a mano y queda guardado), pero obliga a
 * dar posiciones iniciales razonables.
 *
 * La idea del algoritmo, en una linea: LA HERENCIA MANDA EN VERTICAL Y LA
 * ASOCIACION EN HORIZONTAL.
 *
 *   - Cada arbol de herencia/realizacion es un BLOQUE rigido: el padre arriba y
 *     los hijos en la fila de abajo, centrados. El bloque se mueve entero.
 *   - Los bloques se reparten en COLUMNAS segun las asociaciones: el que
 *     referencia queda a la izquierda, el referenciado a la derecha.
 *   - Entre columna y columna queda un PASILLO vertical vacio de punta a punta.
 *     Por ahi bajan las flechas (ver routing.mjs).
 *
 * Ese pasillo es lo unico que evita que las flechas crucen por encima de las
 * cajas, porque mxGraph NO esquiva obstaculos: su ruteador ortogonal solo
 * conoce el origen y el destino de la arista, no el resto del dibujo. O sea que
 * "que las flechas no se encimen" es una propiedad del layout, no del estilo de
 * las flechas.
 *
 * No es un dagre ni un ELK — a proposito, porque agregar una dependencia npm
 * dentro de un proyecto Wollok rompe `wollok test` (ver tools/wollok-uml/wollok.mjs).
 */

const CHARACTER_WIDTH = 6.6
const BOLD_CHARACTER_WIDTH = 7.4
const MIN_WIDTH = 180
const MAX_WIDTH = 420
const ROW_HEIGHT = 24
const SEPARATOR_HEIGHT = 8
const HEADER_HEIGHT = 30
const HEADER_WITH_STEREOTYPE_HEIGHT = 46

const MARGIN = 40
const GAP_SIBLING = 40      // entre hermanos de un mismo nivel de herencia
const GAP_LEVEL = 60        // entre el padre y la fila de hijos
const GAP_BLOCK = 60        // entre bloques apilados en la misma columna
export const CORRIDOR = 110 // ancho del pasillo vertical entre columnas
const ALIGN_PASSES = 3      // pasadas de alineacion (ver "enderezado")

const STRUCTURAL = ['inheritance', 'realization', 'mixin']

const widthOf = (text, characterWidth = CHARACTER_WIDTH) => text.length * characterWidth + 24

/** Alto y ancho de una caja, a partir de lo que va adentro. */
export const sizeOf = (box) => {
	const widths = [
		widthOf(box.name, BOLD_CHARACTER_WIDTH),
		...box.rows.map((row) => widthOf(row.text)),
	]
	const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.ceil(Math.max(...widths))))
	const height = box.headerHeight
		+ box.rows.reduce((total, row) => total + (row.kind === 'separator' ? SEPARATOR_HEIGHT : ROW_HEIGHT), 0)
	return { width, height }
}

/*
 * Todas las cajas llevan estereotipo — «class», «WKO», «interface» o «mixin» —
 * asi que todas necesitan el encabezado de dos renglones. HEADER_HEIGHT quedo
 * para las que no lo lleven, si alguna vez se apaga.
 */
export const headerHeightOf = (entity) =>
	STEREOTYPE_KINDS.includes(entity.kind) || entity.stereotypes.length
		? HEADER_WITH_STEREOTYPE_HEIGHT
		: HEADER_HEIGHT

const STEREOTYPE_KINDS = ['class', 'wko', 'interface', 'mixin']

export const rowHeightOf = (row) => (row.kind === 'separator' ? SEPARATOR_HEIGHT : ROW_HEIGHT)

/** Desplazamiento vertical de cada fila dentro de su caja (lo usa el ruteo). */
export const rowOffsetsOf = (box) => {
	const offsets = new Map()
	let y = box.headerHeight
	for (const row of box.rows) {
		const height = rowHeightOf(row)
		offsets.set(row.id, { top: y, height, center: y + height / 2 })
		y += height
	}
	return offsets
}

/** El centro vertical de la fila de un atributo, relativo a la caja. */
export const attributeCenterOf = (box, attributeName) => {
	if (!attributeName) return undefined
	const row = box.rows.find((r) => r.kind === 'row' && r.id.startsWith(`attr:${attributeName}:`))
	return row ? rowOffsetsOf(box).get(row.id).center : undefined
}

/**
 * Ubica las cajas.
 *
 * @param boxes      [{ name, width, height, headerHeight, rows }] en orden de codigo
 * @param relations  las del modelo
 * @param fixed      Map(nombre -> { x, y }) posiciones ya elegidas a mano
 * @returns Map(nombre -> { x, y })
 */
export const layout = (boxes, relations, fixed = new Map()) => {
	const positions = new Map()
	for (const box of boxes) {
		const previous = fixed.get(box.name)
		if (previous) positions.set(box.name, { x: previous.x, y: previous.y })
	}
	const pending = boxes.filter((box) => !positions.has(box.name))
	if (!pending.length) return positions

	// Las cajas que el usuario ya movio a mano no entran en el algoritmo: se
	// respetan donde estan y las nuevas se acomodan debajo de todas ellas, para
	// no taparlas. El ruteo despues trabaja sobre la geometria final, asi que las
	// flechas salen bien igual (ver routing.mjs).
	const arranged = arrange(pending, relations)
	const bottomOfFixed = [...positions.entries()].reduce((bottom, [name, position]) =>
		Math.max(bottom, position.y + (boxes.find((b) => b.name === name)?.height ?? 0)), 0)
	const offsetY = bottomOfFixed ? bottomOfFixed + GAP_BLOCK - MARGIN : 0

	for (const [name, position] of arranged) {
		positions.set(name, { x: position.x, y: position.y + offsetY })
	}
	return positions
}

// ---------- el algoritmo, por fases ----------

const arrange = (boxes, relations) => {
	const index = new Map(boxes.map((box, i) => [box.name, i]))
	const byName = new Map(boxes.map((box) => [box.name, box]))
	const has = (name) => byName.has(name)

	const blocks = familiesOf(boxes, relations, index)
	const blockOf = new Map(boxes.map((box) => [box.name, blocks.find((b) => b.members.includes(box))]))

	for (const block of blocks) levelsOf(block, relations, index)

	// Primera colocacion, sin saber todavia que lado necesita cada caja.
	placeInside(blocks, byName, index, new Map())

	// --- columnas ---
	const associations = relations
		.map((relation, i) => ({ ...relation, i }))
		.filter((relation) => !STRUCTURAL.includes(relation.kind) && has(relation.from) && has(relation.to))
	// Las asociaciones dentro de un mismo bloque no ordenan nada: si se contaran,
	// una dependencia entre un padre y su hijo inventaria un ciclo.
	const between = associations
		.map((relation) => ({ relation, from: blockOf.get(relation.from), to: blockOf.get(relation.to) }))
		.filter((edge) => edge.from !== edge.to)

	const backward = breakCycles(blocks, between)
	const column = columnsOf(blocks, between.filter((edge) => !backward.has(edge)))
	park(blocks, between, associations, blockOf, column)

	// --- la regla de los extremos ---
	// Dentro de una fila de hermanos, el que necesita sacar una flecha por la
	// izquierda va primero y el que la necesita por la derecha va ultimo. Sin
	// esto, el del medio le pasa la flecha por encima al de al lado.
	const sides = sidesOf(boxes, associations, blockOf, column)
	placeInside(blocks, byName, index, sides)

	const columns = columnsOrdered(blocks, column, associations, blockOf, byName, index)
	const y = verticalOf(columns, associations, blockOf, byName, column)
	const x = horizontalOf(columns)

	const positions = new Map()
	for (const box of boxes) {
		const block = blockOf.get(box.name)
		positions.set(box.name, { x: x.get(block) + box.bx, y: y.get(block) + box.by })
	}
	return positions
}

/** Union-find: cada arbol de herencia/realizacion/mixin es UN bloque rigido. */
const familiesOf = (boxes, relations, index) => {
	const parent = new Map(boxes.map((box) => [box.name, box.name]))
	const find = (name) => {
		while (parent.get(name) !== name) {
			parent.set(name, parent.get(parent.get(name)))
			name = parent.get(name)
		}
		return name
	}
	const union = (a, b) => {
		const [ra, rb] = [find(a), find(b)]
		if (ra === rb) return
		// gana siempre el que aparece primero en el codigo: asi el resultado no
		// depende del orden en que vinieron las relaciones
		if (index.get(ra) <= index.get(rb)) parent.set(rb, ra)
		else parent.set(ra, rb)
	}
	for (const relation of relations) {
		if (!STRUCTURAL.includes(relation.kind)) continue
		if (parent.has(relation.from) && parent.has(relation.to)) union(relation.from, relation.to)
	}

	const byRepresentative = new Map()
	for (const box of boxes) {
		const representative = find(box.name)
		if (!byRepresentative.has(representative)) {
			byRepresentative.set(representative, { id: representative, rank: index.get(representative), members: [] })
		}
		byRepresentative.get(representative).members.push(box)
	}
	return [...byRepresentative.values()].sort((a, b) => a.rank - b.rank)
}

/** Niveles de herencia dentro de un bloque: el padre en 0, los hijos en 1... */
const levelsOf = (block, relations, index) => {
	const names = new Set(block.members.map((box) => box.name))
	const parents = new Map(block.members.map((box) => [box.name, []]))
	const children = new Map(block.members.map((box) => [box.name, []]))
	for (const relation of relations) {
		if (!STRUCTURAL.includes(relation.kind)) continue
		if (!names.has(relation.from) || !names.has(relation.to)) continue
		parents.get(relation.to).push(relation.from)
		children.get(relation.from).push(relation.to)
	}

	const depth = new Map()
	const depthOf = (name, visiting = new Set()) => {
		if (depth.has(name)) return depth.get(name)
		if (visiting.has(name)) return 0        // por las dudas: ciclo de herencia
		visiting.add(name)
		const above = parents.get(name)
		const value = above.length ? Math.max(...above.map((p) => depthOf(p, visiting))) + 1 : 0
		depth.set(name, value)
		return value
	}
	for (const box of block.members) depthOf(box.name)

	const levels = []
	for (const box of block.members) {
		const level = depth.get(box.name)
		levels[level] = levels[level] ?? []
		levels[level].push(box)
	}
	block.levels = levels.map((level) => level.sort((a, b) => index.get(a.name) - index.get(b.name)))
	block.childrenOf = children
	return block
}

/** Coloca las cajas dentro de su bloque: el padre centrado sobre sus hijos. */
const placeInside = (blocks, byName, index, sides) => {
	const weight = (box) => {
		const side = sides.get(box.name)
		return (side?.left ? -1 : 0) + (side?.right ? 1 : 0)
	}
	for (const block of blocks) {
		for (const level of block.levels) {
			level.sort((a, b) => weight(a) - weight(b) || index.get(a.name) - index.get(b.name))
		}
		let y = 0
		for (const level of block.levels) {
			let x = 0
			for (const box of level) {
				box.bx = x
				box.by = y
				x += box.width + GAP_SIBLING
			}
			y += Math.max(...level.map((box) => box.height)) + GAP_LEVEL
		}
		// de abajo hacia arriba, cada padre se centra sobre el ancho de sus hijos
		for (let level = block.levels.length - 2; level >= 0; level--) {
			for (const box of block.levels[level]) {
				const children = block.childrenOf.get(box.name).map((name) => byName.get(name)).filter(Boolean)
				if (!children.length) continue
				const left = Math.min(...children.map((child) => child.bx))
				const right = Math.max(...children.map((child) => child.bx + child.width))
				box.bx = Math.round((left + right) / 2 - box.width / 2)
			}
			block.levels[level].sort((a, b) => a.bx - b.bx)
			for (let i = 1; i < block.levels[level].length; i++) {
				const previous = block.levels[level][i - 1]
				const current = block.levels[level][i]
				current.bx = Math.max(current.bx, previous.bx + previous.width + GAP_SIBLING)
			}
		}
		const leftmost = Math.min(...block.members.map((box) => box.bx))
		for (const box of block.members) box.bx -= leftmost
		block.width = Math.max(...block.members.map((box) => box.bx + box.width))
		block.height = Math.max(...block.members.map((box) => box.by + box.height))
	}
}

/**
 * Marca las asociaciones que cierran un ciclo, para poder repartir columnas.
 * No desaparecen del dibujo: solo dejan de mandar en la asignacion.
 */
const breakCycles = (blocks, edges) => {
	const out = new Map(blocks.map((block) => [block, []]))
	const incoming = new Map(blocks.map((block) => [block, 0]))
	for (const edge of edges) {
		out.get(edge.from).push(edge)
		incoming.set(edge.to, incoming.get(edge.to) + 1)
	}
	for (const list of out.values()) list.sort((a, b) => a.to.rank - b.to.rank)

	// se arranca por el que mas "tira hacia la derecha": menos aristas invertidas
	const roots = [...blocks].sort((a, b) =>
		(out.get(b).length - incoming.get(b)) - (out.get(a).length - incoming.get(a)) || a.rank - b.rank)

	const color = new Map(blocks.map((block) => [block, 'blanco']))
	const backward = new Set()
	const visit = (block) => {
		color.set(block, 'gris')
		for (const edge of out.get(block)) {
			if (color.get(edge.to) === 'gris') backward.add(edge)
			else if (color.get(edge.to) === 'blanco') visit(edge.to)
		}
		color.set(block, 'negro')
	}
	for (const block of roots) if (color.get(block) === 'blanco') visit(block)
	return backward
}

/** Longest path: la columna de un bloque es la mas lejana de las que lo alcanzan. */
const columnsOf = (blocks, edges) => {
	const out = new Map(blocks.map((block) => [block, []]))
	const pending = new Map(blocks.map((block) => [block, 0]))
	for (const edge of edges) {
		out.get(edge.from).push(edge)
		pending.set(edge.to, pending.get(edge.to) + 1)
	}
	const column = new Map(blocks.map((block) => [block, 0]))
	const ready = blocks.filter((block) => pending.get(block) === 0).sort((a, b) => a.rank - b.rank)
	while (ready.length) {
		const block = ready.shift()
		for (const edge of out.get(block)) {
			column.set(edge.to, Math.max(column.get(edge.to), column.get(block) + 1))
			pending.set(edge.to, pending.get(edge.to) - 1)
			if (pending.get(edge.to) === 0) {
				ready.push(edge.to)
				ready.sort((a, b) => a.rank - b.rank)
			}
		}
	}
	return column
}

/** Los que no participan de ninguna asociacion se estacionan a la derecha de todo. */
const park = (blocks, between, associations, blockOf, column) => {
	const touched = new Set(between.flatMap((edge) => [edge.from, edge.to]))
	for (const relation of associations) touched.add(blockOf.get(relation.from))
	const used = [...blocks].filter((block) => touched.has(block))
	const last = Math.max(0, ...used.map((block) => column.get(block)))
	for (const block of blocks) if (!touched.has(block)) column.set(block, last + 1)
}

/** Que costado de cada caja va a necesitar una flecha. */
const sidesOf = (boxes, associations, blockOf, column) => {
	const sides = new Map(boxes.map((box) => [box.name, { left: false, right: false }]))
	for (const relation of associations) {
		const from = column.get(blockOf.get(relation.from))
		const to = column.get(blockOf.get(relation.to))
		if (relation.from === relation.to) { sides.get(relation.from).right = true; continue }
		if (to > from) { sides.get(relation.from).right = true; sides.get(relation.to).left = true }
		else if (to < from) { sides.get(relation.from).left = true; sides.get(relation.to).right = true }
		else { sides.get(relation.from).left = true; sides.get(relation.to).left = true }
	}
	return sides
}

/**
 * Orden vertical dentro de cada columna, por baricentro.
 *
 * El baricentro clasico empata siempre aca (samsung y personal tienen las dos a
 * juliana como unico vecino), y el empate es justo lo que importa: samsung va
 * arriba porque `var celular` esta declarado antes que `var empresa`. Por eso el
 * baricentro se calcula con el PUERTO, o sea con la altura de la fila del
 * atributo dentro del bloque de origen, y no solo con la posicion del bloque.
 */
const columnsOrdered = (blocks, column, associations, blockOf, byName, index) => {
	const columns = []
	for (const block of blocks) {
		const c = column.get(block)
		columns[c] = columns[c] ?? []
		columns[c].push(block)
	}
	for (let c = 0; c < columns.length; c++) {
		columns[c] = (columns[c] ?? []).sort((a, b) => a.rank - b.rank)
	}

	const positionIn = (block) => columns[column.get(block)].indexOf(block)
	const port = (relation) => {
		const source = byName.get(relation.from)
		const block = blockOf.get(relation.from)
		const center = attributeCenterOf(source, relation.fromAttribute) ?? source.headerHeight / 2
		return (source.by + center) / Math.max(1, block.height)
	}

	for (let pass = 0; pass < 2; pass++) {
		for (let c = 1; c < columns.length; c++) {
			const anchors = new Map(columns[c].map((block) => [block, []]))
			for (const relation of associations) {
				const from = blockOf.get(relation.from)
				const to = blockOf.get(relation.to)
				if (column.get(to) !== c || column.get(from) !== c - 1) continue
				anchors.get(to)?.push(positionIn(from) + port(relation))
			}
			const before = new Map(columns[c].map((block, i) => [block, i]))
			columns[c] = [...columns[c]].sort((a, b) => {
				const va = anchors.get(a).length ? average(anchors.get(a)) : before.get(a)
				const vb = anchors.get(b).length ? average(anchors.get(b)) : before.get(b)
				return va - vb || before.get(a) - before.get(b) || index.get(a.id) - index.get(b.id)
			})
		}
	}
	return columns
}

const average = (values) => values.reduce((total, value) => total + value, 0) / values.length

/**
 * La coordenada Y de cada bloque: apilado, mas unas pasadas de "enderezado".
 *
 * El enderezado es lo que hace que la flecha salga RECTA: una asociacion quiere
 * que el centro de la fila del atributo quede exactamente a la altura de la
 * banda de titulo del destino. Se aplica en las dos direcciones (el destino
 * busca al origen y el origen busca al destino) y siempre moviendo hacia abajo,
 * asi termina siempre y nunca genera encimados.
 */
const verticalOf = (columns, associations, blockOf, byName, column) => {
	const y = new Map()
	for (const list of columns) for (const block of list ?? []) y.set(block, 0)

	const restack = (list, wanted) => {
		let floor = MARGIN
		for (const block of list ?? []) {
			const value = Math.max(wanted?.get(block) ?? y.get(block), floor, y.get(block))
			y.set(block, value)
			floor = value + block.height + GAP_BLOCK
		}
	}
	for (const list of columns) restack(list)

	// Solo la PRIMERA relacion de cada bloque manda; si mandaran todas, se pelean.
	const wishes = (c, direction) => {
		const wanted = new Map()
		for (const relation of associations) {
			const from = blockOf.get(relation.from)
			const to = blockOf.get(relation.to)
			if (column.get(to) - column.get(from) !== 1) continue
			const mover = direction === 'derecha' ? to : from
			if (column.get(mover) !== c || wanted.has(mover)) continue
			const source = byName.get(relation.from)
			const target = byName.get(relation.to)
			const center = attributeCenterOf(source, relation.fromAttribute) ?? source.headerHeight / 2
			const entry = target.headerHeight / 2
			if (direction === 'derecha') {
				wanted.set(mover, y.get(from) + source.by + center - entry - target.by)
			} else {
				wanted.set(mover, y.get(to) + target.by + entry - center - source.by)
			}
		}
		return wanted
	}

	for (let pass = 0; pass < ALIGN_PASSES; pass++) {
		for (let c = 1; c < columns.length; c++) restack(columns[c], wishes(c, 'derecha'))
		for (let c = columns.length - 2; c >= 0; c--) restack(columns[c], wishes(c, 'izquierda'))
	}
	return y
}

/** La coordenada X: el ancho de cada columna, con un pasillo vacio en el medio. */
const horizontalOf = (columns) => {
	const x = new Map()
	let left = MARGIN + CORRIDOR       // el primer pasillo es para las flechas "hacia atras"
	for (const list of columns) {
		const width = Math.max(0, ...(list ?? []).map((block) => block.width))
		for (const block of list ?? []) x.set(block, left)
		left += width + CORRIDOR
	}
	return x
}
